// 服务端：node:http + node:sqlite，零依赖
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as D from './db.mjs';
import * as V from './views.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';

/* ---------------- 口令保护（可选）----------------
   优先级：环境变量 APP_PASSWORD > 同目录下 password.txt > 不设（进入即用） */
let APP_PASSWORD = process.env.APP_PASSWORD || '';
if (!APP_PASSWORD) {
  const pwFile = path.join(ROOT, 'password.txt');
  if (fs.existsSync(pwFile)) APP_PASSWORD = fs.readFileSync(pwFile, 'utf8').trim();
}

// 另一种更省事的保护：入口路径里带密钥，进来后种 cookie，不用输口令
let APP_SECRET = process.env.APP_SECRET || '';
if (!APP_SECRET) {
  const secretFile = path.join(ROOT, 'secret.txt');
  if (fs.existsSync(secretFile)) APP_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
}

const COOKIE = 'sl_auth';
const CREDENTIAL = APP_PASSWORD || APP_SECRET;
const AUTH_TOKEN = CREDENTIAL
  ? crypto.createHmac('sha256', CREDENTIAL).update('study-log-v1').digest('hex')
  : '';

/** decodeURIComponent 遇到畸形编码会抛错，而 Cookie 是外部可控的：
 *  以前一行 `Cookie: sl_lang=%E0%A4%A` 就能把整个进程打挂 */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseCookies(req) {
  const out = {};
  const header = String(req.headers.cookie || '');
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      if (k) out[k] = safeDecode(part.slice(i + 1).trim());
    }
  }
  return out;
}

function isAuthed(req) {
  if (!AUTH_TOKEN) return true;   // 既没设口令也没设密钥：本地直接进
  const c = parseCookies(req)[COOKIE];
  if (!c) return false;
  const a = Buffer.from(c);
  const b = Buffer.from(AUTH_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 定长比较，别让响应时间透露密钥对了几位 */
function secretMatch(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
}

/* ---------------- 语言 ---------------- */
const LANG_COOKIE = 'sl_lang';

function langOf(req) {
  const v = parseCookies(req)[LANG_COOKIE];
  return v === 'en' ? 'en' : 'zh';
}

// 简单的登录失败限流：同一 IP 10 分钟内最多 10 次
const attempts = new Map();
function loginBlocked(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, t: now };
  if (now - rec.t > 600000) { rec.n = 0; rec.t = now; }
  attempts.set(ip, rec);
  return rec.n >= 10;
}
function noteFail(ip) {
  const rec = attempts.get(ip) || { n: 0, t: Date.now() };
  rec.n += 1;
  attempts.set(ip, rec);
  // 这个 Map 只增不减的话，被扫久了会一直涨
  if (attempts.size > 2000) {
    const now = Date.now();
    for (const [k, v] of attempts) if (now - v.t > 600000) attempts.delete(k);
    if (attempts.size > 2000) attempts.clear();
  }
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* ---------------- 工具 ---------------- */

const BASE_HOST = 'http://localhost';
const MAX_BODY = 512 * 1024;      // 表单/JSON 上限，防止一个超大请求把内存吃干
const MAX_TITLE = 200;            // 目标/任务/里程碑/卡点标题上限
const MAX_NOTE = 8000;            // 日记、计划这类长文本上限

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
  // 页面里没有内联脚本了，脚本只能来自本站；样式仍允许内联（模板里有 style="--i:n"）
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { ...DEFAULT_HEADERS, 'Content-Type': type });
  res.end(body);
}

function redirect(res, to = '/') {
  res.writeHead(303, { ...DEFAULT_HEADERS, Location: to });
  res.end();
}

/** 请求行是外部输入：畸形 Host / 绝对形式 URL 都会让 new URL 抛错 */
function urlOf(req) {
  try {
    return new URL(req.url || '/', BASE_HOST);
  } catch {
    return new URL('/', BASE_HOST);
  }
}

/** 只允许回到本站路径，挡掉 `//evil.com`、`http://evil.com` 这类跳转 */
function safeBack(v, host) {
  const s = String(v ?? '').trim();
  if (!s) return '/';
  let base;
  try {
    base = new URL(`http://${host || 'localhost'}`);
  } catch {
    return '/';
  }
  let u;
  try {
    u = new URL(s, base);
  } catch {
    return '/';
  }
  if (u.origin !== base.origin) return '/';
  return u.pathname + u.search;
}

