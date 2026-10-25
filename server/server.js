'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { promisify } = require('node:util');
const { openDb } = require('./db');
const { ANCHOR_ORDER, shuffleIds, score } = require('./scoring');

const scrypt = promisify(crypto.scrypt);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'questions.json'), 'utf8'));
const anchors = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'anchors.json'), 'utf8'));
const baseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'));
const qById = new Map(questions.map((q) => [q.id, q]));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

async function hashKey(key) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(key, salt, 32);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
const DUMMY_HASH_PROMISE = hashKey('dummy-key-for-timing');
async function verifyKey(key, stored) {
  const [, s, h] = (stored || await DUMMY_HASH_PROMISE).split('$');
  const got = await scrypt(key, Buffer.from(s, 'base64'), 32);
  return !!stored && crypto.timingSafeEqual(got, Buffer.from(h, 'base64'));
}

// 内存滑动窗口限速
function makeLimiter() {
  const hits = new Map();
  return function hit(key, limit, windowMs) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return arr.length <= limit;
  };
}

function createApp(opts = {}) {
  const config = { ...baseConfig, requireCode: process.env.REQUIRE_CODE === '1', ...(opts.config || {}) };
  const db = openDb(opts.dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'career-anchor.db'));
  const adminPassword = opts.adminPassword !== undefined ? opts.adminPassword : process.env.ADMIN_PASSWORD;
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  const limit = makeLimiter();
  const now = () => Date.now();

  const q = {
    pByEmail: db.prepare('SELECT * FROM participants WHERE email_norm = ?'),
    pById: db.prepare('SELECT * FROM participants WHERE id = ?'),
    pInsert: db.prepare('INSERT INTO participants(name,email,email_norm,key_hash,created_at) VALUES(?,?,?,?,?)'),
    pFail: db.prepare('UPDATE participants SET failed_count=?, locked_until=? WHERE id=?'),
    pSetKey: db.prepare('UPDATE participants SET key_hash=?, failed_count=0, locked_until=0 WHERE id=?'),
    cGet: db.prepare('SELECT * FROM codes WHERE code=?'),
    cUseSingle: db.prepare('UPDATE codes SET used_at=?, participant_id=? WHERE id=? AND used_at IS NULL AND voided=0'),
    cBindSingle: db.prepare('UPDATE codes SET attempt_id=? WHERE id=?'),
    cSharedCount: db.prepare('SELECT COUNT(*) c FROM code_uses WHERE code_id=?'),
    cSharedHas: db.prepare('SELECT 1 FROM code_uses WHERE code_id=? AND participant_id=?'),
    cSharedInsert: db.prepare('INSERT INTO code_uses(code_id,participant_id,used_at) VALUES(?,?,?)'),
    cSharedBind: db.prepare('UPDATE code_uses SET attempt_id=? WHERE code_id=? AND participant_id=?'),
    cRename: db.prepare('UPDATE codes SET code=? WHERE id=?'),
    cInsert: db.prepare('INSERT INTO codes(code,note,created_at,kind,expires_at,max_uses,team_id) VALUES(?,?,?,?,?,?,?)'),
    sInsert: db.prepare('INSERT INTO sessions(token_hash,participant_id,expires_at) VALUES(?,?,?)'),
    sGet: db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?'),
    sDel: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    sPurge: db.prepare('DELETE FROM sessions WHERE expires_at<=?'),
    aList: db.prepare('SELECT id,status,started_at,submitted_at,primary_anchors FROM attempts WHERE participant_id=? ORDER BY id DESC'),
    aGet: db.prepare('SELECT * FROM attempts WHERE id=? AND participant_id=?'),
    aDraft: db.prepare("SELECT * FROM attempts WHERE participant_id=? AND status='draft' ORDER BY id DESC LIMIT 1"),
    aInsert: db.prepare('INSERT INTO attempts(participant_id,seed,question_order,started_at,user_agent,ip_hash,team_id) VALUES(?,?,?,?,?,?,?)'),
    tById: db.prepare('SELECT * FROM teams WHERE id=?'),
    tByKey: db.prepare('SELECT * FROM teams WHERE key_hash=?'),
    tCount: db.prepare('SELECT COUNT(*) c FROM teams WHERE closed=0'),
    aSaveAnswers: db.prepare("UPDATE attempts SET answers=? WHERE id=? AND status='draft'"),
    aSubmit: db.prepare("UPDATE attempts SET status='submitted', answers=?, top3=?, scores=?, primary_anchors=?, submitted_at=? WHERE id=? AND status='draft'"),
  };

  const ipHash = (ip) => sha256(db.ipSalt + ip).slice(0, 24);
  const clientIp = (req) => (trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '0';

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) throw new HttpError(413, '请求过大');
      chunks.push(c);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, '请求格式错误'); }
  }

  function send(res, status, body, headers = {}) {
    const isStr = typeof body === 'string' || Buffer.isBuffer(body);
    const data = isStr ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(data);
  }

  function auth(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!m) throw new HttpError(401, '请先验证身份');
    const s = q.sGet.get(sha256(m[1]), now());
    if (!s) throw new HttpError(401, '登录已过期，请重新验证');
    return { participantId: s.participant_id, tokenHash: s.token_hash };
  }

  function adminAuth(req) {
    if (!adminPassword) throw new HttpError(503, '管理后台未启用（未设置 ADMIN_PASSWORD）');
    const ip = clientIp(req);
    const m = /^Bearer (.*)$/.exec(req.headers.authorization || '');
    if (!m || !safeEqual(m[1], adminPassword)) {
      if (!limit('adminfail:' + ip, 10, 15 * 60_000)) throw new HttpError(429, '尝试过于频繁，请稍后再试');
      throw new HttpError(401, '管理员口令不正确');
    }
  }

  async function newSession(participantId) {
    q.sPurge.run(now());
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = now() + config.sessionHours * 3600_000;
    q.sInsert.run(sha256(token), participantId, expiresAt);
    return { token, expiresAt };
  }

  const attemptSummary = (r) => ({ id: r.id, status: r.status, startedAt: r.started_at, submittedAt: r.submitted_at, primary: r.primary_anchors ? JSON.parse(r.primary_anchors) : null });
  const reportNo = (r) => `CA-${new Date(r.submitted_at || r.started_at).toISOString().slice(0, 10).replace(/-/g, '')}-${String(r.id).padStart(6, '0')}`;

  function attemptView(r, participant) {
    const order = JSON.parse(r.question_order);
    const view = { id: r.id, status: r.status, name: participant.name, reportNo: reportNo(r), config: { top3Bonus: !!config.top3Bonus, pageSize: config.pageSize } };
    const tm = r.team_id ? q.tById.get(r.team_id) : null;
    if (tm) view.team = tm.name;
    if (r.status === 'draft') {
      view.questions = order.map((id) => ({ id, text: qById.get(id).text }));
      view.answers = JSON.parse(r.answers);
    } else {
      view.submittedAt = r.submitted_at;
      view.scores = JSON.parse(r.scores);
      view.primary = JSON.parse(r.primary_anchors);
      view.ranking = ANCHOR_ORDER.slice().sort((x, y) => view.scores[y] - view.scores[x] || ANCHOR_ORDER.indexOf(x) - ANCHOR_ORDER.indexOf(y));
    }
    return view;
  }

  // 兑换码：8 位，去掉易混字符（0/O/1/I），展示为 XXXX-XXXX，比较时忽略大小写、空格和连字符
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const showCode = (c, kind) => (kind === 'single' && c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c);
  function genCode(len) {
    let c = '';
    for (let i = 0; i < len; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    return c;
  }

  const normKey = (k) => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const showKey = (k) => k.match(/.{1,4}/g).join('-');
  const keyHash = (k) => sha256('team:' + normKey(k));

  // 兑换码是否可用；可用返回 null，否则返回给用户看的原因
  function codeProblem(codeRow, participantId) {
    if (!codeRow || codeRow.voided) return '兑换码无效或已被使用';
    if (codeRow.team_id) { const t = q.tById.get(codeRow.team_id); if (!t || t.closed) return '该团队已关闭，兑换码不可用'; }
    if (codeRow.expires_at && now() > codeRow.expires_at) return '兑换码已过期';
    if (codeRow.kind === 'single') return codeRow.used_at ? '兑换码无效或已被使用' : null;
    if (q.cSharedHas.get(codeRow.id, participantId)) return '你已经用这个兑换码测试过了';
    if (codeRow.max_uses != null && q.cSharedCount.get(codeRow.id).c >= codeRow.max_uses) return '这个兑换码的使用名额已满';
    return null;
  }

  // 生成兑换码（一次性码批量 / 通用码一个）；teamId 不为空时归属某个团队
  function createCodes(body, teamId = null) {
    const kind = body.kind === 'shared' ? 'shared' : 'single';
    const note = String(body.note || '').trim().slice(0, 60);
    let expiresAt = null;
    if (body.hours !== undefined && body.hours !== null && body.hours !== '') {
      const h = Number(body.hours);
      if (!(h > 0 && h <= 24 * 365)) throw new HttpError(400, '有效时长需大于 0 且不超过 8760 小时');
      expiresAt = now() + Math.round(h * 3600_000);
    }
    if (kind === 'single') {
      const count = Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > 200) throw new HttpError(400, '数量需为 1–200 的整数');
      const out = [];
      while (out.length < count) {
        const c = genCode(8);
        try { const r = q.cInsert.run(c, note, now(), 'single', expiresAt, null, teamId); out.push({ id: Number(r.lastInsertRowid), code: showCode(c, 'single'), note, expiresAt }); } catch { /* 极小概率重复，重试 */ }
      }
      return out;
    }
    let maxUses = null;
    if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== '') {
      maxUses = Number(body.maxUses);
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000) throw new HttpError(400, '最多使用人数需为 1–100000 的整数');
    }
    let code = normCode(body.customCode);
    if (body.customCode && String(body.customCode).trim() && (code.length < 4 || code.length > 20)) throw new HttpError(400, '自定义码需为 4–20 位字母或数字');
    const custom = !!code;
    // 自定义码与已作废、已过期的旧码重名：把旧码归档（改名为「原码#编号」，保留它的使用记录），让这个文字可以重新使用
    if (custom) {
      const old = q.cGet.get(code);
      if (old) {
        if (!(old.voided || (old.expires_at && now() > old.expires_at))) throw new HttpError(409, '这个兑换码正在使用中。请先作废它，或换一个');
        q.cRename.run(`${old.code}#${old.id}`, old.id);
      }
    }
    for (let i = 0; i < 20; i++) {
      if (!custom) code = genCode(6);
      try {
        const r = q.cInsert.run(code, note, now(), 'shared', expiresAt, maxUses, teamId);
        return [{ id: Number(r.lastInsertRowid), code, note, expiresAt, maxUses }];
      } catch { if (custom) throw new HttpError(409, '这个兑换码已经存在，请换一个'); }
    }
    throw new HttpError(500, '生成失败，请重试');
  }

  // 统计报表（teamId 为空时统计全部）
  function buildReport(teamId, tz) {
    const rows = teamId
      ? db.prepare('SELECT participant_id,status,scores,primary_anchors,started_at,submitted_at FROM attempts WHERE team_id=?').all(teamId)
      : db.prepare('SELECT participant_id,status,scores,primary_anchors,started_at,submitted_at FROM attempts').all();
    const done = rows.filter((r) => r.status === 'submitted');
    const dayKey = (t) => new Date(t + tz * 60000).toISOString().slice(0, 10);
    const primary = Object.fromEntries(ANCHOR_ORDER.map((c) => [c, 0]));
    const sum = Object.fromEntries(ANCHOR_ORDER.map((c) => [c, 0]));
    const perDay = {};
    const mins = [];
    const doneBy = new Map();
    for (const r of done) {
      for (const c of JSON.parse(r.primary_anchors)) primary[c]++;
      const sc = JSON.parse(r.scores);
      for (const c of ANCHOR_ORDER) sum[c] += sc[c];
      const k = dayKey(r.submitted_at);
      perDay[k] = (perDay[k] || 0) + 1;
      mins.push((r.submitted_at - r.started_at) / 60000);
      doneBy.set(r.participant_id, (doneBy.get(r.participant_id) || 0) + 1);
    }
    mins.sort((x, y) => x - y);
    const days = [];
    for (let i = 29; i >= 0; i--) { const k = dayKey(now() - i * 86400000); days.push({ date: k, count: perDay[k] || 0 }); }
    const edges = [5, 10, 15, 20, 30];
    const bins = ['<5 分', '5–10 分', '10–15 分', '15–20 分', '20–30 分', '30 分以上'].map((label) => ({ label, count: 0 }));
    for (const m of mins) bins[edges.filter((e) => m >= e).length].count++;
    const drafts = rows.length - done.length;
    const avg = Object.fromEntries(ANCHOR_ORDER.map((c) => [c, done.length ? Math.round((sum[c] / done.length) * 10) / 10 : null]));
    return {
      participants: teamId ? new Set(rows.map((r) => r.participant_id)).size : db.prepare('SELECT COUNT(*) c FROM participants').get().c,
      submitted: done.length, drafts,
      completionRate: rows.length ? done.length / rows.length : null,
      last7: days.slice(-7).reduce((a, d) => a + d.count, 0),
      medianMinutes: mins.length ? Math.round(mins[Math.floor(mins.length / 2)] * 10) / 10 : null,
      retakers: [...doneBy.values()].filter((n) => n > 1).length,
      primary, avgScores: avg, days, durationBins: bins,
    };
  }

  function validateAnswers(order, answers) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, '答案格式错误');
    const out = {};
    for (const [k, v] of Object.entries(answers)) {
      const id = Number(k);
      if (!order.includes(id)) throw new HttpError(400, `无效的题号 ${k}`);
      if (!Number.isInteger(v) || v < 1 || v > 6) throw new HttpError(400, '分值必须是 1 到 6 的整数');
      out[id] = v;
    }
    return out;
  }

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async function route(req, res, url) {
    const p = url.pathname;
    const method = req.method;
    const ip = clientIp(req);

    if (method === 'GET' && p === '/api/config') return send(res, 200, { top3Bonus: !!config.top3Bonus, pageSize: config.pageSize, requireCode: !!config.requireCode, showCodeField: !!config.requireCode || q.tCount.get().c > 0, anchors, order: ANCHOR_ORDER });

    if (method === 'POST' && p === '/api/enter') {
      if (!limit('enter:' + ip, config.enterPerMin || 30, 60_000)) throw new HttpError(429, '请求过于频繁，请稍后再试');
      const body = await readJson(req);
      const email = String(body.email || '').trim();
      const key = String(body.key || '');
      const name = String(body.name || '').trim();
      if (!EMAIL_RE.test(email) || email.length > 120) throw new HttpError(400, '请输入有效的邮箱');
      if (key.length < 6 || key.length > 32) throw new HttpError(400, '查看密钥需为 6–32 位');
      const norm = email.toLowerCase();
      const GENERIC = new HttpError(401, '邮箱或密钥不正确');
      let participant = q.pByEmail.get(norm);
      let isNew = false;
      if (!participant) {
        if (!name) throw GENERIC;
        if (name.length > 30) throw new HttpError(400, '姓名需为 1–30 个字符');
        const h = await hashKey(key);
        try {
          const r = q.pInsert.run(name, email, norm, h, now());
          participant = q.pById.get(Number(r.lastInsertRowid));
          isNew = true;
        } catch { // 并发注册同一邮箱：回退到校验
          participant = q.pByEmail.get(norm);
        }
      }
      if (!isNew) {
        if (participant.locked_until > now()) throw new HttpError(429, `尝试次数过多，请 ${Math.ceil((participant.locked_until - now()) / 60000)} 分钟后再试`);
        if (!participant.key_hash) { // 管理员已重置：本次设置新密钥
          q.pSetKey.run(await hashKey(key), participant.id);
        } else if (!(await verifyKey(key, participant.key_hash))) {
          const fails = participant.failed_count + 1;
          const locked = fails >= config.maxFailedLogins;
          q.pFail.run(locked ? 0 : fails, locked ? now() + config.lockMinutes * 60_000 : 0, participant.id);
          throw GENERIC;
        } else if (participant.failed_count) q.pFail.run(0, 0, participant.id);
      }
      const session = await newSession(participant.id);
      return send(res, 200, { ...session, isNew, name: participant.name, attempts: q.aList.all(participant.id).map(attemptSummary) });
    }

    if (method === 'POST' && p === '/api/logout') {
      const a = auth(req);
      q.sDel.run(a.tokenHash);
      return send(res, 200, { ok: true });
    }

    if (method === 'GET' && p === '/api/me') {
      const a = auth(req);
      const part = q.pById.get(a.participantId);
      return send(res, 200, { name: part.name, attempts: q.aList.all(part.id).map(attemptSummary) });
    }

    if (method === 'POST' && p === '/api/codes/check') {
      const a = auth(req);
      const body = await readJson(req);
      if (!limit('redeem:' + ip, config.redeemLimit || 30, 10 * 60_000)) throw new HttpError(429, '尝试过于频繁，请稍后再试');
      const code = normCode(body.code);
      if (!code) throw new HttpError(400, '请输入兑换码');
      const row = q.cGet.get(code);
      const problem = codeProblem(row, a.participantId);
      if (problem) throw new HttpError(400, problem);
      const t = row.team_id ? q.tById.get(row.team_id) : null;
      return send(res, 200, { kind: row.kind, team: t ? { name: t.name, shareNames: !!t.share_names } : null });
    }

    if (method === 'POST' && p === '/api/attempts') {
      const a = auth(req);
      const body = await readJson(req);
      let row = q.aDraft.get(a.participantId);
      if (!row) { // 已有未完成的测试时直接继续，不消耗兑换码
        const code = normCode(body.code);
        if (config.requireCode || code) {
          if (!limit('redeem:' + ip, config.redeemLimit || 30, 10 * 60_000)) throw new HttpError(429, '尝试过于频繁，请稍后再试');
          if (!code) throw new HttpError(400, '请输入兑换码');
        }
        const seed = crypto.randomInt(1, 2 ** 31);
        const order = shuffleIds(questions.map((x) => x.id), seed);
        db.exec('BEGIN IMMEDIATE');
        try {
          let codeRow = null;
          if (code) {
            codeRow = q.cGet.get(code);
            const problem = codeProblem(codeRow, a.participantId);
            if (problem) throw new HttpError(400, problem);
            if (codeRow.kind === 'single') {
              if (!q.cUseSingle.run(now(), a.participantId, codeRow.id).changes) throw new HttpError(400, '兑换码无效或已被使用');
            } else q.cSharedInsert.run(codeRow.id, a.participantId, now());
          }
          const r = q.aInsert.run(a.participantId, seed, JSON.stringify(order), now(), String(req.headers['user-agent'] || '').slice(0, 200), ipHash(ip), codeRow ? codeRow.team_id : null);
          const attemptId = Number(r.lastInsertRowid);
          if (codeRow) codeRow.kind === 'single' ? q.cBindSingle.run(attemptId, codeRow.id) : q.cSharedBind.run(attemptId, codeRow.id, a.participantId);
          db.exec('COMMIT');
          row = q.aGet.get(attemptId, a.participantId);
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      return send(res, 200, attemptView(row, q.pById.get(a.participantId)));
    }

    // 团队负责人查看团队汇总（凭团队报告码，不需要管理员口令）
    if (method === 'POST' && p === '/api/team/report') {
      if (!limit('teamkey:' + ip, 60, 10 * 60_000)) throw new HttpError(429, '请求过于频繁，请稍后再试');
      const body = await readJson(req);
      const key = normKey(body.key);
      const team = key.length === 12 ? q.tByKey.get(keyHash(key)) : null;
      if (!team) {
        if (!limit('teamfail:' + ip, 10, 15 * 60_000)) throw new HttpError(429, '尝试次数过多，请稍后再试');
        throw new HttpError(401, '团队报告码不正确');
      }
      const tz = Math.max(-840, Math.min(840, Number(body.tz) || 0));
      const rep = buildReport(team.id, tz);
      const minGroup = Number(config.teamMinGroup) || 0;
      const insufficient = rep.submitted < minGroup;
      const out = { team: { name: team.name, shareNames: !!team.share_names, closed: !!team.closed }, minGroup, insufficient };
      if (insufficient) Object.assign(out, { participants: rep.participants, submitted: rep.submitted, drafts: rep.drafts });
      else out.report = rep;
      if (team.share_names) {
        out.members = db.prepare("SELECT p.name,a.primary_anchors,a.submitted_at FROM attempts a JOIN participants p ON p.id=a.participant_id WHERE a.team_id=? AND a.status='submitted' ORDER BY a.submitted_at DESC").all(team.id).map((r) => ({ name: r.name, primary: JSON.parse(r.primary_anchors), submittedAt: r.submitted_at }));
      }
      return send(res, 200, out);
    }

    const m = /^\/api\/attempts\/(\d+)(?:\/(answers|submit))?$/.exec(p);
    if (m) {
      const a = auth(req);
      const row = q.aGet.get(Number(m[1]), a.participantId);
      if (!row) throw new HttpError(404, '记录不存在');
      const participant = q.pById.get(a.participantId);
      const order = JSON.parse(row.question_order);

      if (method === 'GET' && !m[2]) return send(res, 200, attemptView(row, participant));

      if (method === 'PUT' && m[2] === 'answers') {
        if (row.status !== 'draft') throw new HttpError(409, '该测试已提交');
        const body = await readJson(req);
        const merged = { ...JSON.parse(row.answers), ...validateAnswers(order, body.answers) };
        q.aSaveAnswers.run(JSON.stringify(merged), row.id);
        return send(res, 200, { saved: Object.keys(merged).length });
      }

      if (method === 'POST' && m[2] === 'submit') {
        if (row.status !== 'draft') throw new HttpError(409, '该测试已提交');
        const body = await readJson(req);
        const merged = { ...JSON.parse(row.answers), ...(body.answers ? validateAnswers(order, body.answers) : {}) };
        const picks = config.top3Bonus ? (Array.isArray(body.picks) ? body.picks.map(Number) : []) : [];
        if (config.top3Bonus && picks.length !== 3) throw new HttpError(400, '请选出 3 道最认同的题目');
        let result;
        try { result = score(questions, merged, picks); } catch (e) { throw new HttpError(400, e.message); }
        const t = now();
        const r = q.aSubmit.run(JSON.stringify(merged), JSON.stringify(picks), JSON.stringify(result.scores), JSON.stringify(result.primary), t, row.id);
        if (!r.changes) throw new HttpError(409, '该测试已提交');
        return send(res, 200, attemptView(q.aGet.get(row.id, a.participantId), participant));
      }
    }

    if (p.startsWith('/api/admin/')) {
      adminAuth(req);
      if (method === 'GET' && p === '/api/admin/attempts') {
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const size = 20;
        const kw = (url.searchParams.get('q') || '').trim().toLowerCase();
        const status = url.searchParams.get('status');
        const where = []; const args = [];
        if (kw) { where.push("(lower(p.name) LIKE ? ESCAPE '\\' OR p.email_norm LIKE ? ESCAPE '\\')"); const like = '%' + kw.replace(/[\\%_]/g, '\\$&') + '%'; args.push(like, like); }
        if (status === 'draft' || status === 'submitted') { where.push('a.status=?'); args.push(status); }
        const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const total = db.prepare(`SELECT COUNT(*) c FROM attempts a JOIN participants p ON p.id=a.participant_id ${W}`).get(...args).c;
        const rows = db.prepare(`SELECT a.id,p.id pid,p.name,p.email,a.status,a.primary_anchors,a.scores,a.started_at,a.submitted_at,tm.name teamName FROM attempts a JOIN participants p ON p.id=a.participant_id LEFT JOIN teams tm ON tm.id=a.team_id ${W} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
        return send(res, 200, { total, page, size, rows: rows.map((r) => ({ id: r.id, participantId: r.pid, name: r.name, email: r.email, status: r.status, primary: r.primary_anchors ? JSON.parse(r.primary_anchors) : null, scores: r.scores ? JSON.parse(r.scores) : null, startedAt: r.started_at, submittedAt: r.submitted_at, team: r.teamName })) });
      }
      // 注册了但还没有答题记录的用户在记录列表里看不到，这里按姓名/邮箱列出所有用户
      if (p === '/api/admin/participants' && method === 'GET') {
        const kw = (url.searchParams.get('q') || '').trim().toLowerCase();
        const like = '%' + kw.replace(/[\\%_]/g, '\\$&') + '%';
        const rows = db.prepare(`SELECT p.id,p.name,p.email,p.created_at,(SELECT COUNT(*) FROM attempts a WHERE a.participant_id=p.id) attempts FROM participants p ${kw ? "WHERE lower(p.name) LIKE ? ESCAPE '\\' OR p.email_norm LIKE ? ESCAPE '\\'" : ''} ORDER BY p.id DESC LIMIT 100`).all(...(kw ? [like, like] : []));
        return send(res, 200, { rows: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, attempts: r.attempts, createdAt: r.created_at })) });
      }
      // 数据库备份：服务端生成一致性副本（VACUUM INTO），去掉登录会话后下载；备份里密钥只有哈希
      if (method === 'GET' && p === '/api/admin/backup') {
        if (!limit('backup', 20, 3600_000)) throw new HttpError(429, '备份下载过于频繁，请稍后再试');
        const tmp = path.join(os.tmpdir(), `ca-backup-${crypto.randomBytes(6).toString('hex')}.db`);
        try {
          db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
          const copy = new DatabaseSync(tmp);
          copy.exec('DELETE FROM sessions');
          copy.exec('VACUUM');
          copy.close();
          const buf = fs.readFileSync(tmp);
          const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
          return send(res, 200, buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="career-anchor-${stamp}.db"` });
        } finally { for (const f of [tmp, tmp + '-wal', tmp + '-shm']) fs.rmSync(f, { force: true }); }
      }
      // 清理长期无活动的数据：先预览，再执行
      const staleSql = 'SELECT p.id FROM participants p WHERE COALESCE((SELECT MAX(COALESCE(a.submitted_at,a.started_at)) FROM attempts a WHERE a.participant_id=p.id), p.created_at) < ?';
      if (p === '/api/admin/purge-preview' && method === 'GET') {
        const months = Number(url.searchParams.get('months'));
        if (!Number.isInteger(months) || months < 1 || months > 120) throw new HttpError(400, '月数需为 1–120 的整数');
        const cutoff = now() - months * 30 * 86400_000;
        return send(res, 200, { months, cutoff, count: db.prepare(staleSql).all(cutoff).length });
      }
      if (p === '/api/admin/purge' && method === 'POST') {
        const body = await readJson(req);
        const months = Number(body.months);
        if (!Number.isInteger(months) || months < 1 || months > 120) throw new HttpError(400, '月数需为 1–120 的整数');
        const ids = db.prepare(staleSql).all(now() - months * 30 * 86400_000).map((r) => r.id);
        const del = db.prepare('DELETE FROM participants WHERE id=?');
        db.exec('BEGIN IMMEDIATE');
        try { for (const id of ids) del.run(id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
        return send(res, 200, { deleted: ids.length });
      }
      if (method === 'GET' && p === '/api/admin/stats') {
        const dist = Object.fromEntries(ANCHOR_ORDER.map((c) => [c, 0]));
        let submitted = 0;
        for (const r of db.prepare("SELECT primary_anchors FROM attempts WHERE status='submitted'").all()) { submitted++; for (const c of JSON.parse(r.primary_anchors)) dist[c]++; }
        const participants = db.prepare('SELECT COUNT(*) c FROM participants').get().c;
        const drafts = db.prepare("SELECT COUNT(*) c FROM attempts WHERE status='draft'").get().c;
        return send(res, 200, { participants, submitted, drafts, distribution: dist });
      }
      if (method === 'GET' && p === '/api/admin/report') {
        const tz = Math.max(-840, Math.min(840, Number(url.searchParams.get('tz')) || 0)); // 客户端时区偏移（分钟，东区为正）
        const tid = Number(url.searchParams.get('team')) || null;
        const team = tid ? q.tById.get(tid) : null;
        if (tid && !team) throw new HttpError(404, '团队不存在');
        return send(res, 200, { ...buildReport(tid, tz), team: team ? { id: team.id, name: team.name } : null });
      }
      if (p === '/api/admin/codes' && method === 'POST') {
        const body = await readJson(req);
        let teamId = null;
        if (body.teamId !== undefined && body.teamId !== null && body.teamId !== '') {
          teamId = Number(body.teamId);
          if (!q.tById.get(teamId)) throw new HttpError(400, '团队不存在');
        }
        return send(res, 200, { codes: createCodes(body, teamId) });
      }
      if (p === '/api/admin/teams' && method === 'POST') {
        const body = await readJson(req);
        const name = String(body.name || '').trim();
        if (!name || name.length > 60) throw new HttpError(400, '团队名称需为 1–60 个字符');
        const note = String(body.note || '').trim().slice(0, 200);
        const key = genCode(12);
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = db.prepare('INSERT INTO teams(name,note,created_at,key_hash,share_names) VALUES(?,?,?,?,?)').run(name, note, now(), keyHash(key), body.shareNames ? 1 : 0);
          const id = Number(r.lastInsertRowid);
          const code = body.code ? createCodes({ ...body.code, kind: 'shared', note: body.code.note || name }, id)[0] : null;
          db.exec('COMMIT');
          return send(res, 200, { team: { id, name, note, shareNames: !!body.shareNames }, reportKey: showKey(key), code });
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      if (p === '/api/admin/teams' && method === 'GET') {
        const rows = db.prepare(`SELECT t.*,
            (SELECT COUNT(DISTINCT participant_id) FROM attempts a WHERE a.team_id=t.id) members,
            (SELECT COUNT(*) FROM attempts a WHERE a.team_id=t.id AND a.status='submitted') submitted,
            (SELECT COUNT(*) FROM attempts a WHERE a.team_id=t.id AND a.status='draft') drafts
          FROM teams t ORDER BY t.id DESC`).all();
        const codesOf = db.prepare('SELECT c.id,c.code,c.kind,c.expires_at,c.max_uses,c.voided,(SELECT COUNT(*) FROM code_uses u WHERE u.code_id=c.id) uses FROM codes c WHERE c.team_id=? ORDER BY c.id DESC LIMIT 20');
        return send(res, 200, { teams: rows.map((t) => ({ id: t.id, name: t.name, note: t.note, createdAt: t.created_at, shareNames: !!t.share_names, closed: !!t.closed, members: t.members, submitted: t.submitted, drafts: t.drafts, codes: codesOf.all(t.id).map((c) => ({ id: c.id, code: showCode(c.code, c.kind), kind: c.kind, expiresAt: c.expires_at, maxUses: c.max_uses, voided: !!c.voided, uses: c.kind === 'shared' ? c.uses : 0 })) })) });
      }
      const tm = /^\/api\/admin\/teams\/(\d+)\/(update|regen-key)$/.exec(p);
      if (tm && method === 'POST') {
        const id = Number(tm[1]);
        const team = q.tById.get(id);
        if (!team) throw new HttpError(404, '团队不存在');
        if (tm[2] === 'regen-key') {
          const key = genCode(12);
          db.prepare('UPDATE teams SET key_hash=? WHERE id=?').run(keyHash(key), id);
          return send(res, 200, { reportKey: showKey(key) });
        }
        const body = await readJson(req);
        const name = body.name === undefined ? team.name : String(body.name).trim();
        if (!name || name.length > 60) throw new HttpError(400, '团队名称需为 1–60 个字符');
        db.prepare('UPDATE teams SET name=?, note=?, share_names=?, closed=? WHERE id=?').run(name, body.note === undefined ? team.note : String(body.note).trim().slice(0, 200), body.shareNames === undefined ? team.share_names : body.shareNames ? 1 : 0, body.closed === undefined ? team.closed : body.closed ? 1 : 0, id);
        return send(res, 200, { ok: true });
      }
      // 状态：active 当前可用 / used 已用完（一次性码已使用，或通用码名额已满）/ expired 已过期 / voided 已作废
      const stNow = now();
      const COND = {
        voided: 'c.voided=1',
        used: `c.voided=0 AND ((c.kind='single' AND c.used_at IS NOT NULL) OR (c.kind='shared' AND c.max_uses IS NOT NULL AND (SELECT COUNT(*) FROM code_uses u WHERE u.code_id=c.id)>=c.max_uses))`,
        expired: `c.voided=0 AND c.expires_at IS NOT NULL AND c.expires_at<=${stNow} AND NOT (c.kind='single' AND c.used_at IS NOT NULL)`,
      };
      COND.active = `c.voided=0 AND (c.expires_at IS NULL OR c.expires_at>${stNow}) AND NOT (${COND.used})`;
      if (p === '/api/admin/codes' && method === 'GET') {
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const size = 50;
        const st = url.searchParams.get('status');
        const W = COND[st] ? 'WHERE ' + COND[st] : '';
        const total = db.prepare(`SELECT COUNT(*) c FROM codes c ${W}`).get().c;
        const rows = db.prepare(`SELECT c.id,c.code,c.note,c.kind,c.created_at,c.used_at,c.voided,c.expires_at,c.max_uses,p.name,tm.name teamName,
            (SELECT COUNT(*) FROM code_uses u WHERE u.code_id=c.id) uses,
            CASE WHEN ${COND.voided} THEN 'voided' WHEN ${COND.used} THEN 'used' WHEN ${COND.expired} THEN 'expired' ELSE 'active' END state
          FROM codes c LEFT JOIN participants p ON p.id=c.participant_id LEFT JOIN teams tm ON tm.id=c.team_id ${W} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(size, (page - 1) * size);
        const cnt = (k) => db.prepare(`SELECT COUNT(*) c FROM codes c WHERE ${COND[k]}`).get().c;
        const summary = { total: db.prepare('SELECT COUNT(*) c FROM codes').get().c, active: cnt('active'), used: cnt('used'), expired: cnt('expired'), voided: cnt('voided') };
        return send(res, 200, { total, page, size, summary, rows: rows.map((r) => ({ id: r.id, code: showCode(r.code, r.kind), kind: r.kind, note: r.note, state: r.state, createdAt: r.created_at, expiresAt: r.expires_at, maxUses: r.max_uses, uses: r.kind === 'shared' ? r.uses : (r.used_at ? 1 : 0), usedAt: r.used_at, usedBy: r.kind === 'single' ? r.name : null, team: r.teamName })) });
      }
      if (p === '/api/admin/codes/export.csv' && method === 'GET') {
        const rows = db.prepare(`SELECT c.code,c.note,c.kind,c.created_at,c.used_at,c.expires_at,c.max_uses,p.name,tm.name teamName,(SELECT COUNT(*) FROM code_uses u WHERE u.code_id=c.id) uses,
            CASE WHEN ${COND.voided} THEN 'voided' WHEN ${COND.used} THEN 'used' WHEN ${COND.expired} THEN 'expired' ELSE 'active' END state
          FROM codes c LEFT JOIN participants p ON p.id=c.participant_id LEFT JOIN teams tm ON tm.id=c.team_id ORDER BY c.id`).all();
        const iso = (t) => (t ? new Date(t).toISOString() : '');
        const label = { active: '可用', used: '已用完', expired: '已过期', voided: '已作废' };
        const lines = [['兑换码', '类型', '团队', '备注', '状态', '已使用人数', '人数上限', '使用者', '创建时间', '到期时间', '使用时间'].map(csvCell).join(',')];
        for (const r of rows) lines.push([showCode(r.code, r.kind), r.kind === 'shared' ? '通用码' : '一次性码', r.teamName || '', r.note, label[r.state], r.kind === 'shared' ? r.uses : (r.used_at ? 1 : 0), r.max_uses ?? '', r.kind === 'single' ? r.name || '' : '', iso(r.created_at), iso(r.expires_at), iso(r.used_at)].map(csvCell).join(','));
        return send(res, 200, '﻿' + lines.join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="redeem-codes.csv"' });
      }
      const cm = /^\/api\/admin\/codes\/(\d+)\/(void|extend|restore|limit)$/.exec(p);
      if (cm && method === 'POST') {
        const id = Number(cm[1]);
        if (cm[2] === 'void') {
          const r = db.prepare("UPDATE codes SET voided=1 WHERE id=? AND voided=0 AND (kind='shared' OR used_at IS NULL)").run(id);
          if (!r.changes) throw new HttpError(409, '这个兑换码不能作废（已作废，或一次性码已被使用）');
          return send(res, 200, { ok: true });
        }
        if (cm[2] === 'restore') {
          const r = db.prepare("UPDATE codes SET voided=0 WHERE id=? AND voided=1 AND instr(code,'#')=0").run(id);
          if (!r.changes) throw new HttpError(409, '只有已作废的兑换码可以恢复（已归档的旧码不能恢复，请重新生成）');
          return send(res, 200, { ok: true });
        }
        if (cm[2] === 'limit') {
          const body = await readJson(req);
          const row = db.prepare('SELECT kind FROM codes WHERE id=?').get(id);
          if (!row) throw new HttpError(404, '兑换码不存在');
          if (row.kind !== 'shared') throw new HttpError(400, '只有通用码可以设置人数上限');
          let maxUses = null;
          if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== '') {
            maxUses = Number(body.maxUses);
            if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000) throw new HttpError(400, '最多使用人数需为 1–100000 的整数');
          }
          db.prepare('UPDATE codes SET max_uses=? WHERE id=?').run(maxUses, id);
          return send(res, 200, { ok: true, maxUses });
        }
        const body = await readJson(req);
        if (body.hours === '' || body.hours === null) { // 留空 = 取消有效期限制
          const r0 = db.prepare('UPDATE codes SET expires_at=NULL WHERE id=? AND voided=0').run(id);
          if (!r0.changes) throw new HttpError(409, '已作废的兑换码不能修改有效期');
          return send(res, 200, { ok: true, expiresAt: null });
        }
        const h = Number(body.hours);
        if (!(h > 0 && h <= 24 * 365)) throw new HttpError(400, '有效时长需大于 0 且不超过 8760 小时');
        const r = db.prepare('UPDATE codes SET expires_at=? WHERE id=? AND voided=0').run(now() + Math.round(h * 3600_000), id);
        if (!r.changes) throw new HttpError(409, '已作废的兑换码不能修改有效期');
        return send(res, 200, { ok: true, expiresAt: now() + Math.round(h * 3600_000) });
      }
      if (method === 'GET' && p === '/api/admin/attempts/export.csv') {
        const rows = db.prepare('SELECT a.id,p.name,p.email,a.status,a.primary_anchors,a.scores,a.started_at,a.submitted_at,tm.name teamName FROM attempts a JOIN participants p ON p.id=a.participant_id LEFT JOIN teams tm ON tm.id=a.team_id ORDER BY a.id').all();
        const iso = (t) => (t ? new Date(t).toISOString() : '');
        const lines = [['报告编号', '姓名', '邮箱', '团队', '状态', '主职业锚', ...ANCHOR_ORDER.map((c) => anchors[c].name), '开始时间', '提交时间'].map(csvCell).join(',')];
        for (const r of rows) {
          const sc = r.scores ? JSON.parse(r.scores) : {};
          const prim = r.primary_anchors ? JSON.parse(r.primary_anchors).map((c) => anchors[c].name).join('/') : '';
          lines.push([reportNo(r), r.name, r.email, r.teamName || '', r.status === 'submitted' ? '已提交' : '进行中', prim, ...ANCHOR_ORDER.map((c) => sc[c] ?? ''), iso(r.started_at), iso(r.submitted_at)].map(csvCell).join(','));
        }
        return send(res, 200, '﻿' + lines.join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="career-anchor.csv"' });
      }
      const am = /^\/api\/admin\/attempts\/(\d+)$/.exec(p);
      if (method === 'GET' && am) {
        const row = db.prepare('SELECT * FROM attempts WHERE id=?').get(Number(am[1]));
        if (!row) throw new HttpError(404, '记录不存在');
        return send(res, 200, attemptView(row, q.pById.get(row.participant_id)));
      }
      const pm = /^\/api\/admin\/participants\/(\d+)(?:\/(reset-key))?$/.exec(p);
      if (pm) {
        const id = Number(pm[1]);
        if (!q.pById.get(id)) throw new HttpError(404, '用户不存在');
        if (method === 'POST' && pm[2] === 'reset-key') {
          q.pSetKey.run(null, id);
          db.prepare('DELETE FROM sessions WHERE participant_id=?').run(id);
          return send(res, 200, { ok: true });
        }
        if (method === 'DELETE' && !pm[2]) {
          db.prepare('DELETE FROM participants WHERE id=?').run(id);
          return send(res, 200, { ok: true });
        }
      }
      throw new HttpError(404, '接口不存在');
    }

    if (p.startsWith('/api/')) throw new HttpError(404, '接口不存在');

    // 静态文件
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, '不支持的方法');
    let rel = decodeURIComponent(p);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, '禁止访问');
    let st;
    try { st = fs.statSync(file); } catch { throw new HttpError(404, '页面不存在'); }
    if (!st.isFile()) throw new HttpError(404, '页面不存在');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      await route(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: '服务器错误' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`职业锚测试已启动： http://localhost:${port}` + (process.env.ADMIN_PASSWORD ? '' : '（未设置 ADMIN_PASSWORD，管理后台关闭）')));
}

module.exports = { createApp };
