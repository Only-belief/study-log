// 数据层：node:sqlite（Node 22.5+ 内置，无需编译原生模块）
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认锚定到脚本所在目录，这样在任何 cwd 下启动都读写同一个库
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || path.join(HERE, 'data.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS goal (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    why        TEXT DEFAULT '',
    target_date TEXT,
    status     TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS milestone (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id  INTEGER NOT NULL REFERENCES goal(id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    done     INTEGER DEFAULT 0,
    done_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS task (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id        INTEGER REFERENCES goal(id) ON DELETE SET NULL,
    title          TEXT NOT NULL,
    cadence        TEXT DEFAULT 'daily',   -- daily | weekly
    target_per_week INTEGER DEFAULT 7,
    unit           TEXT DEFAULT '',
    active         INTEGER DEFAULT 1,
    created_at     TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS entry (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT UNIQUE NOT NULL,
    did        TEXT DEFAULT '',
    next_step  TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS plan (
    date       TEXT PRIMARY KEY,
    note       TEXT DEFAULT '',
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS check_item (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    date    TEXT NOT NULL,
    task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    amount  INTEGER,
    UNIQUE(date, task_id)
  );

  CREATE TABLE IF NOT EXISTS blocker (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id     INTEGER REFERENCES goal(id) ON DELETE SET NULL,
    task_id     INTEGER REFERENCES task(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    detail      TEXT DEFAULT '',
    status      TEXT DEFAULT 'open',       -- open | resolved
    resolution  TEXT DEFAULT '',
    opened_at   TEXT DEFAULT (datetime('now','localtime')),
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_check_date ON check_item(date);
  CREATE INDEX IF NOT EXISTS idx_entry_date ON entry(date);
  CREATE INDEX IF NOT EXISTS idx_blocker_status ON blocker(status);
`);

// 增量迁移：目标支持父子嵌套（大目标 → 小目标）
const goalCols = db.prepare(`PRAGMA table_info(goal)`).all().map((c) => c.name);
if (!goalCols.includes('parent_id')) {
  db.exec(`ALTER TABLE goal ADD COLUMN parent_id INTEGER REFERENCES goal(id)`);
}

// 增量迁移：记下完成日期，「已完成」才能按时间倒序排、并显示是哪天完成的
if (!goalCols.includes('done_at')) {
  db.exec(`ALTER TABLE goal ADD COLUMN done_at TEXT`);
}

// 增量迁移：手动排序（拖拽上调/下调），没有值的按 id 兜底
if (!goalCols.includes('sort_order')) {
  db.exec(`ALTER TABLE goal ADD COLUMN sort_order INTEGER`);
}
db.exec(`UPDATE goal SET sort_order = id WHERE sort_order IS NULL`);

// 增量迁移：任务区分「手动暂停」和「随目标完成自动暂停」，重新开始时只恢复后者
const taskCols = db.prepare(`PRAGMA table_info(task)`).all().map((c) => c.name);
if (!taskCols.includes('paused_by_goal')) {
  db.exec(`ALTER TABLE task ADD COLUMN paused_by_goal INTEGER DEFAULT 0`);
}

// 旧的「归档」语义统一成「已完成」
db.exec(`UPDATE goal SET status = 'done' WHERE status = 'archived'`);

// 一次性迁移：以前写在日记里的「明天第一件事」搬到 plan 表（用 user_version 做标记，只跑一次）
const uv = db.prepare(`PRAGMA user_version`).get().user_version || 0;
if (uv < 1) {
  db.exec(`
    INSERT INTO plan (date, note)
    SELECT date(date, '+1 day'), TRIM(next_step)
      FROM entry WHERE TRIM(next_step) <> ''
    ON CONFLICT(date) DO NOTHING
  `);
  db.exec(`PRAGMA user_version = 1`);
}

/* ---------- 时间工具 ---------- */

export function toISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

/** 在 ISO 日期上加减天数 */
export function shiftISO(iso, n) {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/* ---------- goal ---------- */

export const listGoals = () =>
  db
    .prepare(
      `SELECT * FROM goal WHERE status='active'
        ORDER BY COALESCE(parent_id, id), parent_id IS NOT NULL, sort_order, id`
    )
    .all();

export const listTopGoals = () =>
  db
    .prepare(`SELECT * FROM goal WHERE status='active' AND parent_id IS NULL ORDER BY sort_order, id`)
    .all();

export const listSubGoals = (parentId) =>
  db
    .prepare(`SELECT * FROM goal WHERE status='active' AND parent_id = ? ORDER BY sort_order, id`)
    .all(Number(parentId));

export const getGoal = (id) =>
  db.prepare(`SELECT * FROM goal WHERE id = ?`).get(Number(id));

export function addGoal({ title, why = '', target_date = '', parent_id = null }) {
  const r = db
    .prepare(`INSERT INTO goal (title, why, target_date, parent_id) VALUES (?,?,?,?)`)
    .run(String(title).trim(), why, target_date || null, parent_id ? Number(parent_id) : null);
  return r.lastInsertRowid;
}

/** 手动排序：把同级的某个目标上移/下移一格 */
export function moveGoal(id, dir) {
  const g = getGoal(id);
  if (!g) return false;
  const siblings = db
    .prepare(
      `SELECT id FROM goal
        WHERE status='active' AND COALESCE(parent_id, 0) = COALESCE(?, 0)
        ORDER BY sort_order, id`
    )
    .all(g.parent_id ?? 0);
  const i = siblings.findIndex((s) => s.id === Number(id));
  const j = i + (Number(dir) < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= siblings.length) return false;
  // 直接重排整组，避免 sort_order 相等时交换无效
  const stmt = db.prepare(`UPDATE goal SET sort_order = ? WHERE id = ?`);
  const order = siblings.map((s) => s.id);
  [order[i], order[j]] = [order[j], order[i]];
  order.forEach((gid, idx) => stmt.run(idx + 1, gid));
  return true;
}

/** 拖拽后一次性写入顺序；只接受同一父级、且都存在的一批 id */
export function reorderGoals(ids) {
  const list = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (list.length < 2) return false;
  const rows = list.map((id) => db.prepare(`SELECT id, parent_id FROM goal WHERE id = ?`).get(id));
  if (rows.some((r) => !r)) return false;
  const parent = rows[0].parent_id ?? null;
  if (rows.some((r) => (r.parent_id ?? null) !== parent)) return false;
  const stmt = db.prepare(`UPDATE goal SET sort_order = ? WHERE id = ?`);
  list.forEach((id, i) => stmt.run(i + 1, id));
  return true;
}

/** 每个目标的未解决卡点数 */
export function openBlockerCounts() {
  const m = new Map();
  for (const r of db
    .prepare(`SELECT goal_id, COUNT(*) AS n FROM blocker WHERE status='open' GROUP BY goal_id`)
    .all()) {
    m.set(r.goal_id, r.n);
  }
  return m;
}

/** 目标本身 + 它名下的小目标 */
function familyIds(id) {
  return db
    .prepare(`SELECT id FROM goal WHERE id = ? OR parent_id = ?`)
    .all(Number(id), Number(id))
    .map((r) => r.id);
}

/** 标记已完成：连带小目标，并暂停这些目标下的打卡任务（不打勾就不再烦人） */
export function completeGoal(id) {
  const ids = familyIds(id);
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE task SET active = 0, paused_by_goal = 1
        WHERE active = 1 AND goal_id IN (${marks})`
    ).run(...ids);
  }
  return db
    .prepare(`UPDATE goal SET status='done', done_at = COALESCE(done_at, ?) WHERE id = ? OR parent_id = ?`)
    .run(toISO(), Number(id), Number(id));
}

/** 重新开始：连带小目标一起恢复；只恢复当初因目标完成而暂停的任务 */
export function reopenGoal(id) {
  const ids = familyIds(id);
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE task SET active = 1, paused_by_goal = 0
        WHERE paused_by_goal = 1 AND goal_id IN (${marks})`
    ).run(...ids);
  }
  return db
    .prepare(`UPDATE goal SET status='active', done_at = NULL WHERE id = ? OR parent_id = ?`)
    .run(Number(id), Number(id));
}

export const listDoneGoals = () =>
  db
    .prepare(
      `SELECT * FROM goal WHERE status IN ('done','archived')
        ORDER BY COALESCE(done_at, '') DESC, id DESC`
    )
    .all();

/** 目标 + 它下面所有层级的 id，深的排前面，避免自引用外键当场报错 */
function deepIds(id) {
  const out = [];
  const walk = (pid, depth) => {
    for (const r of db.prepare(`SELECT id FROM goal WHERE parent_id = ?`).all(pid)) {
      walk(r.id, depth + 1);
      out.push({ id: r.id, depth });
    }
  };
  walk(Number(id), 0);
  return out.sort((a, b) => b.depth - a.depth).map((x) => x.id);
}

/**
 * 真删除：目标 + 小目标 + 它们的里程碑一起没。
 * 打卡任务和卡点会被放开成「未归类」，历史打卡不动。
 */
export function deleteGoal(id) {
  const gid = Number(id);
  const kids = deepIds(gid);
  const all = [gid, ...kids];
  const marks = all.map(() => '?').join(',');
  // 先把任务暂停：删了目标还天天在首页催你打卡，说不过去；历史打卡不动
  db.prepare(
    `UPDATE task SET active = 0, paused_by_goal = 1 WHERE active = 1 AND goal_id IN (${marks})`
  ).run(...all);
  for (const kid of kids) db.prepare(`DELETE FROM goal WHERE id = ?`).run(kid);
  return db.prepare(`DELETE FROM goal WHERE id = ?`).run(gid);
}

/* ---------- milestone ---------- */

export const listMilestones = (goalId) =>
  db
    .prepare(`SELECT * FROM milestone WHERE goal_id = ? ORDER BY done, position, id`)
    .all(Number(goalId));

export function addMilestone(goalId, title) {
  const pos = db
    .prepare(`SELECT COALESCE(MAX(position),0)+1 AS p FROM milestone WHERE goal_id = ?`)
    .get(Number(goalId)).p;
  return db
    .prepare(`INSERT INTO milestone (goal_id, title, position) VALUES (?,?,?)`)
    .run(Number(goalId), String(title).trim(), pos).lastInsertRowid;
}

export function toggleMilestone(id) {
  const m = db.prepare(`SELECT done FROM milestone WHERE id = ?`).get(Number(id));
  if (!m) return;
  const next = m.done ? 0 : 1;
  db.prepare(
    `UPDATE milestone SET done = ?, done_at = ? WHERE id = ?`
  ).run(next, next ? toISO() : null, Number(id));
}

export function milestoneStats(goalId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(done),0) AS done
         FROM milestone WHERE goal_id = ?`
    )
    .get(Number(goalId));
}

/* ---------- task ---------- */

export const listTasks = () =>
  db
    .prepare(
      `SELECT t.*, g.title AS goal_title, g.status AS goal_status
         FROM task t LEFT JOIN goal g ON g.id = t.goal_id
        WHERE t.active = 1 ORDER BY t.id`
    )
    .all();

/** 暂停中的任务：以前「暂停」之后就再也找不回来了 */
export const listPausedTasks = () =>
  db
    .prepare(
      `SELECT t.*, g.title AS goal_title, g.status AS goal_status
         FROM task t LEFT JOIN goal g ON g.id = t.goal_id
        WHERE t.active = 0 ORDER BY t.id`
    )
    .all();

export const getTask = (id) => db.prepare(`SELECT * FROM task WHERE id = ?`).get(Number(id));

export function addTask({ title, goal_id = null, cadence = 'daily', unit = '', target_per_week = 7 }) {
  return db
    .prepare(
      `INSERT INTO task (title, goal_id, cadence, unit, target_per_week) VALUES (?,?,?,?,?)`
    )
    .run(String(title).trim(), goal_id ? Number(goal_id) : null, cadence, unit, Number(target_per_week) || 7)
    .lastInsertRowid;
}

export const deactivateTask = (id) =>
  db.prepare(`UPDATE task SET active = 0, paused_by_goal = 0 WHERE id = ?`).run(Number(id));

/** 恢复暂停的任务（历史打卡还在） */
export const activateTask = (id) =>
  db.prepare(`UPDATE task SET active = 1, paused_by_goal = 0 WHERE id = ?`).run(Number(id));

/** 真删除：连带该任务的打卡记录（外键 ON DELETE CASCADE），不可恢复 */
export const deleteTask = (id) =>
  db.prepare(`DELETE FROM task WHERE id = ?`).run(Number(id));

/* ---------- entry ---------- */

export const getEntry = (date) =>
  db.prepare(`SELECT * FROM entry WHERE date = ?`).get(String(date));

export function saveEntry({ date, did = '', next_step = '' }) {
  db.prepare(
    `INSERT INTO entry (date, did, next_step, updated_at)
     VALUES (?,?,?, datetime('now','localtime'))
     ON CONFLICT(date) DO UPDATE SET
       did = excluded.did,
       next_step = excluded.next_step,
       updated_at = datetime('now','localtime')`
  ).run(String(date), did, next_step);
  // 「明天的第一件事」= 明天的计划，顺手写进未来计划，同一个意思不用记两遍
  if (String(next_step).trim()) setPlan(shiftISO(date, 1), next_step);
}

/* ---------- plan：未来某天要干什么 ---------- */

export const getPlan = (date) =>
  db.prepare(`SELECT * FROM plan WHERE date = ?`).get(String(date));

export const plansBetween = (from, to) =>
  db.prepare(`SELECT * FROM plan WHERE date BETWEEN ? AND ? ORDER BY date`).all(String(from), String(to));

export function setPlan(date, note) {
  const d = String(date);
  const n = String(note ?? '').trim();
  if (!n) {
    db.prepare(`DELETE FROM plan WHERE date = ?`).run(d);
    return;
  }
  db.prepare(
    `INSERT INTO plan (date, note, updated_at) VALUES (?,?, datetime('now','localtime'))
     ON CONFLICT(date) DO UPDATE SET note = excluded.note, updated_at = datetime('now','localtime')`
  ).run(d, n);
}

export const recentEntries = (limit = 12) =>
  db
    .prepare(
      `SELECT * FROM entry
        WHERE TRIM(did) <> '' OR TRIM(next_step) <> ''
        ORDER BY date DESC LIMIT ?`
    )
    .all(Number(limit));

/* ---------- check ---------- */

export function checksFor(date) {
  return db
    .prepare(
      `SELECT c.task_id, c.amount, t.title, t.unit,
              t.cadence, t.target_per_week, t.active
         FROM check_item c JOIN task t ON t.id = c.task_id
        WHERE c.date = ? ORDER BY t.id`
    )
    .all(String(date));
}

export function setCheck({ date, taskId, on, amount = null }) {
  const d = String(date);
  const t = Number(taskId);
  if (on) {
    db.prepare(
      `INSERT INTO check_item (date, task_id, amount) VALUES (?,?,?)
       ON CONFLICT(date, task_id) DO UPDATE SET amount = COALESCE(excluded.amount, check_item.amount)`
    ).run(d, t, amount === null || amount === '' ? null : Number(amount));
  } else {
    db.prepare(`DELETE FROM check_item WHERE date = ? AND task_id = ?`).run(d, t);
  }
}

export function setCheckAmount({ date, taskId, amount }) {
  const d = String(date);
  const t = Number(taskId);
  const v = amount === '' || amount === null ? null : Number(amount);
  const exists = db
    .prepare(`SELECT id FROM check_item WHERE date = ? AND task_id = ?`)
    .get(d, t);
  if (exists) {
    db.prepare(`UPDATE check_item SET amount = ? WHERE id = ?`).run(v, exists.id);
  } else if (v !== null) {
    db.prepare(`INSERT INTO check_item (date, task_id, amount) VALUES (?,?,?)`).run(d, t, v);
  }
}

/** 某一天所在那一周（周日算起）每个任务的打卡次数，用于首页「本周 2/3」 */
export function weekCheckCounts(dateISO) {
  const d = parseISO(dateISO);
  const start = new Date(d.getTime() - d.getDay() * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const rows = db
    .prepare(
      `SELECT task_id, COUNT(*) AS n FROM check_item
        WHERE date BETWEEN ? AND ? GROUP BY task_id`
    )
    .all(toISO(start), toISO(end));
  return new Map(rows.map((r) => [r.task_id, r.n]));
}

/** 近 N 天打卡/日记活动，用于时间线热力图 */
export function activitySince(sinceDate) {
  const map = new Map();
  for (const r of db
    .prepare(`SELECT date, COUNT(*) AS checks FROM check_item WHERE date >= ? GROUP BY date`)
    .all(String(sinceDate))) {
    map.set(r.date, { date: r.date, checks: r.checks, hasEntry: false });
  }
  for (const r of db
    .prepare(`SELECT date FROM entry WHERE date >= ?`)
    .all(String(sinceDate))) {
    const o = map.get(r.date) || { date: r.date, checks: 0, hasEntry: false };
    o.hasEntry = true;
    map.set(r.date, o);
  }
  return map;
}

/* ---------- blocker ---------- */

export function listBlockers(status = 'open') {
  return db
    .prepare(
      `SELECT b.*, g.title AS goal_title, t.title AS task_title
         FROM blocker b
         LEFT JOIN goal g ON g.id = b.goal_id
         LEFT JOIN task t ON t.id = b.task_id
        WHERE b.status = ?
        ORDER BY b.opened_at DESC, b.id DESC`
    )
    .all(status);
}

export function addBlocker({ title, detail = '', goal_id = null, task_id = null }) {
  return db
    .prepare(
      `INSERT INTO blocker (title, detail, goal_id, task_id) VALUES (?,?,?,?)`
    )
    .run(
      String(title).trim(),
      detail,
      goal_id ? Number(goal_id) : null,
      task_id ? Number(task_id) : null
    ).lastInsertRowid;
}

export function resolveBlocker(id, resolution = '') {
  db.prepare(
    `UPDATE blocker
        SET status='resolved', resolution=?, resolved_at=datetime('now','localtime')
      WHERE id = ?`
  ).run(String(resolution), Number(id));
}

export function reopenBlocker(id) {
  db.prepare(
    `UPDATE blocker SET status='open', resolution='', resolved_at=NULL WHERE id = ?`
  ).run(Number(id));
}

export const blockersForGoal = (goalId, status = 'open') =>
  db
    .prepare(
      `SELECT b.*, g.title AS goal_title, t.title AS task_title
         FROM blocker b
         LEFT JOIN goal g ON g.id = b.goal_id
         LEFT JOIN task t ON t.id = b.task_id
        WHERE b.status = ? AND b.goal_id = ?
        ORDER BY b.opened_at DESC, b.id DESC`
    )
    .all(status, Number(goalId));

/** 按目标分组，用于卡点总览页 */
export function blockersGrouped(status = 'open') {
  const rows = listBlockers(status);
  const groups = [];
  const index = new Map();
  for (const b of rows) {
    const key = b.goal_id ?? 0;
    if (!index.has(key)) {
      const g = { goal_id: b.goal_id, goal_title: b.goal_title || '未归类', items: [] };
      index.set(key, g);
      groups.push(g);
    }
    index.get(key).items.push(b);
  }
  return groups;
}

/** 某目标下每个固定任务在 since 之后的打卡次数 */
export function taskStatsForGoal(goalId, sinceDate) {
  return db
    .prepare(
      `SELECT t.id, t.title, t.unit, t.cadence, t.target_per_week,
              (SELECT COUNT(*) FROM check_item c WHERE c.task_id = t.id AND c.date >= ?) AS done_count
         FROM task t
        WHERE t.active = 1 AND t.goal_id = ?
        ORDER BY t.id`
    )
    .all(String(sinceDate), Number(goalId));
}

/* ---------- 导出 ---------- */

export function exportRange(fromDate, toDate) {
  const entries = db
    .prepare(`SELECT * FROM entry WHERE date BETWEEN ? AND ? ORDER BY date`)
    .all(fromDate, toDate);
  const checks = db
    .prepare(
      `SELECT c.date, c.amount, t.title, t.unit
         FROM check_item c JOIN task t ON t.id = c.task_id
        WHERE c.date BETWEEN ? AND ? ORDER BY c.date, t.id`
    )
    .all(fromDate, toDate);
  const blockers = db
    .prepare(
      `SELECT b.*, g.title AS goal_title FROM blocker b
         LEFT JOIN goal g ON g.id = b.goal_id
        WHERE date(b.opened_at) BETWEEN ? AND ? OR date(b.resolved_at) BETWEEN ? AND ?
        ORDER BY b.opened_at`
    )
    .all(fromDate, toDate, fromDate, toDate);
  return { entries, checks, blockers };
}

/* ---------- 示例数据 ---------- */

export function seed() {
  if (listGoals().length > 0) {
    console.log('已有数据，跳过 seed');
    return;
  }
  const target = toISO(new Date(Date.now() + 120 * 86400000));
  const gid = addGoal({
    title: '考研英语',
    why: '想去更好的学校，英语是最大的短板。',
    target_date: target,
  });
  addMilestone(gid, '真题阅读能稳定 60% 正确率');
  addMilestone(gid, '考场上 3 小时能写完一张卷');

  const vocab = addGoal({ title: '词汇', why: '词汇量是地基，不熟的话阅读写作都白搭。', parent_id: gid, target_date: target });
  addMilestone(vocab, '背完第一轮 5500 词');
  addMilestone(vocab, '第二轮只过错词');

  const reading = addGoal({ title: '阅读', why: '分值最高，决定上线。', parent_id: gid, target_date: target });
  addMilestone(reading, '每天 1 篇精读');
  addMilestone(reading, '错题能说清为什么错');

  const writing = addGoal({ title: '写作', why: '模板能救命，但要能默写。', parent_id: gid, target_date: target });
  addMilestone(writing, '大作文模板成型');

  addTask({ title: '背单词', goal_id: vocab, unit: '个' });
  addTask({ title: '阅读理解 1 篇', goal_id: reading });
  addTask({ title: '听力精听', goal_id: reading, cadence: 'weekly', target_per_week: 3 });

  addBlocker({ title: '长难句断句慢', detail: '一句话要看三遍才知道主干在哪。', goal_id: reading });
  addBlocker({ title: '单词背了忘', detail: '当天记得，第三天就没印象了。', goal_id: vocab });

  saveEntry({
    date: toISO(),
    did: '早上背了单词，下午做了两篇阅读，第二篇全错。',
    next_step: '先把错的那篇逐句拆开，找出到底是词不会还是句子结构看不懂。',
  });
  console.log('已写入示例数据：1 个大目标 + 3 个小目标');
}
