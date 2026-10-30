// 视图层：纯字符串模板，服务端渲染。所有文案来自 i18n.mjs。
import { QUOTES } from './quotes.mjs';
import { pick, fmt, p } from './i18n.mjs';

const WEEK_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function weekdayOf(iso, lang = 'zh') {
  const [y, m, d] = String(iso).split('-').map(Number);
  const i = new Date(y, m - 1, d).getDay();
  return lang === 'en' ? WEEK_EN[i] : WEEK_ZH[i];
}

export function prettyDate(iso, lang = 'zh') {
  const [, m, d] = String(iso).split('-').map(Number);
  return lang === 'en' ? `${MONTH_EN[m - 1]} ${d}` : `${m} 月 ${d} 日`;
}

/** 在 ISO 日期上加减天数，用于前后一天翻页 */
export function shiftDate(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** 本机今天，用来判断「后一天」是否还有意义 */
function todayISO() {
  const t = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function goalOptions(goals, selectedId) {
  return goals
    .map(
      (g) =>
        `<option value="${g.id}" ${selectedId && g.id === selectedId ? 'selected' : ''}>${g.parent_id ? '　└ ' : ''}${esc(g.title)}</option>`
    )
    .join('');
}

/* ---------------- 布局 ---------------- */

export function layout({ title, active = '', body, minimal = false, lang = 'zh' }) {
  const t = pick(lang);
  const other = lang === 'en' ? 'zh' : 'en';

  const navItems = [
    ['/', t.nav.today],
    ['/plan', t.nav.plan],
    ['/goals', t.nav.goals],
    ['/blockers', t.nav.blockers],
    ['/timeline', t.nav.timeline],
    ['/help', t.nav.help],
  ];

  const nav = minimal
    ? ''
    : `<nav class="nav">${navItems
        .map(
          ([href, label]) =>
            `<a href="${href}" class="nav-item ${active === href ? 'is-active' : ''}">${esc(label)}</a>`
        )
        .join('')}</nav>`;

  const tail = minimal
    ? `<a class="nav-item lang-switch" href="/lang/${other}" title="${esc(t.langSwitchTitle)}">${esc(t.langSwitch)}</a>`
    : `<a class="nav-item ghost export-link" href="/export?days=7">${esc(t.nav.export)}</a>${
        process.env.APP_PASSWORD ? `<a class="nav-item ghost" href="/logout">${esc(t.nav.logout)}</a>` : ''
      }<a class="nav-item lang-switch" href="/lang/${other}" title="${esc(t.langSwitchTitle)}">${esc(t.langSwitch)}</a>`;

  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · ${esc(t.pageSuffix)}</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%232f6b4f'/%3E%3Cpath d='M9 17l5 5 9-11' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
</head>
<body class="${minimal ? 'minimal' : ''}">
  <header class="top">
    <div class="wrap top-inner">
      <a class="brand" href="/">${esc(t.brand)}</a>
      ${nav}
      <div class="top-tail">${tail}</div>
    </div>
  </header>
  <main class="wrap">${body}</main>
  <footer class="foot">
    <p class="foot-quote" id="foot-quote">
      <span class="q-primary" id="q-primary">${esc(QUOTES[0][lang] || QUOTES[0].zh)}</span>
      <span class="q-secondary" id="q-secondary">${esc(lang === 'en' ? QUOTES[0].zh : QUOTES[0].en)}</span>
    </p>
    <p class="foot-credit muted small">唯有信仰亘古不变 · deepseekv4.1flash</p>
  </footer>
  <script type="application/json" id="quotes-data" data-lang="${lang}">${JSON.stringify(QUOTES)}</script>
  <script type="application/json" id="ui-data">${JSON.stringify({
    delTitle: lang === 'en' ? 'Delete task "{title}"?' : '删除任务「{title}」？',
    delWarn:
      lang === 'en'
        ? 'This also deletes all its check-in history and cannot be undone.\nDelete anyway?'
        : '这会连同它所有历史打卡一起删掉，且无法恢复。\n确定要删除吗？',
    saveFailed: lang === 'en' ? 'Not saved — is the server still running?' : '没存上，看看服务是不是关了',
    planSaved: lang === 'en' ? 'Saved' : '已存',
  })}</script>
  <script src="/client.js" defer></script>
</body>
</html>`;
}

/* ---------------- 小部件 ---------------- */

function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <i style="width:${pct}%"></i>
  </div>`;
}

function emptyState(text, action = '') {
  return `<p class="empty">${esc(text)}</p>${action}`;
}

function checkRow(task, c, date, weekCounts = null, t = null, lang = 'zh') {
  const on = !!c;
  const weekly = task.cadence === 'weekly' && t;
  const wDone = weekly ? weekCounts?.get(task.id) || 0 : 0;
  const wTarget = Number(task.target_per_week) || 7;
  return `<li class="check-item ${on ? 'done' : ''}" data-row>
    <button type="button" class="tick" data-toggle-check
            data-task="${task.id}" data-date="${date}" data-on="${on ? 1 : 0}"
            data-weekly="${task.cadence === 'weekly' ? 1 : 0}"
            aria-pressed="${on}" aria-label="${esc(task.title)}">${on ? '✓' : ''}</button>
    <span class="check-title" title="${esc(task.title)}">${esc(task.title)}</span>
    ${task.active === 0 ? `<span class="week-chip">${esc(t.today.pausedTask)}</span>` : ''}
    ${weekly ? `<span class="week-chip ${wDone >= wTarget ? 'met' : ''}">${esc(fmt(t.today.weekProgress, { done: wDone, target: wTarget }))}</span>` : ''}
    <input class="amount" type="number" inputmode="numeric" min="0"
           data-task="${task.id}" data-date="${date}"
           value="${c && c.amount != null ? c.amount : ''}" placeholder="—">
    <span class="unit">${esc(task.unit || '')}</span>
  </li>`;
}

function milestoneRow(m) {
  return `<li class="ms-item ${m.done ? 'done' : ''}">
    <form method="post" action="/milestone/toggle" class="inline">
      <input type="hidden" name="id" value="${m.id}">
      <button class="tick small ${m.done ? 'on' : ''}" aria-label="toggle">${m.done ? '✓' : ''}</button>
    </form>
    <span class="ms-title">${esc(m.title)}</span>
  </li>`;
}

function subGoalRow(k, st, blockerCount, t, lang) {
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  const ms = st.total
    ? p(lang, st.total, t.goals.subMilestones, t.goals.subMilestones1, t.goals.subMilestones, { done: st.done, total: st.total })
    : t.goals.subNoMs;
  return `<li class="sub-goal">
    <a href="/goal/${k.id}" class="sub-goal-link">
      <span class="sub-goal-title">${esc(k.title)}</span>
      <span class="muted small">${esc(ms)} · ${fmt(t.goals.subBlockers, { n: blockerCount })}</span>
    </a>
    <span class="mini-bar"><i style="width:${pct}%"></i></span>
  </li>`;
}

/* ---------------- 今日 ---------------- */

export function todayPage(d, lang = 'zh') {
  const t = pick(lang);
  const { date, isToday, entry, tasks, checkMap, openBlockers, otherBlockerCount = 0,
    goals, currentGoal, milestones, stats, weekCounts = null, prevEntry = null, justSaved = false } = d;

  const doneChecks = tasks.filter((x) => checkMap.has(x.id));
  const summaryPrefix = isToday ? t.today.summaryPrefix : t.today.summaryPrefixPast;
  const summary = doneChecks.length
    ? summaryPrefix +
      doneChecks
        .map((x) => {
          const c = checkMap.get(x.id);
          return `${x.title}${c.amount != null ? ` ${c.amount}${x.unit || ''}` : ''}`;
        })
        .join(' · ')
    : isToday
      ? t.today.summaryNone
      : t.today.summaryNonePast;

  const goalPicker = goals.length
    ? `<form method="get" action="/" class="picker">
        <input type="hidden" name="d" value="${date}">
        <select name="goal" data-auto-submit>
          ${goalOptions(goals, currentGoal && currentGoal.id)}
        </select>
      </form>`
    : '';

  const openMs = milestones.filter((m) => !m.done);

  const goalBlock = currentGoal
    ? `<div class="card fade-up" style="--i:2">
        <div class="card-head">
          <h2>${esc(currentGoal.title)}</h2>
          <span class="muted small">${stats.total ? p(lang, stats.total, t.today.milestonesCount, t.today.milestonesCountOne, t.today.milestonesCount, { done: stats.done, total: stats.total }) : t.today.noMilestones}</span>
        </div>
        ${stats.total ? progressBar(stats.done, stats.total) : ''}
        <ul class="ms-list">${openMs.slice(0, 4).map(milestoneRow).join('')}</ul>
        ${openMs.length > 4 ? `<p class="muted small more-hint"><a href="/goal/${currentGoal.id}">${esc(fmt(t.today.moreMilestones, { n: openMs.length - 4 }))} →</a></p>` : ''}
        ${openMs.length === 0 && stats.total > 0 ? `<p class="empty">${esc(t.today.allMilestonesDone)}</p>` : ''}
        <form method="post" action="/milestone/add" class="row-form">
          <input type="hidden" name="goal_id" value="${currentGoal.id}">
          <input name="title" placeholder="${esc(t.today.addMilestone)}" required>
          <button class="btn ghost">${esc(t.common.add)}</button>
        </form>
        <div class="goal-links">
          <a class="more" href="/goal/${currentGoal.id}">${esc(t.today.goalDetail)}</a>
          <a class="more" href="/goals">${esc(t.today.allGoals)}</a>
        </div>
      </div>`
    : `<div class="card fade-up" style="--i:2">
        ${emptyState(t.today.noGoal)}
        <form method="post" action="/goal/add" class="stack">
          <input name="title" placeholder="${esc(t.today.goalPlaceholder)}" required>
          <input name="why" placeholder="${esc(t.today.whyPlaceholder)}">
          <input name="target_date" type="date">
          <button class="btn primary">${esc(t.today.createGoal)}</button>
        </form>
      </div>`;

  const blockerList = openBlockers.length
    ? openBlockers
        .map(
          (b) => `<li class="blocker">
            <div class="blocker-main">
              <p class="b-title">${esc(b.title)}</p>
              ${b.detail ? `<p class="b-detail muted small">${esc(b.detail)}</p>` : ''}
              <p class="b-meta muted small">${esc(b.goal_title || t.goals.ungrouped)} · ${esc(fmt(t.today.openedAt, { date: prettyDate(String(b.opened_at).slice(0, 10), lang) }))}</p>
            </div>
            <form method="post" action="/blocker/resolve" class="row-form tight">
              <input type="hidden" name="id" value="${b.id}">
              <input name="resolution" placeholder="${esc(t.blockers.resolvePlaceholder)}">
              <button class="btn ghost small">${esc(t.common.save)}</button>
            </form>
          </li>`
        )
        .join('')
    : emptyState(currentGoal ? t.today.emptyBlockerForGoal : t.today.emptyBlocker);

  return layout({
    lang,
    title: t.today.title,
    active: '/',
    body: `
    ${isToday ? `<span id="view-date" data-date="${date}" hidden></span>` : ''}
    <section class="day-head fade-up" style="--i:0">
      <div>
        <h1>${prettyDate(date, lang)} <span class="muted">${weekdayOf(date, lang)}</span></h1>
        <p class="muted small">${esc(summary)} · ${esc(p(lang, openBlockers.length, t.today.blockersOpen, t.today.blockersOpen1, t.today.blockersOpen, { n: openBlockers.length }))}</p>
      </div>
      ${goalPicker}
    </section>

    ${(() => {
      const todayPlan = String(d.todayPlan || prevEntry?.next_step || '').trim();
      const tomorrowPlan = String(d.tomorrowPlan || '').trim();
      return `<div class="nextup fade-up" style="--i:1">
        ${todayPlan
          ? `<div class="nextup-row">
               <span class="nextup-tag">${esc(t.today.todayLabel)}</span>
               <span class="nextup-text">${esc(todayPlan)}</span>
             </div>`
          : ''}
        <div class="nextup-row ${tomorrowPlan ? '' : 'is-empty'}">
          <span class="nextup-tag">${esc(t.today.tomorrowLabel)}</span>
          <span class="nextup-text">${esc(tomorrowPlan || t.plan.none)}</span>
        </div>
        <a class="nextup-more" href="/plan">${esc(t.today.planMore)}</a>
      </div>`;
    })()}

    ${isToday ? '' : `<div class="past-bar fade-up">
      <div class="past-nav">
        <a class="past-arrow" href="/?d=${shiftDate(date, -1)}" title="${esc(t.today.prevDay)}" aria-label="${esc(t.today.prevDay)}">←</a>
        <span>${esc(fmt(t.today.pastViewing, { date: `${prettyDate(date, lang)} ${weekdayOf(date, lang)}` }))}</span>
        ${date < todayISO()
          ? `<a class="past-arrow" href="/?d=${shiftDate(date, 1)}" title="${esc(t.today.nextDay)}" aria-label="${esc(t.today.nextDay)}">→</a>`
          : '<span class="past-arrow is-off"></span>'}
      </div>
      <a href="/">${esc(t.today.backToday)}</a>
    </div>`}

    ${!isToday && checkMap.size === 0
      ? `<div class="makeup-bar fade-up"><span>${esc(t.today.makeupBar)}</span></div>`
      : ''}

    <div class="grid">
      <div class="col-main">
        <form method="post" action="/entry" class="card fade-up" style="--i:1">
          <input type="hidden" name="date" value="${date}">
          <div class="card-head">
            <h2>${esc(t.today.diaryTitle)}</h2>
            <span class="muted small">${esc(t.today.diaryHint)}</span>
          </div>
          <textarea name="did" rows="6" placeholder="${esc(t.today.diaryPlaceholder)}">${esc(entry?.did || '')}</textarea>
          <label class="field">
            <span class="muted small">${esc(t.today.nextLabel)}</span>
            <input name="next_step" maxlength="300" value="${esc(entry?.next_step || '')}" placeholder="${esc(t.today.nextPlaceholder)}">
          </label>
          <div class="actions">
            <button class="btn primary">${esc(t.common.save)}</button>
            <span class="muted small saved-hint" id="save-hint">${justSaved ? esc(t.today.saved) : ''}</span>
          </div>
        </form>

        <section class="card fade-up" style="--i:2">
          <div class="card-head">
            <h2>${esc(t.today.blockersTitle)}${currentGoal ? ` · ${esc(currentGoal.title)}` : ''}</h2>
            <a class="muted small" href="/blockers">${esc(t.today.allBlockers)}</a>
          </div>
          <ul class="blocker-list">${blockerList}</ul>
          ${otherBlockerCount > 0 ? `<p class="muted small other-hint">${esc(p(lang, otherBlockerCount, t.today.otherBlockers, t.today.otherBlockers1, t.today.otherBlockers, { n: otherBlockerCount }))} · <a href="/blockers">${esc(t.today.otherLink)}</a></p>` : ''}
          <form method="post" action="/blocker/add" class="row-form">
            <input name="title" placeholder="${esc(t.today.blockerPlaceholder)}" required>
            <select name="goal_id">
              <option value="">${esc(t.today.noGoalOption)}</option>
              ${goalOptions(goals, currentGoal && currentGoal.id)}
            </select>
            <button class="btn ghost">${esc(t.common.save)}</button>
          </form>
        </section>
      </div>

      <aside class="col-side">
        <section class="card fade-up" style="--i:1">
          <div class="card-head"><h2>${esc(isToday ? t.today.checksTitle : t.today.checksTitlePast)}</h2><span class="muted small" id="check-count">${doneChecks.length}/${tasks.length}</span></div>
          <ul class="check-list">
            ${tasks.length ? tasks.map((x) => checkRow(x, checkMap.get(x.id), date, weekCounts, t, lang)).join('') : `<li class="empty">${esc(t.today.checksEmpty)}</li>`}
          </ul>
          <form method="post" action="/task/add" class="row-form">
            <input name="title" placeholder="${esc(t.today.taskPlaceholder)}" required>
            <input name="unit" placeholder="${esc(t.today.unitPlaceholder)}" class="tiny">
            <button class="btn ghost">＋</button>
          </form>
        </section>
        ${goalBlock}
      </aside>
    </div>`,
  });
}

/* ---------------- 未来 7 天 ---------------- */

export function planPage({ days, notes }, lang = 'zh') {
  const t = pick(lang);
  const today = days[0];
  const tomorrow = days[1];
  const rows = days
    .map((date) => {
      const note = notes.get(date) || '';
      const isToday = date === today;
      const isTomorrow = date === tomorrow;
      const tag = isToday
        ? `<span class="plan-tag is-today">${esc(t.plan.todayTag)}</span>`
        : isTomorrow
          ? `<span class="plan-tag">${esc(t.plan.tomorrowTag)}</span>`
          : '';
      return `<li class="plan-row ${isToday ? 'is-today' : ''}">
        <div class="plan-date">
          <span class="plan-dow">${esc(weekdayOf(date, lang))}</span>
          <span class="plan-day">${esc(prettyDate(date, lang))}</span>
          ${tag}
        </div>
        <input class="plan-input" type="text" value="${esc(note)}" maxlength="140"
               data-plan-date="${date}" placeholder="${esc(t.plan.placeholder)}"
               enterkeyhint="done" autocomplete="off">
        <span class="plan-state" data-plan-state="${date}"></span>
      </li>`;
    })
    .join('');

  return layout({
    lang,
    title: t.plan.title,
    active: '/plan',
    body: `
    <span id="view-date" data-date="${today}" hidden></span>
    <section class="day-head fade-up" style="--i:0">
      <div>
        <h1>${esc(t.plan.title)}</h1>
        <p class="muted small">${esc(t.plan.hint)}</p>
      </div>
      <a class="btn ghost" href="/">${esc(t.today.backToday)}</a>
    </section>
    <section class="card fade-up" style="--i:1">
      <ul class="plan-list">${rows}</ul>
      <p class="muted small plan-foot">${esc(t.plan.savedHint)}</p>
    </section>`,
  });
}

/* ---------------- 目标 ---------------- */

export function goalsPage({ topGoals, childrenByParent, milestonesByGoal, statsByGoal, blockerCounts, tasks, allGoals, done = [], completedGoal = null, pausedTasks = [] }, lang = 'zh') {
  const t = pick(lang);
  const doneIds = new Set(done.map((g) => g.id));
  const doneShown = done.filter((g) => !g.parent_id || !doneIds.has(g.parent_id));

  const cards = topGoals
    .map((g, i) => {
      const ms = milestonesByGoal[g.id] || [];
      const st = statsByGoal[g.id] || { done: 0, total: 0 };
      const left = g.target_date ? Math.round((new Date(g.target_date) - new Date()) / 86400000) : null;
      const leftText =
        left === null
          ? t.goals.noDeadline
          : left >= 0
            ? p(lang, left, t.goals.daysLeft, t.goals.daysLeft1, t.goals.daysLeft, { n: left })
            : p(lang, -left, t.goals.overdue, t.goals.overdue1, t.goals.overdue, { n: -left });
      const kids = childrenByParent[g.id] || [];

      const kidsBlock = `<div class="sub-goals">
        <div class="sub-head"><span class="muted small">${esc(fmt(t.goals.subGoals, { n: kids.length }))}</span></div>
        ${
          kids.length
            ? `<ul class="sub-list">${kids
                .map((k) => subGoalRow(k, statsByGoal[k.id] || { done: 0, total: 0 }, blockerCounts.get(k.id) || 0, t, lang))
                .join('')}</ul>`
            : `<p class="empty" style="padding:4px 0">${esc(t.goals.subEmpty)}</p>`
        }
        <form method="post" action="/goal/add" class="row-form tight">
          <input type="hidden" name="parent_id" value="${g.id}">
          <input name="title" placeholder="${esc(t.goals.addSub)}" required>
          <button class="btn ghost">${esc(t.common.add)}</button>
        </form>
      </div>`;

      return `<section class="card fade-up goal-card" style="--i:${i}" data-goal-id="${g.id}">
        <div class="card-head">
          <h2 class="goal-title">
            <span class="drag-handle" draggable="true" role="button" tabindex="0"
                  aria-label="${esc(t.goals.dragHint)}" title="${esc(t.goals.dragHint)}">⠿</span><a href="/goal/${g.id}" class="goal-link" title="${esc(g.title)}">${esc(g.title)}</a>
            <span class="goal-move">
              <button type="button" class="tool-btn" data-goal-move="-1" data-id="${g.id}" title="${esc(t.goals.moveUp)}" aria-label="${esc(t.goals.moveUp)}">↑</button>
              <button type="button" class="tool-btn" data-goal-move="1" data-id="${g.id}" title="${esc(t.goals.moveDown)}" aria-label="${esc(t.goals.moveDown)}">↓</button>
            </span>
          </h2>
          <span class="muted small">${esc(leftText)}</span>
        </div>
        ${g.why ? `<p class="why">${esc(g.why)}</p>` : ''}
        ${progressBar(st.done, st.total)}
        <p class="muted small">${st.total ? esc(p(lang, st.total, t.goals.milestones, t.goals.milestoneOne, t.goals.milestones, { done: st.done, total: st.total })) : esc(t.goals.noMilestones)}</p>
        <ul class="ms-list">${ms.map(milestoneRow).join('')}</ul>
        <form method="post" action="/milestone/add" class="row-form">
          <input type="hidden" name="goal_id" value="${g.id}">
          <input name="title" placeholder="${esc(t.today.addMilestone)}" required>
          <button class="btn ghost">${esc(t.common.add)}</button>
        </form>
        ${kidsBlock}
        <div class="card-foot">
          <form method="post" action="/goal/delete">
            <input type="hidden" name="id" value="${g.id}">
            <button class="link-btn danger">${esc(t.goals.deleteLink)}</button>
          </form>
          <form method="post" action="/goal/complete">
            <input type="hidden" name="id" value="${g.id}">
            <button class="link-btn">${esc(t.goals.complete)}</button>
          </form>
        </div>
      </section>`;
    })
    .join('');

  const taskList = tasks.length
    ? tasks
        .map(
          (x) => `<li class="check-item">
            <span class="check-title" title="${esc(x.title)}">${esc(x.title)}</span>
            <span class="muted small">${esc(x.goal_title || t.goals.ungrouped)}</span>
            <span class="muted small">${x.cadence === 'weekly' ? esc(fmt(t.goals.weeklyN, { n: x.target_per_week })) : esc(t.goals.daily)}</span>
            <form method="post" action="/task/remove" class="inline">
              <input type="hidden" name="id" value="${x.id}">
              <button class="link-btn">${esc(t.goals.pause)}</button>
            </form>
            <form method="post" action="/task/delete" class="inline" data-del-title="${esc(x.title)}">
              <input type="hidden" name="id" value="${x.id}">
              <button type="button" class="link-btn danger" data-del-btn>${esc(t.common.deleted)}</button>
            </form>
          </li>`
        )
        .join('')
    : `<li class="empty">${esc(t.goals.tasksEmpty)}</li>`;

  return layout({
    lang,
    title: t.goals.title,
    active: '/goals',
    body: `
    <section class="day-head fade-up" style="--i:0">
      <div>
        <h1>${esc(t.goals.title)}</h1>
        <p class="muted small">${esc(t.goals.hint)}</p>
      </div>
    </section>
    ${completedGoal
      ? `<div class="flash fade-up" style="--i:0">
           <span class="flash-main">${esc(fmt(t.goals.completedFlash, { title: completedGoal.title }))}</span>
           <span class="flash-sub">${esc(t.goals.completedFlashHint)}</span>
         </div>`
      : ''}
    <div class="grid">
      <div class="col-main">
        ${cards || `<section class="card fade-up">${emptyState(t.goals.empty)}</section>`}
        <section class="card fade-up" style="--i:9">
          <h2>${esc(t.goals.newGoal)}</h2>
          <form method="post" action="/goal/add" class="stack" style="margin-top:12px">
            <input name="title" placeholder="${esc(t.goals.goalName)}" required>
            <input name="why" placeholder="${esc(t.goals.why)}">
            <label class="field"><span class="muted small">${esc(t.goals.parentLabel)}</span>
              <select name="parent_id">
                <option value="">${esc(t.goals.parentNone)}</option>
                ${topGoals.map((g) => `<option value="${g.id}">${esc(g.title)}</option>`).join('')}
              </select>
            </label>
            <label class="field"><span class="muted small">${esc(t.goals.deadline)}</span><input name="target_date" type="date"></label>
            <button class="btn primary">${esc(t.common.create)}</button>
          </form>
        </section>
        ${doneShown.length
          ? `<section class="card fade-up done-card" style="--i:10">
               <div class="card-head">
                 <h2>${esc(t.goals.doneTitle)}</h2>
                 <span class="muted small">${esc(fmt(t.goals.doneCount, { n: doneShown.length }))}</span>
               </div>
               <div class="done-slogan">
                 <p class="done-slogan-main">${esc(t.goals.doneSlogan)}</p>
                 <p class="done-slogan-sub">${esc(t.goals.doneSloganSub)}</p>
               </div>
               <ul class="check-list done-list">
                 ${doneShown
                   .map(
                     (g) => `<li class="check-item done">
                       <span class="tick on small">✓</span>
                       <span class="check-title" title="${esc(g.title)}">${esc(g.title)}</span>
                       ${g.done_at ? `<span class="muted small done-date">${esc(fmt(t.goals.doneOn, { date: prettyDate(String(g.done_at).slice(0, 10), lang) }))}</span>` : ''}
                       <form method="post" action="/goal/reopen" class="inline">
                         <input type="hidden" name="id" value="${g.id}">
                         <button class="link-btn">${esc(t.goals.reopen)}</button>
                       </form>
                     </li>`
                   )
                   .join('')}
               </ul>
             </section>`
          : ''}
      </div>
      <aside class="col-side">
        <section class="card fade-up" style="--i:1">
          <h2>${esc(t.goals.tasks)}</h2>
          <p class="muted small" style="margin:2px 0 0">${esc(t.goals.tasksHint)}</p>
          <ul class="check-list">${taskList}</ul>
          ${pausedTasks.length
            ? `<details class="resolved-box"><summary class="muted small">${esc(fmt(t.goals.pausedTitle, { n: pausedTasks.length }))}</summary>
                 <ul class="check-list">
                   ${pausedTasks
                     .map(
                       (x) => `<li class="check-item">
                         <span class="check-title" title="${esc(x.title)}">${esc(x.title)}</span>
                         <span class="muted small">${esc(x.goal_title || t.goals.ungrouped)}</span>
                         ${x.paused_by_goal ? `<span class="week-chip">${esc(t.goals.pausedByGoal)}</span>` : ''}
                         <form method="post" action="/task/restore" class="inline">
                           <input type="hidden" name="id" value="${x.id}">
                           <button class="link-btn">${esc(t.goals.restore)}</button>
                         </form>
                       </li>`
                     )
                     .join('')}
                 </ul>
               </details>`
            : ''}
          <form method="post" action="/task/add" class="stack" style="margin-top:12px">
            <input name="title" placeholder="${esc(t.goals.taskName)}" required>
            <div class="row">
              <select name="goal_id">
                <option value="">${esc(t.goals.taskGoalNone)}</option>
                ${allGoals
                  .map((g) => `<option value="${g.id}">${g.parent_id ? '　└ ' : ''}${esc(g.title)}</option>`)
                  .join('')}
              </select>
              <input name="unit" placeholder="${esc(t.goals.taskUnit)}" class="tiny">
            </div>
            <div class="row">
              <select name="cadence">
                <option value="daily">${esc(t.goals.cadenceDaily)}</option>
                <option value="weekly">${esc(t.goals.cadenceWeekly)}</option>
              </select>
              <input name="target_per_week" type="number" min="1" max="7" value="3"
                     class="tiny" placeholder="${esc(t.goals.perWeek)}" style="display:none">
            </div>
            <p class="muted small form-hint">${esc(t.goals.taskHint)}</p>
            <button class="btn ghost">${esc(t.goals.addTask)}</button>
          </form>
        </section>
      </aside>
    </div>`,
  });
}

/* ---------------- 完成目标：一轮确认 ---------------- */

export function completeConfirmPage({ goal, stats, taskCount = 0, blockerCount = 0 }, lang = 'zh') {
  const t = pick(lang);
  const left = Math.max(0, (stats?.total || 0) - (stats?.done || 0));
  return layout({
    lang,
    title: t.goals.completeConfirmTitle,
    active: '/goals',
    body: `
    <section class="confirm-wrap fade-up">
      <p class="kicker muted small">${esc(t.goals.completeConfirmKicker)}</p>
      <h1>${esc(t.goals.completeConfirmTitle)}</h1>
      <div class="confirm-box">
        <p class="confirm-goal">${esc(goal.title)}</p>
        ${goal.why ? `<p class="why">${esc(goal.why)}</p>` : ''}
        <p class="confirm-ms">
          <span>${esc(p(lang, stats?.total || 0, t.goals.completeConfirmMs, t.goals.completeConfirmMs, t.goals.completeConfirmMsMany, { done: stats?.done || 0, total: stats?.total || 0 }))}</span>
          ${left ? `<span class="confirm-warn">· ${esc(p(lang, left, t.goals.completeLeft, t.goals.completeLeftOne, t.goals.completeLeft, { n: left }))}</span>` : ''}
        </p>
        ${stats?.total ? progressBar(stats.done, stats.total) : ''}
        <ul class="confirm-list">
          ${taskCount ? `<li>${esc(p(lang, taskCount, t.goals.completeTasks, t.goals.completeTasksOne, t.goals.completeTasks, { n: taskCount }))}</li>` : ''}
          ${blockerCount ? `<li>${esc(p(lang, blockerCount, t.goals.completeBlockers, t.goals.completeBlockersOne, t.goals.completeBlockers, { n: blockerCount }))}</li>` : ''}
        </ul>
        <p class="muted small confirm-note">${esc(t.goals.completeNote)}</p>
      </div>
      <form method="post" action="/goal/complete" class="confirm-actions">
        <input type="hidden" name="id" value="${goal.id}">
        <input type="hidden" name="confirm" value="1">
        <button class="btn primary">${esc(t.goals.completeYes)}</button>
        <a class="btn ghost" href="/goals">${esc(t.goals.completeNo)}</a>
      </form>
    </section>`,
  });
}

/* ---------------- 删除目标：一轮确认 ---------------- */

export function deleteConfirmPage({ goal, msCount = 0, subCount = 0, taskCount = 0, blockerCount = 0 }, lang = 'zh') {
  const t = pick(lang);
  const line = (n, zhTpl, one, many) => (n ? `<li>${esc(p(lang, n, zhTpl, one, many, { n }))}</li>` : '');
  return layout({
    lang,
    title: t.goals.deleteTitle,
    active: '/goals',
    body: `
    <section class="confirm-wrap fade-up">
      <p class="kicker muted small">${esc(t.goals.deleteKicker)}</p>
      <h1>${esc(t.goals.deleteTitle)}</h1>
      <div class="confirm-box">
        <p class="confirm-goal">${esc(goal.title)}</p>
        ${goal.why ? `<p class="why">${esc(goal.why)}</p>` : ''}
        <ul class="confirm-list">
          ${line(msCount, t.goals.deleteMs, t.goals.deleteMsOne, t.goals.deleteMs)}
          ${line(subCount, t.goals.deleteSubs, t.goals.deleteSubsOne, t.goals.deleteSubs)}
          ${line(taskCount, t.goals.deleteTasks, t.goals.deleteTasksOne, t.goals.deleteTasks)}
          ${line(blockerCount, t.goals.deleteBlockers, t.goals.deleteBlockersOne, t.goals.deleteBlockers)}
        </ul>
        <p class="small confirm-warn hard" style="margin:12px 0 0">${esc(t.goals.deleteWarn)}</p>
      </div>
      <form method="post" action="/goal/delete" class="confirm-actions">
        <input type="hidden" name="id" value="${goal.id}">
        <input type="hidden" name="confirm" value="1">
        <button class="btn danger">${esc(t.goals.deleteYes)}</button>
        <a class="btn ghost" href="/goals">${esc(t.goals.deleteNo)}</a>
      </form>
    </section>`,
  });
}

/* ---------------- 卡点 ---------------- */

const openRow = (b, t, lang) => `<li class="blocker">
  <div class="blocker-main">
    <p class="b-title">${esc(b.title)}</p>
    ${b.detail ? `<p class="b-detail">${esc(b.detail)}</p>` : ''}
    <p class="b-meta muted small">${esc(fmt(t.today.openedAt, { date: prettyDate(String(b.opened_at).slice(0, 10), lang) }))}</p>
  </div>
  <form method="post" action="/blocker/resolve" class="row-form tight">
    <input type="hidden" name="id" value="${b.id}">
    <input name="resolution" placeholder="${esc(t.blockers.resolvePlaceholder)}">
    <button class="btn ghost small">${esc(t.common.save)}</button>
  </form>
</li>`;

const resolvedRow = (b, t) => `<li class="blocker resolved">
  <p class="b-title">${esc(b.title)}</p>
  <p class="b-detail">${esc(b.resolution || t.blockers.noResolution)}</p>
  <div class="b-foot muted small">
    <span>${esc(String(b.resolved_at || '').slice(0, 10))}</span>
    <form method="post" action="/blocker/reopen" class="inline">
      <input type="hidden" name="id" value="${b.id}">
      <button class="link-btn">${esc(t.blockers.reopen)}</button>
    </form>
  </div>
</li>`;

function goalBlockerCard({ goalId, title, items, resolved, href, i, placeholder, parentTitle = null }, t, lang) {
  return `<section class="card fade-up" style="--i:${i}">
    ${parentTitle ? `<p class="kicker muted small">${esc(parentTitle)}</p>` : ''}
    <div class="card-head">
      <h2>${href ? `<a class="goal-link" href="${href}">${esc(title)}</a>` : esc(title)}</h2>
      <span class="muted small">${esc(fmt(t.blockers.openCount, { n: items.length }))}</span>
    </div>
    <ul class="blocker-list">${items.length ? items.map((b) => openRow(b, t, lang)).join('') : `<li class="empty">${esc(t.blockers.none)}</li>`}</ul>
    <form method="post" action="/blocker/add" class="row-form">
      <input type="hidden" name="goal_id" value="${goalId ?? ''}">
      <input name="title" placeholder="${esc(placeholder)}" required>
      <button class="btn ghost">${esc(t.common.save)}</button>
    </form>
    ${resolved.length
      ? `<details class="resolved-box"><summary class="muted small">${esc(fmt(t.blockers.resolvedCount, { n: resolved.length }))}</summary>
           <ul class="blocker-list">${resolved.map((b) => resolvedRow(b, t)).join('')}</ul>
         </details>`
      : ''}
  </section>`;
}

export function blockersPage({ goals, openGroups, resolvedGroups }, lang = 'zh') {
  const t = pick(lang);
  const openBy = new Map(openGroups.filter((g) => g.goal_id).map((g) => [g.goal_id, g.items]));
  const resBy = new Map(resolvedGroups.filter((g) => g.goal_id).map((g) => [g.goal_id, g.items]));
  const ungroupedOpen = openGroups.find((g) => !g.goal_id)?.items || [];
  const ungroupedRes = resolvedGroups.find((g) => !g.goal_id)?.items || [];

  const cards = goals
    .map((g, i) =>
      goalBlockerCard(
        {
          goalId: g.id,
          title: g.title,
          href: `/goal/${g.id}`,
          items: openBy.get(g.id) || [],
          resolved: resBy.get(g.id) || [],
          i,
          placeholder: t.blockers.addPlaceholder,
          parentTitle: g.parent_title || null,
        },
        t,
        lang
      )
    )
    .join('');

  return layout({
    lang,
    title: t.blockers.title,
    active: '/blockers',
    body: `
    <section class="day-head fade-up" style="--i:0">
      <div>
        <h1>${esc(t.blockers.title)}</h1>
        <p class="muted small">${esc(t.blockers.hint)}</p>
      </div>
    </section>
    <div class="grid">
      <div class="col-main">
        ${cards}
        ${goalBlockerCard(
          {
            goalId: '',
            title: t.blockers.ungrouped,
            items: ungroupedOpen,
            resolved: ungroupedRes,
            i: goals.length,
            placeholder: t.blockers.addUngrouped,
          },
          t,
          lang
        )}
      </div>
    </div>`,
  });
}

/* ---------------- 目标详情 ---------------- */

export function goalPage({ goal, parent, children, childStats, childBlockers = [], blockerCounts, milestones, stats, open, resolved, taskStats }, lang = 'zh') {
  const t = pick(lang);
  const left = goal.target_date ? Math.round((new Date(goal.target_date) - new Date()) / 86400000) : null;
  const leftText =
    left === null
      ? t.goals.noDeadline
      : left >= 0
        ? p(lang, left, t.goals.daysLeft, t.goals.daysLeft1, t.goals.daysLeft, { n: left })
        : p(lang, -left, t.goals.overdue, t.goals.overdue1, t.goals.overdue, { n: -left });

  const tasks = taskStats.length
    ? taskStats
        .map(
          (x) => `<li class="check-item">
            <span class="check-title" title="${esc(x.title)}">${esc(x.title)}</span>
            <span class="muted small">${x.cadence === 'weekly' ? esc(fmt(t.goalDetail.thisWeek, { done: x.done_count, target: x.target_per_week })) : esc(fmt(t.goalDetail.last7, { n: x.done_count }))}</span>
          </li>`
        )
        .join('')
    : `<li class="empty">${esc(t.goalDetail.noTasks)}</li>`;

  return layout({
    lang,
    title: goal.title,
    active: '/goals',
    body: `
    <section class="day-head fade-up" style="--i:0">
      <div>
        <p class="muted small">${parent ? `<a href="/goal/${parent.id}" class="crumb">${esc(parent.title)}</a> / ` : ''}<a href="/goals" class="crumb">${esc(t.goalDetail.crumb)}</a> · ${esc(leftText)}${goal.status === 'done' ? ` · <b class="done-tag">${esc(t.goalDetail.doneTag)}</b>` : ''}</p>
        <h1>${esc(goal.title)}</h1>
      </div>
      <div class="head-actions">
        ${goal.status === 'done'
          ? ''
          : `<form method="post" action="/goal/complete" class="inline">
               <input type="hidden" name="id" value="${goal.id}">
               <button class="btn ghost">${esc(t.goals.complete)}</button>
             </form>`}
        <a class="btn ghost" href="/goals">${esc(t.goalDetail.allGoals)}</a>
        <form method="post" action="/goal/delete" class="inline">
          <input type="hidden" name="id" value="${goal.id}">
          <button class="link-btn danger">${esc(t.goals.deleteLink)}</button>
        </form>
      </div>
    </section>
    ${goal.why ? `<p class="why big fade-up" style="--i:0">${esc(goal.why)}</p>` : ''}

    <div class="grid">
      <div class="col-main">
        <section class="card fade-up" style="--i:1">
          <div class="card-head">
            <h2>${esc(t.goalDetail.milestones)}</h2>
            <span class="muted small">${stats.total ? `${stats.done}/${stats.total}` : esc(t.goalDetail.none)}</span>
          </div>
          ${stats.total ? progressBar(stats.done, stats.total) : ''}
          <ul class="ms-list">${milestones.map(milestoneRow).join('')}</ul>
          <form method="post" action="/milestone/add" class="row-form">
            <input type="hidden" name="goal_id" value="${goal.id}">
            <input name="title" placeholder="${esc(t.today.addMilestone)}" required>
            <button class="btn ghost">${esc(t.common.add)}</button>
          </form>
        </section>

        <section class="card fade-up" style="--i:2">
          <div class="card-head">
            <h2>${esc(t.goalDetail.subGoals)}</h2>
            <span class="muted small">${children.length}</span>
          </div>
          ${children.length
            ? `<ul class="sub-list">${children
                .map((k) => subGoalRow(k, childStats[k.id] || { done: 0, total: 0 }, blockerCounts.get(k.id) || 0, t, lang))
                .join('')}</ul>`
            : `<p class="empty" style="padding:4px 0">${esc(t.goalDetail.subEmpty)}</p>`}
          <form method="post" action="/goal/add" class="row-form tight">
            <input type="hidden" name="parent_id" value="${goal.id}">
            <input name="title" placeholder="${esc(t.goalDetail.addSub)}" required>
            <button class="btn ghost">${esc(t.common.add)}</button>
          </form>
        </section>

        <section class="card fade-up" style="--i:3">
          <div class="card-head">
            <h2>${esc(t.goalDetail.blockers)}</h2>
            <span class="muted small">${esc(fmt(t.blockers.openCount, { n: open.length }))}</span>
          </div>
          <ul class="blocker-list">${open.length ? open.map((b) => openRow(b, t, lang)).join('') : `<li class="empty">${esc(t.blockers.none)}</li>`}</ul>
          ${childBlockers.length
            ? `<div class="child-blockers">
                 <p class="kicker muted small">${esc(fmt(t.goalDetail.childBlockers, { n: childBlockers.length }))}</p>
                 <ul class="blocker-list">${childBlockers
                   .map(
                     (b) => `<li class="blocker compact">
                       <p class="b-title"><a href="/goal/${b.child_id}" class="goal-link">${esc(b.title)}</a></p>
                       <p class="b-meta muted small">${esc(fmt(t.goalDetail.from, { title: b.child_title }))}</p>
                     </li>`
                   )
                   .join('')}</ul>
               </div>`
            : ''}
          <form method="post" action="/blocker/add" class="row-form">
            <input type="hidden" name="goal_id" value="${goal.id}">
            <input name="title" placeholder="${esc(t.goalDetail.addBlocker)}" required>
            <button class="btn ghost">${esc(t.common.save)}</button>
          </form>
          ${resolved.length
            ? `<details class="resolved-box" open><summary class="muted small">${esc(fmt(t.blockers.resolvedCount, { n: resolved.length }))}</summary>
                 <ul class="blocker-list">${resolved.map((b) => resolvedRow(b, t)).join('')}</ul>
               </details>`
            : ''}
        </section>
      </div>

      <aside class="col-side">
        <section class="card fade-up" style="--i:1">
          <h2>${esc(t.goalDetail.tasks)}</h2>
          <ul class="check-list" style="margin-top:8px">${tasks}</ul>
        </section>
      </aside>
    </div>`,
  });
}

/* ---------------- 时间线 ---------------- */

export function timelinePage({ days, entries, activity }, lang = 'zh') {
  const t = pick(lang);
  // 首格补齐到「周日」，否则每一行不是同一个星期几，竖着看不出来规律
  const [fy, fm, fd] = String(days[0] || '').split('-').map(Number);
  const lead = days.length ? new Date(fy, fm - 1, fd).getDay() : 0;
  const todayIso = days[days.length - 1];
  // 一条记录都还没有的那些日子不算「漏」，否则新用户一打开就是一屏黄
  const firstActive = [...activity.keys()].sort()[0] || todayIso;
  const cells = days
    .map((date) => {
      const a = activity.get(date);
      const lvl = !a ? 0 : Math.min(3, a.checks === 0 ? 0 : a.checks);
      // 过去的日子没打卡 → 黄色「可补」，不用红，别让人每天看见一片失败
      const missed = date >= firstActive && date < todayIso && !(a?.checks > 0) && !a?.hasEntry;
      const cls = [
        'cell',
        lvl ? `lvl${lvl}` : '',
        a?.hasEntry ? 'has-entry' : '',
        missed ? 'missed' : '',
        date === todayIso ? 'is-today' : '',
      ].join(' ');
      const tip = [date];
      if (a) tip.push(fmt(t.timeline.tipChecks, { n: a.checks }));
      if (a?.hasEntry) tip.push(t.timeline.tipEntry);
      if (missed) tip.push(t.timeline.tipMissed);
      return `<a class="${cls}" href="/?d=${date}" title="${esc(tip.join(' · '))}"></a>`;
    })
    .join('');

  const list = entries.length
    ? entries
        .map(
          (e, i) => `<article class="entry fade-up" style="--i:${i}">
            <header><span class="entry-date">${esc(prettyDate(e.date, lang))}</span><span class="muted small">${weekdayOf(e.date, lang)}</span></header>
            ${e.did ? `<p>${esc(e.did)}</p>` : ''}
            ${e.next_step ? `<p class="muted small">${esc(fmt(t.timeline.nextStep, { text: e.next_step }))}</p>` : ''}
          </article>`
        )
        .join('')
    : emptyState(t.timeline.empty);

  return layout({
    lang,
    title: t.timeline.title,
    active: '/timeline',
    body: `
    <section class="day-head fade-up" style="--i:0">
      <div>
        <h1>${esc(t.timeline.title)}</h1>
        <p class="muted small">${esc(t.timeline.hint)}</p>
      </div>
      <div class="head-actions">
        <a class="btn ghost" href="/export?days=7">${esc(t.timeline.export)}</a>
        <a class="btn ghost" href="/export?days=30">${esc(t.timeline.export30)}</a>
      </div>
    </section>
    <section class="card fade-up" style="--i:1">
      <div class="heat-wrap">
        <div class="heat-dow">${(lang === 'en' ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['日', '一', '二', '三', '四', '五', '六']).map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="heat">${'<span class="cell blank"></span>'.repeat(lead)}${cells}</div>
      </div>
      <div class="legend muted small"><span class="cell"></span>${esc(t.timeline.legendNone)} <span class="cell missed"></span>${esc(t.timeline.legendMissed)} <span class="cell lvl1"></span><span class="cell lvl2"></span><span class="cell lvl3"></span> ${esc(t.timeline.legendMore)} <span class="cell has-entry"></span> ${esc(t.timeline.legendEntry)}</div>
    </section>
    <section class="entries">${list}</section>`,
  });
}

/* ---------------- 登录 ---------------- */

export function loginPage({ error = '', next = '/' }, lang = 'zh') {
  const t = pick(lang);
  return layout({
    lang,
    title: t.login.title,
    minimal: true,
    body: `
    <section class="login-wrap fade-up">
      <h1>${esc(t.brand)}</h1>
      <p class="muted small">${esc(t.login.hint)}</p>
      <form method="post" action="/login" class="stack" style="margin-top:18px">
        <input type="hidden" name="next" value="${esc(next)}">
        <input type="password" name="password" placeholder="${esc(t.login.placeholder)}" autofocus required
               autocomplete="current-password" enterkeyhint="go">
        <button class="btn primary">${esc(t.common.enter)}</button>
        ${error ? `<p class="err small">${esc(error)}</p>` : ''}
      </form>
    </section>`,
  });
}

/* ---------------- 怎么用 ---------------- */

export function helpPage(lang = 'zh') {
  const t = pick(lang);
  return layout({
    lang,
    title: t.help.title,
    active: '/help',
    body: `
    <section class="day-head fade-up" style="--i:0">
      <div>
        <h1>${esc(t.help.title)}</h1>
        <p class="muted small">${esc(t.help.lead)}</p>
      </div>
    </section>

    <div class="help-grid">
      <section class="card fade-up" style="--i:1">
        <h2>${esc(t.help.dailyTitle)}</h2>
        <ol class="steps-list">
          <li>${esc(t.help.daily1)}</li>
          <li>${esc(t.help.daily2)}<b>${esc(t.help.daily2b)}</b></li>
          <li>${esc(t.help.daily3)}</li>
          <li>${esc(t.help.daily4)}</li>
          <li>${esc(t.help.daily5)}</li>
        </ol>
      </section>

      <section class="card fade-up" style="--i:2">
        <h2>${esc(t.help.splitTitle)}</h2>
        <ul class="steps-list">
          <li>${esc(t.help.split1)}</li>
          <li>${esc(t.help.split2)}</li>
          <li>${esc(t.help.split3)}</li>
        </ul>
      </section>

      <section class="card fade-up" style="--i:3">
        <h2>${esc(t.help.diffTitle)}</h2>
        <ul class="steps-list">
          <li>${esc(t.help.diff1)}</li>
          <li>${esc(t.help.diff2)}</li>
          <li>${esc(t.help.diff3)}</li>
          <li>${esc(t.help.diff4)}</li>
        </ul>
      </section>

      <section class="card fade-up" style="--i:4">
        <h2>${esc(t.help.blockerTitle)}</h2>
        <p class="small">${esc(t.help.blocker1)}</p>
        <p class="small">${esc(t.help.blocker2)}</p>
      </section>

      <section class="card fade-up" style="--i:5">
        <h2>${esc(t.help.reviewTitle)}</h2>
        <p class="small">${esc(t.help.review1)}</p>
        <p class="small">${esc(t.help.review2)}</p>
      </section>

      <section class="card fade-up" style="--i:6">
        <h2>${esc(t.help.dataTitle)}</h2>
        <p class="small">${esc(t.help.data1)}</p>
        <p class="small">${esc(t.help.data2)}</p>
      </section>
    </div>`,
  });
}

/* ---------------- 404 ---------------- */

export function notFoundPage(lang = 'zh') {
  const t = pick(lang);
  return layout({
    lang,
    title: '404',
    body: `<p class="empty">${esc(t.err.notFound)} <a href="/">${esc(t.err.backHome)}</a></p>`,
  });
}
