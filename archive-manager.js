'use strict';
/**
 * archive-manager.js
 *
 * 在 dsh 进程已停止时，直接操作 DSH 数据目录（默认 ~/.dsh）中的归档记录。
 * 仅使用 Node 内置模块，不依赖 electron。停止/重启 dsh 由调用方负责。
 *
 * 写操作的通用约定：
 *  - 先备份 storages/workspace.json 到 <dshHome>/backups/；
 *  - 写入采用同目录 .tmp + rename 的原子方式，并保持原文件权限；
 *  - 写回后重新读取校验，失败则用备份还原并抛错；
 *  - 所有路径都由 dshHome 拼接，ids 含 / 、\ 或 .. 直接拒绝。
 */

const fs = require('fs');
const path = require('path');
const net = require('net');

const WS_REL = path.join('storages', 'workspace.json');
const SESSIONS_DIR = 'sessions';
const TRASH_DIR = 'trash';
const BACKUP_DIR = 'backups';
const CHANGED_MSG = 'workspace.json 在操作期间被修改（dsh 是否仍在运行？），已中止，未写入';

// ---------- 基础工具 ----------

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function fileMode(p) {
  return fs.statSync(p).mode & 0o777;
}

/** 若 p 已存在，则在扩展名前追加 -2、-3...，返回不存在的路径。 */
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; ; i++) {
    const candidate = path.join(dir, `${name}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

/** 返回 id 的问题描述；合法则返回 null。 */
function idProblem(id) {
  if (typeof id !== 'string' || id.length === 0) return '必须是非空字符串';
  if (/[\/\\\0]/.test(id)) return '含路径分隔符';
  if (id === '.' || id.includes('..')) return '含 ..';
  return null;
}

function validateIds(ids) {
  if (!Array.isArray(ids)) throw new Error('ids 必须是字符串数组');
  const out = [];
  for (const id of ids) {
    const problem = idProblem(id);
    if (problem) throw new Error(`拒绝非法 id（${problem}）: ${JSON.stringify(String(id))}`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function assertDshHome(dshHome) {
  if (typeof dshHome !== 'string' || !path.isAbsolute(dshHome)) {
    throw new Error(`dshHome 必须是绝对路径，收到: ${JSON.stringify(dshHome)}`);
  }
  const home = path.normalize(dshHome);
  const wsPath = path.join(home, WS_REL);
  if (!fs.existsSync(wsPath)) {
    throw new Error(`dshHome 下找不到 workspace.json: ${wsPath}`);
  }
  return { home, wsPath };
}

// ---------- workspace.json 读写 ----------

function readWorkspace(wsPath) {
  let raw;
  try {
    raw = fs.readFileSync(wsPath, 'utf8');
  } catch (e) {
    throw new Error(`读取 workspace.json 失败 (${wsPath}): ${e.message}`);
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`workspace.json JSON 损坏 (${wsPath}): ${e.message}`);
  }
  if (!obj || typeof obj !== 'object' || !obj.global || !Array.isArray(obj.global.archivedSessionIds)) {
    throw new Error(`workspace.json 结构异常：缺少 global.archivedSessionIds 数组 (${wsPath})`);
  }
  return { raw, obj };
}

/** 检测原文件格式：缩进字符串（null 表示压缩格式）以及是否以换行结尾。 */
function detectFormat(raw) {
  const m = raw.match(/^([ \t]+)"/m);
  return {
    indent: m ? m[1] : null,
    trailingNewline: raw.endsWith('\n'),
  };
}

function serialize(obj, fmt) {
  const body = fmt.indent === null ? JSON.stringify(obj) : JSON.stringify(obj, null, fmt.indent);
  return body + (fmt.trailingNewline ? '\n' : '');
}

/** 原子写：同目录 .tmp 写入 + fsync + chmod + rename。 */
function atomicWrite(file, data, mode) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', mode);
    let off = 0;
    while (off < buf.length) {
      off += fs.writeSync(fd, buf, off, buf.length - off);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
    try { fs.unlinkSync(tmp); } catch (_) { /* tmp 可能未创建 */ }
    throw e;
  }
}

/** 备份 workspace.json（字节级复制，保持原权限）。 */
function makeBackup(home, wsPath, raw) {
  const dir = path.join(home, BACKUP_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (fs.readFileSync(wsPath, 'utf8') !== raw) {
    throw new Error(CHANGED_MSG);
  }
  const backup = uniquePath(path.join(dir, `workspace-${isoStamp()}.json`));
  fs.copyFileSync(wsPath, backup, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup, fileMode(wsPath));
  if (fs.readFileSync(backup, 'utf8') !== raw) {
    throw new Error(`备份校验失败: ${backup}`);
  }
  return backup;
}

function commitWorkspace(wsPath, raw, nextObj, fmt, mode) {
  if (fs.readFileSync(wsPath, 'utf8') !== raw) {
    throw new Error(CHANGED_MSG);
  }
  atomicWrite(wsPath, serialize(nextObj, fmt), mode);
}

function rollbackWorkspace(wsPath, backup, mode) {
  atomicWrite(wsPath, fs.readFileSync(backup), mode);
}

/** 去掉允许变化的字段，用于比较"其它内容是否不变"。 */
function stripMutable(obj, touchedSessionIds) {
  const o = clone(obj);
  delete o.global.archivedSessionIds;
  if (touchedSessionIds && o.tables && o.tables.workspaces && typeof o.tables.workspaces === 'object') {
    for (const w of Object.values(o.tables.workspaces)) {
      if (w && typeof w === 'object') delete w.sessionIds;
    }
  }
  return o;
}

/** 写回后校验：内容与预期一致、待处理 id 已移除、顶层键集合不变、其它内容不变。 */
function verifyWorkspace(wsPath, origObj, nextObj, drop, touchedSessionIds) {
  const back = readWorkspace(wsPath).obj;
  if (JSON.stringify(back) !== JSON.stringify(nextObj)) {
    throw new Error('写回后内容与预期不一致');
  }
  if (back.global.archivedSessionIds.some((x) => drop.has(x))) {
    throw new Error('写回后 archivedSessionIds 仍含待处理的 id');
  }
  if (JSON.stringify(Object.keys(back)) !== JSON.stringify(Object.keys(origObj))) {
    throw new Error('写回后顶层键集合发生变化');
  }
  if (JSON.stringify(stripMutable(back, touchedSessionIds)) !==
      JSON.stringify(stripMutable(origObj, touchedSessionIds))) {
    throw new Error('写回后除归档相关字段外的内容发生变化');
  }
}

// ---------- 会话目录定位 ----------

/**
 * 在 <home>/sessions/<项目目录>/ 下查找与 id 对应的会话目录。
 * 目录名可能是 `session-<uuid>` 或裸 `<uuid>`，两种都尝试。
 * 返回 [{ abs, rel, symlink }]，rel 相对于 sessions 根目录。
 */
function findSessionDirs(home, id) {
  if (idProblem(id)) return [];
  const root = path.join(home, SESSIONS_DIR);
  let projects;
  try {
    projects = fs.readdirSync(root);
  } catch (_) {
    return [];
  }
  const names = new Set([id, id.startsWith('session-') ? id.slice('session-'.length) : `session-${id}`]);
  const out = [];
  for (const proj of projects) {
    const projDir = path.join(root, proj);
    let st;
    try {
      st = fs.lstatSync(projDir);
    } catch (_) {
      continue;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    for (const name of names) {
      const abs = path.join(projDir, name);
      let s2;
      try {
        s2 = fs.lstatSync(abs);
      } catch (_) {
        continue;
      }
      if (s2.isDirectory() || s2.isSymbolicLink()) {
        out.push({ abs, rel: path.join(proj, name), symlink: s2.isSymbolicLink() });
      }
    }
  }
  return out;
}

// ---------- 导出 1：列出归档 ----------

/**
 * @param {string} dshHome 绝对路径，如 ~/.dsh
 * @returns {{ ids: string[], sessionDirs: { [id: string]: string|null } }}
 */
function listArchivedIds(dshHome) {
  const { home, wsPath } = assertDshHome(dshHome);
  const { obj } = readWorkspace(wsPath);
  const ids = obj.global.archivedSessionIds.slice();
  const sessionDirs = {};
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const found = findSessionDirs(home, id);
    sessionDirs[id] = found.length ? found[0].abs : null;
  }
  return { ids, sessionDirs };
}

// ---------- 导出 2：取消归档 ----------

/**
 * @param {string} dshHome
 * @param {string[]} ids
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ restored: string[], skipped: string[], backup: string|null, dryRun?: boolean }}
 */
function unarchive(dshHome, ids, opts = {}) {
  const dryRun = !!opts.dryRun;
  const { home, wsPath } = assertDshHome(dshHome);
  const want = validateIds(ids);
  const { raw, obj } = readWorkspace(wsPath);
  const archived = obj.global.archivedSessionIds;
  const archivedSet = new Set(archived);
  const restored = want.filter((id) => archivedSet.has(id));
  const skipped = want.filter((id) => !archivedSet.has(id));

  if (dryRun || restored.length === 0) {
    return { restored, skipped, backup: null, dryRun };
  }

  const fmt = detectFormat(raw);
  const mode = fileMode(wsPath);
  const backup = makeBackup(home, wsPath, raw);
  const drop = new Set(restored);
  const next = clone(obj);
  next.global.archivedSessionIds = archived.filter((x) => !drop.has(x));

  let written = false;
  try {
    commitWorkspace(wsPath, raw, next, fmt, mode);
    written = true;
    verifyWorkspace(wsPath, obj, next, drop, false);
  } catch (err) {
    if (!written) throw err;
    try {
      rollbackWorkspace(wsPath, backup, mode);
    } catch (e) {
      throw new Error(`unarchive 校验失败且还原失败（备份: ${backup}）: ${err.message}; ${e.message}`);
    }
    throw new Error(`unarchive 校验失败，已用备份还原: ${err.message}`);
  }
  return { restored, skipped, backup };
}

// ---------- 导出 3：删除会话（移入 trash） ----------

/**
 * 仅删除已在 archivedSessionIds 中的会话。会话目录被移动到 <home>/trash/<时间戳>/<原相对路径>，不做 rm。
 * 若某个已归档 id 没有对应目录，则只清理索引中的记录，并在 movedDirs 中记为 null。
 *
 * @param {string} dshHome
 * @param {string[]} ids
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ deleted: string[], skipped: string[], skipReasons: object, trashDir: string|null,
 *            backup: string|null, movedDirs: object, dryRun?: boolean }}
 */
function deleteSessions(dshHome, ids, opts = {}) {
  const dryRun = !!opts.dryRun;
  const { home, wsPath } = assertDshHome(dshHome);
  const want = validateIds(ids);
  const { raw, obj } = readWorkspace(wsPath);
  const archived = obj.global.archivedSessionIds;
  const archivedSet = new Set(archived);

  const skipped = [];
  const skipReasons = {};
  const targets = []; // { id, dir: {abs, rel, symlink} | null }
  for (const id of want) {
    if (!archivedSet.has(id)) {
      skipped.push(id);
      skipReasons[id] = '未在 archivedSessionIds 中，拒绝删除';
      continue;
    }
    const found = findSessionDirs(home, id);
    if (found.length > 1) {
      skipped.push(id);
      skipReasons[id] = '匹配到多个会话目录，拒绝';
      continue;
    }
    const dir = found[0] || null;
    if (dir && dir.symlink) {
      skipped.push(id);
      skipReasons[id] = '会话目录是符号链接，拒绝';
      continue;
    }
    if (dir && fs.existsSync(path.join(dir.abs, 'session.lock'))) {
      skipped.push(id);
      skipReasons[id] = '存在 session.lock，会话可能仍在使用，拒绝';
      continue;
    }
    targets.push({ id, dir });
  }

  const movedDirs = {};
  for (const t of targets) movedDirs[t.id] = t.dir ? t.dir.rel : null;
  const trashDirPlanned = uniquePath(path.join(home, TRASH_DIR, isoStamp()));
  const anyMove = targets.some((t) => t.dir);

  if (dryRun) {
    return {
      dryRun: true,
      deleted: targets.map((t) => t.id),
      skipped,
      skipReasons,
      trashDir: anyMove ? trashDirPlanned : null,
      backup: null,
      movedDirs,
    };
  }
  if (targets.length === 0) {
    return { dryRun: false, deleted: [], skipped, skipReasons, trashDir: null, backup: null, movedDirs };
  }

  const fmt = detectFormat(raw);
  const mode = fileMode(wsPath);
  const backup = makeBackup(home, wsPath, raw);
  const drop = new Set(targets.map((t) => t.id));

  const next = clone(obj);
  next.global.archivedSessionIds = archived.filter((x) => !drop.has(x));
  const wsTables = next.tables && next.tables.workspaces;
  if (wsTables && typeof wsTables === 'object') {
    for (const w of Object.values(wsTables)) {
      if (w && Array.isArray(w.sessionIds)) {
        w.sessionIds = w.sessionIds.filter((x) => !drop.has(x));
      }
    }
  }

  const moves = []; // { from, to }
  const parents = new Set(); // 本次为移动而创建/使用的父目录，回滚时只尝试 rmdir（空目录才会删）
  let written = false;
  try {
    commitWorkspace(wsPath, raw, next, fmt, mode);
    written = true;
    for (const t of targets) {
      if (!t.dir) continue;
      const to = path.join(trashDirPlanned, t.dir.rel);
      const parent = path.dirname(to);
      parents.add(parent);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      if (fs.existsSync(to)) throw new Error(`目标已存在，拒绝覆盖: ${to}`);
      fs.renameSync(t.dir.abs, to); // 跨设备时 rename 会抛 EXDEV，此处直接失败回滚，不做 copy+rm
      moves.push({ from: t.dir.abs, to });
    }
    verifyWorkspace(wsPath, obj, next, drop, true);
    for (const m of moves) {
      if (fs.existsSync(m.from) || !fs.existsSync(m.to)) {
        throw new Error(`移动结果校验失败: ${m.from}`);
      }
    }
  } catch (err) {
    const rbErrors = [];
    for (const m of moves.slice().reverse()) {
      try {
        fs.renameSync(m.to, m.from);
      } catch (e) {
        rbErrors.push(`还原 ${m.to} 失败: ${e.message}`);
      }
    }
    if (written) {
      try {
        rollbackWorkspace(wsPath, backup, mode);
      } catch (e) {
        rbErrors.push(`还原 workspace.json 失败: ${e.message}`);
      }
    }
    // 只移除本次创建的空目录（rmdir 对非空目录会失败，不会删除数据）
    const cleanup = [...parents, trashDirPlanned].sort((a, b) => b.length - a.length);
    for (const d of cleanup) {
      try { fs.rmdirSync(d); } catch (_) { /* 非空或不存在 */ }
    }
    const tail = rbErrors.length
      ? `；回滚出错，需人工处理（备份: ${backup}）: ${rbErrors.join('; ')}`
      : `；已回滚（备份: ${backup}）`;
    throw new Error(`deleteSessions 失败: ${err.message}${tail}`);
  }

  return {
    dryRun: false,
    deleted: targets.map((t) => t.id),
    skipped,
    skipReasons,
    trashDir: moves.length ? trashDirPlanned : null,
    backup,
    movedDirs,
  };
}

// ---------- 导出 4：端口检测 ----------

/**
 * 检测 127.0.0.1:port 是否有进程在监听（500ms 超时视为未监听）。
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortListening(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    let done = false;
    const sock = net.createConnection({ host: '127.0.0.1', port });
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
}

module.exports = {
  listArchivedIds,
  unarchive,
  deleteSessions,
  isPortListening,
};
