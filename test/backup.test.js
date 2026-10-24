'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server/server');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
const dbPath = path.join(dir, 'live.db');
let server, base;
test.before(async () => {
  server = createApp({ dbPath, adminPassword: 'admin-pass', config: { enterPerMin: 100000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, p, body, token) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
async function finish(n) {
  const e = await call('POST', '/api/enter', { name: '备份' + n, email: `b${n}@x.com`, key: 'secret' + n });
  const a = await call('POST', '/api/attempts', {}, e.body.token);
  const answers = Object.fromEntries(a.body.questions.map((q) => [q.id, 4]));
  await call('POST', `/api/attempts/${a.body.id}/submit`, { answers, picks: a.body.questions.slice(0, 3).map((q) => q.id) }, e.body.token);
}

test('备份下载：需要口令；返回有效的 SQLite 文件，数据完整，不含登录会话', async () => {
  await finish(1); await finish(2);
  assert.equal((await call('GET', '/api/admin/backup')).status, 401);
  const r = await call('GET', '/api/admin/backup', null, 'admin-pass');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="career-anchor-\d{12}\.db"$/);
  assert.equal(r.body.subarray(0, 15).toString(), 'SQLite format 3');
  const file = path.join(dir, 'backup.db');
  fs.writeFileSync(file, r.body);
  const db = new DatabaseSync(file);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM participants').get().c, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM attempts WHERE status='submitted'").get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions').get().c, 0);
  assert.ok(db.prepare('SELECT key_hash FROM participants').all().every((p) => p.key_hash.startsWith('scrypt$')));
  db.close();
});

test('恢复演练：用备份文件启动新服务，原用户凭邮箱和密钥登录，历史结果可读', async () => {
  const r = await call('GET', '/api/admin/backup', null, 'admin-pass');
  const restored = path.join(dir, 'restored.db');
  fs.writeFileSync(restored, r.body);
  const s2 = createApp({ dbPath: restored, adminPassword: 'x', config: { enterPerMin: 1000 } });
  await new Promise((ok) => s2.listen(0, '127.0.0.1', ok));
  try {
    const b2 = `http://127.0.0.1:${s2.address().port}`;
    const login = await (await fetch(b2 + '/api/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'b1@x.com', key: 'secret1' }) })).json();
    assert.equal(login.attempts.length, 1);
    assert.equal(login.attempts[0].status, 'submitted');
    const view = await (await fetch(`${b2}/api/attempts/${login.attempts[0].id}`, { headers: { Authorization: 'Bearer ' + login.token } })).json();
    assert.equal(Object.keys(view.scores).length, 8);
  } finally { await new Promise((ok) => s2.close(ok)); }
});

test('清理旧数据：先预览后执行，只删超过期限无活动的用户', async () => {
  const live = new DatabaseSync(dbPath);
  const old = Date.now() - 400 * 86400_000;
  const id = live.prepare("SELECT id FROM participants WHERE email_norm='b2@x.com'").get().id;
  live.prepare('UPDATE participants SET created_at=? WHERE id=?').run(old, id);
  live.prepare('UPDATE attempts SET started_at=?, submitted_at=? WHERE participant_id=?').run(old, old, id);
  live.close();
  assert.equal((await call('GET', '/api/admin/purge-preview?months=12')).status, 401);
  assert.equal((await call('GET', '/api/admin/purge-preview?months=0', null, 'admin-pass')).status, 400);
  const pv = await call('GET', '/api/admin/purge-preview?months=12', null, 'admin-pass');
  assert.equal(pv.body.count, 1);
  assert.equal((await call('POST', '/api/admin/purge', { months: 12 })).status, 401);
  const del = await call('POST', '/api/admin/purge', { months: 12 }, 'admin-pass');
  assert.equal(del.body.deleted, 1);
  const stats = await call('GET', '/api/admin/stats', null, 'admin-pass');
  assert.equal(stats.body.participants, 1);
  assert.equal((await call('GET', '/api/admin/purge-preview?months=12', null, 'admin-pass')).body.count, 0);
});