/** 浏览器发起的跨站表单带不上自定义头、也读不到响应，但能直接 POST 过来：
 *  不校验来源的话，你随手打开的任意网页都能往本机 4321 删目标、改记录 */
function sameOrigin(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!host) return false;
  const check = (raw) => {
    try {
      return new URL(String(raw)).host.toLowerCase() === host;
    } catch {
      return false;
    }
  };
  const origin = req.headers.origin;
  if (origin !== undefined) return check(origin);
  const referer = req.headers.referer;
  if (referer !== undefined) return check(referer);
  return true;   // 命令行 / 脚本没有这两个头，放行
}

/** 本机服务的 Host 白名单：挡 DNS rebinding
 *  （把 evil.com 解析到 127.0.0.1，再用浏览器当跳板读你的记录） */
const HOST_ALLOW_ANY = process.env.ALLOW_ANY_HOST === '1';
const SELF_HOSTNAME = os.hostname().toLowerCase();

function hostAllowed(req) {
  if (HOST_ALLOW_ANY) return true;
  const raw = String(req.headers.host || '').toLowerCase();
  if (!raw) return true;                       // HTTP/1.0 之类没带 Host
  const name = raw.replace(/:\d+$/, '');
  if (!name) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (name === SELF_HOSTNAME || name === `${SELF_HOSTNAME}.local`) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;          // IPv4 字面量
  if (name.startsWith('[') || name.includes(':')) return true;    // IPv6 字面量
  return !name.includes('.');                                     // 局域网机器名
}

