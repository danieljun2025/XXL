'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
  const config = { ...baseConfig, ...(opts.config || {}) };
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
    sInsert: db.prepare('INSERT INTO sessions(token_hash,participant_id,expires_at) VALUES(?,?,?)'),
    sGet: db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?'),
    sDel: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    sPurge: db.prepare('DELETE FROM sessions WHERE expires_at<=?'),
    aList: db.prepare('SELECT id,status,started_at,submitted_at,primary_anchors FROM attempts WHERE participant_id=? ORDER BY id DESC'),
    aGet: db.prepare('SELECT * FROM attempts WHERE id=? AND participant_id=?'),
    aDraft: db.prepare("SELECT * FROM attempts WHERE participant_id=? AND status='draft' ORDER BY id DESC LIMIT 1"),
    aInsert: db.prepare('INSERT INTO attempts(participant_id,seed,question_order,started_at,user_agent,ip_hash) VALUES(?,?,?,?,?,?)'),
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

    if (method === 'GET' && p === '/api/config') return send(res, 200, { top3Bonus: !!config.top3Bonus, pageSize: config.pageSize, anchors, order: ANCHOR_ORDER });

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

    if (method === 'POST' && p === '/api/attempts') {
      const a = auth(req);
      let row = q.aDraft.get(a.participantId);
      if (!row) {
        const seed = crypto.randomInt(1, 2 ** 31);
        const order = shuffleIds(questions.map((x) => x.id), seed);
        const r = q.aInsert.run(a.participantId, seed, JSON.stringify(order), now(), String(req.headers['user-agent'] || '').slice(0, 200), ipHash(ip));
        row = q.aGet.get(Number(r.lastInsertRowid), a.participantId);
      }
      return send(res, 200, attemptView(row, q.pById.get(a.participantId)));
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
        const rows = db.prepare(`SELECT a.id,p.id pid,p.name,p.email,a.status,a.primary_anchors,a.scores,a.started_at,a.submitted_at FROM attempts a JOIN participants p ON p.id=a.participant_id ${W} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
        return send(res, 200, { total, page, size, rows: rows.map((r) => ({ id: r.id, participantId: r.pid, name: r.name, email: r.email, status: r.status, primary: r.primary_anchors ? JSON.parse(r.primary_anchors) : null, scores: r.scores ? JSON.parse(r.scores) : null, startedAt: r.started_at, submittedAt: r.submitted_at })) });
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
        const rows = db.prepare('SELECT participant_id,status,scores,primary_anchors,started_at,submitted_at FROM attempts').all();
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
        return send(res, 200, {
          participants: db.prepare('SELECT COUNT(*) c FROM participants').get().c,
          submitted: done.length, drafts,
          completionRate: rows.length ? done.length / rows.length : null,
          last7: days.slice(-7).reduce((a, d) => a + d.count, 0),
          medianMinutes: mins.length ? Math.round(mins[Math.floor(mins.length / 2)] * 10) / 10 : null,
          retakers: [...doneBy.values()].filter((n) => n > 1).length,
          primary, avgScores: avg, days, durationBins: bins,
        });
      }
      if (method === 'GET' && p === '/api/admin/attempts/export.csv') {
        const rows = db.prepare('SELECT a.id,p.name,p.email,a.status,a.primary_anchors,a.scores,a.started_at,a.submitted_at FROM attempts a JOIN participants p ON p.id=a.participant_id ORDER BY a.id').all();
        const iso = (t) => (t ? new Date(t).toISOString() : '');
        const lines = [['报告编号', '姓名', '邮箱', '状态', '主职业锚', ...ANCHOR_ORDER.map((c) => anchors[c].name), '开始时间', '提交时间'].map(csvCell).join(',')];
        for (const r of rows) {
          const sc = r.scores ? JSON.parse(r.scores) : {};
          const prim = r.primary_anchors ? JSON.parse(r.primary_anchors).map((c) => anchors[c].name).join('/') : '';
          lines.push([reportNo(r), r.name, r.email, r.status === 'submitted' ? '已提交' : '进行中', prim, ...ANCHOR_ORDER.map((c) => sc[c] ?? ''), iso(r.started_at), iso(r.submitted_at)].map(csvCell).join(','));
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
