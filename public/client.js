// 少量交互：打钩即时生效、数量自动保存、删除双确认、页脚轮播、Ctrl+S 保存
(() => {
  const readJson = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch { return null; }
  };
  const ui = readJson('ui-data') || {};

  // 保存失败必须让用户看见，否则「点了但没存上」是最难查的一类问题
  const post = async (url, data) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  };

  const toast = (msg) => {
    let el = document.getElementById('sl-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sl-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('is-on'), 2800);
  };

  const bumpCount = () => {
    const el = document.getElementById('check-count');
    if (!el) return;
    const total = document.querySelectorAll('.check-item[data-row]').length;
    const done = document.querySelectorAll('.check-item[data-row].done').length;
    el.textContent = `${done}/${total}`;
  };

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-toggle-check]');
    if (!btn) return;
    e.preventDefault();

    const wasOn = btn.dataset.on === '1';
    const on = wasOn ? 0 : 1;
    const item = btn.closest('.check-item');

    const paint = (state) => {
      btn.dataset.on = state ? '1' : '0';
      btn.classList.toggle('on', state);
      btn.setAttribute('aria-pressed', state ? 'true' : 'false');
      btn.textContent = state ? '✓' : '';
      item?.classList.toggle('done', state);
      bumpCount();
    };

    paint(!!on);

    try {
      await post('/api/check', {
        date: btn.dataset.date,
        taskId: Number(btn.dataset.task),
        on: !!on,
      });
      // 每周任务的本周次数由服务端算，切完刷新一次让「本周 2/3」跟上
      if (btn.dataset.weekly === '1') location.reload();
    } catch {
      paint(wasOn);
      toast(ui.saveFailed || 'Not saved — check the server');
    }
  });

  document.querySelectorAll('.amount').forEach((input) => {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await post('/api/check/amount', {
            date: input.dataset.date,
            taskId: Number(input.dataset.task),
            amount: input.value === '' ? null : Number(input.value),
          });
          input.classList.remove('bad');
        } catch {
          input.classList.add('bad');
          toast(ui.saveFailed || 'Not saved — check the server');
        }
      }, 500);
    });
  });

  // 只有选「每周若干次」时才显示次数输入框
  document.querySelectorAll('select[name="cadence"]').forEach((sel) => {
    const form = sel.closest('form');
    const num = form?.querySelector('input[name="target_per_week"]');
    if (!num) return;
    const sync = () => {
      num.style.display = sel.value === 'weekly' ? '' : 'none';
    };
    sel.addEventListener('change', sync);
    sync();
  });

  // 首页切换目标的下来框：选完立刻提交（不用内联 onchange，CSP 更严格）
  document.querySelectorAll('select[data-auto-submit]').forEach((sel) => {
    sel.addEventListener('change', () => sel.closest('form')?.submit());
  });

  // 删除任务：两次确认，第二次说明会连历史一起删
  document.querySelectorAll('[data-del-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = btn.closest('form');
      const title = form.dataset.delTitle || '';
      const first = (ui.delTitle || 'Delete "{title}"?').replace('{title}', title);
      if (!window.confirm(first)) return;
      if (!window.confirm(ui.delWarn || 'This cannot be undone.')) return;
      form.submit();
    });
  });

  // 页脚句子轮播：8 秒一换，中英成对
  const quoteEl = document.getElementById('foot-quote');
  const quoteData = document.getElementById('quotes-data');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (quoteEl && quoteData && !reduceMotion) {
    const list = JSON.parse(quoteData.textContent);
    const lang = quoteData.dataset.lang === 'en' ? 'en' : 'zh';
    const other = lang === 'en' ? 'zh' : 'en';
    const primaryEl = document.getElementById('q-primary');
    const secondaryEl = document.getElementById('q-secondary');
    let i = Math.floor(Math.random() * list.length);

    const render = (q) => {
      primaryEl.textContent = q[lang];
      secondaryEl.textContent = q[other];
    };
    render(list[i]);

    setInterval(() => {
      quoteEl.classList.add('is-fading');
      setTimeout(() => {
        i = (i + 1) % list.length;
        render(list[i]);
        quoteEl.classList.remove('is-fading');
      }, 420);
    }, 8000);
  }

  // 未来 7 天：边打边存，不点按钮
  document.querySelectorAll('.plan-input').forEach((input) => {
    const state = document.querySelector(`[data-plan-state="${input.dataset.planDate}"]`);
    let timer;
    let savedTimer;
    const flash = () => {
      if (!state) return;
      state.textContent = ui.planSaved || '已存';
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { state.textContent = ''; }, 1600);
    };
    const save = async () => {
      try {
        await post('/api/plan', { date: input.dataset.planDate, note: input.value });
        input.classList.remove('bad');
        flash();
      } catch {
        input.classList.add('bad');
        toast(ui.saveFailed || 'Not saved — check the server');
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      if (state) state.textContent = '';
      timer = setTimeout(save, 600);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timer);
        save();
      }
    });
  });

  // ---------- 目标排序：拖动 / 上下键 / 上下按钮 ----------
  const goalCards = () => [...document.querySelectorAll('.goal-card')];

  const moveGoal = async (id, dir) => {
    sessionStorage.setItem('sl-scroll-y', String(window.scrollY));
    try {
      await post('/goal/move', { id: Number(id), dir: Number(dir) });
      location.reload();
    } catch {
      sessionStorage.removeItem('sl-scroll-y');
      toast(ui.saveFailed || 'Not saved — check the server');
    }
  };

  document.querySelectorAll('[data-goal-move]').forEach((btn) => {
    btn.addEventListener('click', () => moveGoal(btn.dataset.id, btn.dataset.goalMove));
  });

  let dragCard = null;
  document.querySelectorAll('.goal-card .drag-handle').forEach((handle) => {
    const card = handle.closest('.goal-card');
    handle.addEventListener('dragstart', (e) => {
      dragCard = card;
      card.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', card.dataset.goalId); } catch { /* 某些浏览器不给设 */ }
      }
    });
    handle.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      dragCard = null;
      goalCards().forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    });
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      moveGoal(card.dataset.goalId, e.key === 'ArrowUp' ? -1 : 1);
    });
  });

  goalCards().forEach((card) => {
    card.addEventListener('dragover', (e) => {
      if (!dragCard || card === dragCard) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      goalCards().forEach((c) => c.classList.remove('drop-before', 'drop-after'));
      card.classList.add(after ? 'drop-after' : 'drop-before');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', async (e) => {
      if (!dragCard || card === dragCard) return;
      e.preventDefault();
      const after = card.classList.contains('drop-after');
      goalCards().forEach((c) => c.classList.remove('drop-before', 'drop-after'));

      const order = goalCards().filter((c) => c !== dragCard);
      const at = order.indexOf(card);
      if (at < 0) return;
      order.splice(after ? at + 1 : at, 0, dragCard);

      // 先按新顺序排 DOM，手感跟得上；存库失败再刷回去
      const parent = dragCard.parentNode;
      const marker = document.createElement('span');
      parent.insertBefore(marker, goalCards()[0]);
      for (const c of order) parent.insertBefore(c, marker);
      marker.remove();

      try {
        await post('/api/goal/reorder', { ids: order.map((c) => Number(c.dataset.goalId)) });
      } catch {
        toast(ui.saveFailed || 'Not saved — check the server');
        location.reload();
      }
    });
  });

  // 日期跟系统走：换了一天页面自动换成那天，别停在前一天的旧内容上
  const viewDate = document.getElementById('view-date');
  if (viewDate) {
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (viewDate.dataset.date !== local) {
      // 只有本地和服务端日期确实对不上时才换一次；加锁防止两个时区打架刷成死循环
      const key = 'sl-date-synced';
      if (sessionStorage.getItem(key) !== local) {
        sessionStorage.setItem(key, local);
        location.replace(location.pathname);
      }
    } else {
      sessionStorage.removeItem('sl-date-synced');
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 3);
      setTimeout(() => location.reload(), Math.max(1000, nextMidnight - now));
    }
  }

  // 勾里程碑会整页提交，把滚动位置记住，别每次都弹回页面顶部
  document.querySelectorAll('form[action="/milestone/toggle"]').forEach((f) => {
    f.addEventListener('submit', () => {
      sessionStorage.setItem('sl-scroll-y', String(window.scrollY));
    });
  });
  const savedY = sessionStorage.getItem('sl-scroll-y');
  if (savedY !== null) {
    sessionStorage.removeItem('sl-scroll-y');
    window.scrollTo(0, Number(savedY) || 0);
  }

  // Ctrl / Cmd + S 保存日记；只在焦点不在别的输入框里时接管
  document.addEventListener('keydown', (e) => {
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) return;
    const form = document.querySelector('form[action="/entry"]');
    if (!form) return;
    const a = document.activeElement;
    const typing =
      a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
    if (typing && !form.contains(a)) return; // 正在填别的表单，交给浏览器
    e.preventDefault();
    form.submit();
  });
})();