function clampText(v, max = MAX_TITLE) {
  // 控制字符（除了换行、制表）会在页面上显示成空心方块，直接剔掉
  return String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

/** 数量框可以是空的，但不能是 NaN / 负数 / 天文数字 */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1e6, Math.max(0, Math.round(n)));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) {
      const err = new Error('body too large');
      err.code = 'E_TOO_LARGE';
      throw err;
    }
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json')) {
    try {
      const v = JSON.parse(raw || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** 只接受真实存在的 YYYY-MM-DD，其余一律回退，避免渲染出「undefined 月」或脏数据 */
function safeDate(v, fallback = D.toISO()) {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return fallback;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(y, mo - 1, d);
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return fallback;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function todayPageData(url, date) {
  const goalId = Number(url.searchParams.get('goal') || 0);
  const goals = D.listGoals();
  const activeTasks = D.listTasks();
  const checks = D.checksFor(date);
  const checkMap = new Map(checks.map((c) => [c.task_id, c]));
  // 暂停/已完成目标下的任务，如果那天确实打过卡，也要在这天露出来，否则历史记录会凭空消失
  const seen = new Set(activeTasks.map((t) => t.id));
  const tasks = [...activeTasks];
  // 那天实际打过卡、但任务现在已暂停的，也要露出来（不然历史记录会凭空消失）
  for (const c of checks) {
    if (seen.has(c.task_id)) continue;
    seen.add(c.task_id);
    tasks.push({
      id: c.task_id,
      title: c.title,
      unit: c.unit,
      cadence: c.cadence,
      target_per_week: c.target_per_week,
      active: c.active,
    });
  }
  // 看过去的日子时，把暂停中的任务也摆出来，否则「补打卡」无从下手
  if (date < D.toISO()) {
    for (const p of D.listPausedTasks()) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      tasks.push(p);
    }
  }
  const currentGoal = goalId ? D.getGoal(goalId) : goals[0] || null;
  const milestones = currentGoal ? D.listMilestones(currentGoal.id) : [];
  const stats = currentGoal ? D.milestoneStats(currentGoal.id) : { done: 0, total: 0 };
  const allOpen = D.listBlockers('open');
  return {
    date,
    isToday: date === D.toISO(),
    entry: D.getEntry(date),
    // 昨天那句「明天的第一件事」，今天必须提醒到人，否则写了等于没写
    prevEntry: D.getEntry(D.shiftISO(date, -1)),
    todayPlan: D.getPlan(date)?.note || '',
    tomorrowPlan: D.getPlan(D.shiftISO(date, 1))?.note || '',
    justSaved: url.searchParams.get('saved') === '1',
    tasks,
    checks,
    checkMap,
    openBlockers: currentGoal ? allOpen.filter((b) => b.goal_id === currentGoal.id) : allOpen,
    otherBlockerCount: currentGoal ? allOpen.filter((b) => b.goal_id !== currentGoal.id).length : 0,
    goals,
    currentGoal,
    milestones,
    stats,
    weekCounts: D.weekCheckCounts(date),
  };
}

/* ---------------- 路由 ---------------- */

const server = http.createServer(async (req, res) => {
  const url = urlOf(req);
  const p = url.pathname;
  const method = req.method || 'GET';
  let lang = 'zh';

  try {
    lang = langOf(req);

    if (!hostAllowed(req)) {
      return send(res, 403, V.notFoundPage(lang));
    }
    const langMatch = p.match(/^\/lang\/(zh|en)$/);
    if (method === 'GET' && langMatch) {
      let back = '/';
      try {
        const ref = new URL(req.headers.referer || '/', 'http://localhost');
        back = ref.pathname + ref.search;
      } catch { back = '/'; }
      res.writeHead(303, {
        Location: back,
        'Set-Cookie': `${LANG_COOKIE}=${langMatch[1]}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
      });
      return res.end();
    }

    /* --- 静态资源 --- */
    if (method === 'GET' && (p === '/style.css' || p === '/client.js')) {
      const file = path.join(PUBLIC, path.basename(p));
      if (fs.existsSync(file)) {
        return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'text/plain');
      }
    }

    /* --- 登录 --- */
    // 站内跳转：`//evil.com`、`/\evil.com` 都挡掉，别把登录页变成跳板
    const safeNext = (n) => safeBack(n, req.headers.host);

    if (method === 'GET' && p === '/login') {
      if (!APP_PASSWORD) return send(res, 404, V.notFoundPage(lang));
      if (isAuthed(req)) return redirect(res, safeNext(url.searchParams.get('next')));
      return send(res, 200, V.loginPage({ error: '', next: safeNext(url.searchParams.get('next')) }, lang));
    }

    if (method === 'POST' && p === '/login') {
      if (!APP_PASSWORD) return send(res, 404, V.notFoundPage(lang));
      const ip = req.socket.remoteAddress || '';
      if (loginBlocked(ip)) {
        return send(res, 429, V.loginPage({ error: lang === 'en' ? 'Too many attempts. Try again in ten minutes.' : '试错太多次，过十分钟再来。', next: '/' }, lang));
      }
      const body = await readBody(req);
      const nextUrl = safeNext(body.next);
      if (secretMatch(String(body.password || ''), APP_PASSWORD)) {
        const maxAge = 60 * 60 * 24 * 30;
        res.writeHead(303, {
          Location: nextUrl,
          'Set-Cookie': `${COOKIE}=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`,
        });
        return res.end();
      }
      noteFail(ip);
      return send(res, 401, V.loginPage({ error: lang === 'en' ? 'Wrong passphrase.' : '口令不对。', next: nextUrl }, lang));
    }

    if (method === 'GET' && p === '/logout') {
      res.writeHead(303, { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` });
      return res.end();
    }

    // 入口密钥：/s/<密钥> 进来一次，种 cookie 后正常使用
    if (method === 'GET' && p.startsWith('/s/')) {
      const given = safeDecode(p.slice(3));
      if (APP_SECRET && secretMatch(given, APP_SECRET)) {
        const maxAge = 60 * 60 * 24 * 180;
        res.writeHead(303, {
          Location: '/',
          'Set-Cookie': `${COOKIE}=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`,
        });
        return res.end();
      }
      return send(res, 404, V.notFoundPage(lang));
    }

    // 设了保护但没通过：口令模式跳登录页，密钥模式直接 404（不暴露这里有什么）
    if (AUTH_TOKEN && !isAuthed(req)) {
      if (APP_PASSWORD) return redirect(res, `/login?next=${encodeURIComponent(p)}`);
      return send(res, 404, V.notFoundPage(lang));
    }

    /* --- 页面 --- */
    if (method === 'GET' && p === '/') {
      const date = safeDate(url.searchParams.get('d'));
      return send(res, 200, V.todayPage(todayPageData(url, date), lang));
    }

    if (method === 'GET' && p === '/goals') {
      const allGoals = D.listGoals();
      const topGoals = D.listTopGoals();
      const childrenByParent = {};
      const milestonesByGoal = {};
      const statsByGoal = {};
      for (const g of allGoals) {
        milestonesByGoal[g.id] = D.listMilestones(g.id);
        statsByGoal[g.id] = D.milestoneStats(g.id);
        if (g.parent_id) (childrenByParent[g.parent_id] ||= []).push(g);
      }
      const doneId = Number(url.searchParams.get('done') || 0);
      const justDone = doneId ? D.getGoal(doneId) : null;
      return send(
        res,
        200,
        V.goalsPage({
          topGoals,
          childrenByParent,
          milestonesByGoal,
          statsByGoal,
          blockerCounts: D.openBlockerCounts(),
          tasks: D.listTasks(),
          allGoals,
          done: D.listDoneGoals(),
          pausedTasks: D.listPausedTasks(),
          completedGoal: justDone && justDone.status === 'done' ? justDone : null,
        }, lang)
      );
    }

    if (method === 'GET' && p === '/blockers') {
      const titleById = new Map(D.listGoals().map((g) => [g.id, g.title]));
      const goals = D.listGoals().map((g) => ({
        ...g,
        parent_title: g.parent_id ? titleById.get(g.parent_id) : null,
      }));
      return send(
        res,
        200,
        V.blockersPage({
          goals,
          openGroups: D.blockersGrouped('open'),
          resolvedGroups: D.blockersGrouped('resolved'),
        }, lang)
      );
    }

    const goalMatch = p.match(/^\/goal\/(\d+)$/);
    if (method === 'GET' && goalMatch) {
      const goal = D.getGoal(goalMatch[1]);
      if (!goal) return send(res, 404, V.notFoundPage(lang));
      const since = D.toISO(new Date(Date.now() - 6 * 86400000));
      const children = D.listSubGoals(goal.id);
      const childStats = {};
      const childBlockers = [];
      for (const c of children) {
        childStats[c.id] = D.milestoneStats(c.id);
        for (const b of D.blockersForGoal(c.id, 'open')) {
          childBlockers.push({ ...b, child_id: c.id, child_title: c.title });
        }
      }
      return send(
        res,
        200,
        V.goalPage({
          goal,
          parent: goal.parent_id ? D.getGoal(goal.parent_id) : null,
          children,
          childStats,
          childBlockers,
          blockerCounts: D.openBlockerCounts(),
          milestones: D.listMilestones(goal.id),
          stats: D.milestoneStats(goal.id),
          open: D.blockersForGoal(goal.id, 'open'),
          resolved: D.blockersForGoal(goal.id, 'resolved'),
          taskStats: D.taskStatsForGoal(goal.id, since),
        }, lang)
      );
    }

    if (method === 'GET' && p === '/plan') {
      const today = D.toISO();
      const days = [];
      for (let i = 0; i < 7; i++) days.push(D.shiftISO(today, i));
      const notes = new Map(D.plansBetween(days[0], days[6]).map((r) => [r.date, r.note]));
      return send(res, 200, V.planPage({ days, notes }, lang));
    }

    if (method === 'GET' && p === '/help') {
      return send(res, 200, V.helpPage(lang));
    }

    if (method === 'GET' && p === '/timeline') {
      const today = D.toISO();
      const days = [];
      for (let i = 69; i >= 0; i--) {
        days.push(D.toISO(new Date(Date.now() - i * 86400000)));
      }
      const activity = D.activitySince(days[0]);
      return send(res, 200, V.timelinePage({ days, entries: D.recentEntries(12), activity }, lang));
    }

    if (method === 'GET' && (p === '/m' || p === '/mobile')) {
      // 手机与电脑共用同一个页面，旧链接直接跳回去
      return redirect(res, '/');
    }

    if (method === 'GET' && p === '/export') {
      const raw = Number(url.searchParams.get('days') || 7);
      const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.trunc(raw))) : 7;
      const to = D.toISO();
      const from = D.toISO(new Date(Date.now() - (days - 1) * 86400000));
      const { entries, checks, blockers } = D.exportRange(from, to);
      return send(res, 200, buildMarkdown({ from, to, entries, checks, blockers }, lang), 'text/markdown; charset=utf-8');
    }

    /* --- 表单提交 --- */
    if (method === 'POST') {
      // 跨站请求一律拒绝：否则任何网页都能偷偷 POST 过来改数据
      if (!sameOrigin(req)) {
        return send(res, 403, V.notFoundPage(lang));
      }
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        if (err.code === 'E_TOO_LARGE') {
          return send(res, 413, 'Payload too large', 'text/plain; charset=utf-8');
        }
        throw err;
      }
      const back = safeBack(body.back || req.headers.referer || '/', req.headers.host);

      switch (p) {
        case '/entry': {
          D.saveEntry({
            date: safeDate(body.date),
            did: clampText(body.did, MAX_NOTE),
            next_step: clampText(body.next_step, 300),
          });
          // 保存后回到原页面并带上标记，否则用户按了保存没有任何反馈
          let to = back;
          try {
            const u = new URL(back, BASE_HOST);
            u.searchParams.set('saved', '1');
            to = u.pathname + u.search;
          } catch { to = '/'; }
          return redirect(res, to);
        }

        case '/task/add': {
          const title = clampText(body.title);
          if (title) {
            // 目标可能刚在别的标签页被删掉，挂不上就退回「不挂目标」，不要 500
            const gid = body.goal_id && D.getGoal(body.goal_id) ? Number(body.goal_id) : null;
            const perWeek = Math.min(50, Math.max(1, Number(body.target_per_week) || 7));
            D.addTask({
              title,
              goal_id: gid,
              cadence: body.cadence === 'weekly' ? 'weekly' : 'daily',
              unit: clampText(body.unit, 12),
              target_per_week: perWeek,
            });
          }
          return redirect(res, back);
        }

        case '/task/remove':
          D.deactivateTask(body.id);
          return redirect(res, back);

        case '/task/restore':
          D.activateTask(body.id);
          return redirect(res, back);

        case '/task/delete':
          D.deleteTask(body.id);
          return redirect(res, back);

        case '/blocker/add': {
          const title = clampText(body.title);
          if (title) {
            const gid = body.goal_id && D.getGoal(body.goal_id) ? Number(body.goal_id) : null;
            D.addBlocker({
              title,
              detail: clampText(body.detail, 2000),
              goal_id: gid,
            });
          }
          return redirect(res, back);
        }

        case '/blocker/resolve':
          D.resolveBlocker(body.id, clampText(body.resolution, 2000));
          return redirect(res, back);

        case '/blocker/reopen':
          D.reopenBlocker(body.id);
          return redirect(res, back);

        case '/milestone/add': {
          const title = clampText(body.title);
          if (title && D.getGoal(body.goal_id)) D.addMilestone(Number(body.goal_id), title);
          return redirect(res, back);
        }

        case '/milestone/toggle':
          D.toggleMilestone(body.id);
          return redirect(res, back);

        case '/goal/add': {
          const title = clampText(body.title);
          if (title) {
            // 父目标可能已被另一个标签页删掉，挂不上就当顶层目标，别撞外键
            const pid = body.parent_id && D.getGoal(body.parent_id) ? Number(body.parent_id) : null;
            const due = safeDate(body.target_date, '');
            D.addGoal({
              title,
              why: clampText(body.why, 1000),
              target_date: due || '',
              parent_id: pid,
            });
          }
          return redirect(res, back);
        }

        case '/goal/complete': {
          // 两段式：第一次只出确认页，带 confirm=1 才真的落库
          const goal = D.getGoal(body.id);
          if (!goal) return redirect(res, '/goals');
          if (String(body.confirm || '') !== '1') {
            return send(
              res,
              200,
              V.completeConfirmPage({
                goal,
                stats: D.milestoneStats(goal.id),
                taskCount: D.listTasks().filter((x) => x.goal_id === goal.id).length,
                blockerCount: D.blockersForGoal(goal.id, 'open').length,
              }, lang)
            );
          }
          D.completeGoal(goal.id);
          return redirect(res, `/goals?done=${goal.id}`);
        }

        case '/goal/move':
          if (D.getGoal(body.id)) D.moveGoal(body.id, String(body.dir) === '-1' ? -1 : 1);
          return redirect(res, '/goals');

        case '/goal/delete': {
          const goal = D.getGoal(body.id);
          if (!goal) return redirect(res, '/goals');
          if (String(body.confirm || '') !== '1') {
            const kids = D.listSubGoals(goal.id);
            const ids = [goal.id, ...kids.map((k) => k.id)];
            return send(
              res,
              200,
              V.deleteConfirmPage({
                goal,
                msCount: ids.reduce((n, gid) => n + D.milestoneStats(gid).total, 0),
                subCount: kids.length,
                taskCount: D.listTasks().filter((t) => ids.includes(t.goal_id)).length,
                blockerCount: D.blockersForGoal(goal.id, 'open').length + D.blockersForGoal(goal.id, 'resolved').length,
              }, lang)
            );
          }
          D.deleteGoal(goal.id);
          return redirect(res, '/goals');
        }

        case '/goal/reopen':
          D.reopenGoal(body.id);
          return redirect(res, '/goals');

        /* --- JSON API（供 client.js） --- */
        case '/api/check':
          if (!D.getTask(body.taskId)) {
            return send(res, 400, JSON.stringify({ ok: false, why: 'task gone' }), 'application/json');
          }
          D.setCheck({
            date: safeDate(body.date),
            taskId: Number(body.taskId),
            on: body.on === true || body.on === 'true' || body.on === '1' || body.on === 1,
            amount: numOrNull(body.amount),
          });
          return send(res, 200, JSON.stringify({ ok: true }), 'application/json');

        case '/api/check/amount':
          if (!D.getTask(body.taskId)) {
            return send(res, 400, JSON.stringify({ ok: false, why: 'task gone' }), 'application/json');
          }
          D.setCheckAmount({
            date: safeDate(body.date),
            taskId: Number(body.taskId),
            amount: numOrNull(body.amount),
          });
          return send(res, 200, JSON.stringify({ ok: true }), 'application/json');

        case '/api/plan':
          D.setPlan(safeDate(body.date), clampText(body.note, 300));
          return send(res, 200, JSON.stringify({ ok: true }), 'application/json');

        case '/api/goal/reorder': {
          const ok =
            Array.isArray(body.ids) &&
            body.ids.length <= 500 &&
            D.reorderGoals(body.ids);
          return send(res, ok ? 200 : 400, JSON.stringify({ ok: !!ok }), 'application/json');
        }

        default:
          return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      }
    }

    return send(res, 404, V.notFoundPage(lang));
  } catch (err) {
    // 错误细节只留在终端里，不要回吐给浏览器（路径、SQL、栈都会暴露）
    const id = crypto.randomBytes(4).toString('hex');
    console.error(`[error ${id}]`, req.method, req.url, err);
    if (res.headersSent) {
      try { res.end(); } catch { /* 已经断了就算了 */ }
      return;
    }
    const msg = lang === 'en'
      ? `Something went wrong (error ${id}). Look at the terminal window for details.`
      : `出错了（错误编号 ${id}）。去启动的那个窗口看日志。`;
    return send(res, 500, `<pre>${V.esc(msg)}</pre>`, 'text/html; charset=utf-8');
  }
});

/* ---------------- 导出 Markdown ---------------- */

function buildMarkdown({ from, to, entries, checks, blockers }, lang = 'zh') {
  const en = lang === 'en';
  const W = {
    title: en ? `# Study log (${from} ~ ${to})` : `# 学习记录（${from} ~ ${to}）`,
    empty: en ? '_No entries in this period_' : '_这段时间没有记录_',
    checks: en ? '- Check-ins: ' : '- 打卡：',
    did: en ? '- Log: ' : '- 记录：',
    next: en ? '- Tomorrow first task: ' : '- 明天第一件事：',
    blockers: en ? '## Blockers' : '## 卡点',
    open: en ? '- [open] ' : '- [未解决] ',
    done: en ? '- [resolved] ' : '- [已解决] ',
    noResolution: en ? '(no note on how)' : '（没写解决方式）',
    prompt: en
      ? [
          '---',
          '',
          'Review the notes above and answer in this structure:',
          '1. What actually moved forward this week (summarize, do not repeat)',
          '2. Which milestone stalled, and the likely reason',
          '3. Blockers that keep recurring, and whether they share one root cause',
          '4. What to do next week (no more than 3 items)',
        ]
      : [
          '---',
          '',
          '请基于上面这些记录帮我做一次复盘，按这个结构输出：',
          '1. 这一周实际推进了什么（别复述，归纳）',
          '2. 哪个里程碑明显停滞了，可能的原因',
          '3. 反复出现的卡点，以及它们背后是不是同一个问题',
          '4. 下周具体做什么（不超过 3 条）',
        ],
  };

  const lines = [];
  lines.push(W.title, '');

  const byDate = new Map();
  for (const e of entries) byDate.set(e.date, { ...(byDate.get(e.date) || {}), ...e });
  for (const c of checks) {
    const row = byDate.get(c.date) || { date: c.date, checks: [] };
    row.checks = row.checks || [];
    row.checks.push(`${c.title}${c.amount != null ? ` ${c.amount}${c.unit || ''}` : ''}`);
    byDate.set(c.date, row);
  }

  const dates = [...byDate.keys()].sort();
  if (!dates.length) lines.push(W.empty, '');
  for (const date of dates) {
    const r = byDate.get(date);
    lines.push(`## ${date} ${V.weekdayOf(date, lang)}`);
    if (r.checks?.length) lines.push(`${W.checks}${r.checks.join(' · ')}`);
    if (r.did) lines.push(`${W.did}${r.did}`);
    if (r.next_step) lines.push(`${W.next}${r.next_step}`);
    lines.push('');
  }

  const open = blockers.filter((b) => b.status === 'open');
  const done = blockers.filter((b) => b.status === 'resolved');
  if (blockers.length) {
    lines.push(W.blockers, '');
    for (const b of open) lines.push(`${W.open}${b.title}${b.goal_title ? ` (${b.goal_title})` : ''}`);
    for (const b of done) lines.push(`${W.done}${b.title} → ${b.resolution || W.noResolution}`);
    lines.push('');
  }

  lines.push(...W.prompt);
  return lines.join('\n');
}

/* ---------------- 启动 ---------------- */

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

if (process.argv.includes('--seed')) {
  D.seed();
  process.exit(0);
}

// 单个请求出问题不该带走整个服务：记下来，继续跑
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  端口 ${PORT} 已经被占用了：可能已经开着一个，或者别的程序用了它。`);
    console.error('  关掉重复的那个窗口，或者换个端口启动：');
    console.error(`    set PORT=4322 && node server.mjs`);
    console.error('');
    process.exit(1);
  }
  console.error('[server error]', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  学习记录已启动');
  console.log(`  本机：  http://localhost:${PORT}`);
  for (const ip of lanIPs()) console.log(`  手机：  http://${ip}:${PORT}   （同一 WiFi / 热点）`);
  console.log(`  数据：  ${D.DB_PATH}`);
  console.log(`  口令：  ${APP_PASSWORD ? '已启用（访问需登录）' : '未启用'}`);
  if (APP_SECRET && !APP_PASSWORD) {
    console.log(`  入口：  http://<上面的IP>:${PORT}/s/${APP_SECRET}`);
    console.log('          （直接访问根路径会 404，必须用这个地址进一次）');
  }
  console.log('');

  // 换 WiFi / 开热点后 IP 会变，自动打印新地址
  let last = lanIPs().join(',');
  setInterval(() => {
    const now = lanIPs();
    const key = now.join(',');
    if (key !== last) {
      last = key;
      console.log('  [网络变化] 现在的访问地址：');
      for (const ip of now) console.log(`    http://${ip}:${PORT}/`);
      console.log('');
    }
  }, 5000).unref();
});
