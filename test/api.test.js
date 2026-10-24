'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/server');

let server, base;
test.before(async () => {
  server = createApp({ dbPath: ':memory:', adminPassword: 'admin-pass', config: { maxFailedLogins: 3, enterPerMin: 1000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((r) => server.close(r)));

async function call(method, path, body, token, extra = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
}

async function complete(token, bias) {
  const a = (await call('POST', '/api/attempts', null, token)).body;
  const answers = Object.fromEntries(a.questions.map((q) => [q.id, bias(q.id)]));
  const picks = a.questions.slice(0, 3).map((q) => q.id);
  const r = await call('POST', `/api/attempts/${a.id}/submit`, { answers, picks }, token);
  return { a, r };
}

test('新用户 → 答题 → 提交 → 返回结果，题目响应不泄露维度', async () => {
  const e = await call('POST', '/api/enter', { name: '张三', email: 'Zhang@Example.com ', key: 'secret123' });
  assert.equal(e.status, 200);
  assert.equal(e.body.isNew, true);
  const a = (await call('POST', '/api/attempts', null, e.body.token)).body;
  assert.equal(a.questions.length, 40);
  assert.ok(!JSON.stringify(a).includes('anchor'));
  // 草稿保存
  await call('PUT', `/api/attempts/${a.id}/answers`, { answers: { [a.questions[0].id]: 5 } }, e.body.token);
  const again = (await call('POST', '/api/attempts', null, e.body.token)).body;
  assert.equal(again.id, a.id);
  assert.equal(again.answers[a.questions[0].id], 5);
  assert.deepEqual(again.questions, a.questions);
  // 未答完不能提交
  const bad = await call('POST', `/api/attempts/${a.id}/submit`, { picks: [1, 2, 3] }, e.body.token);
  assert.equal(bad.status, 400);
  const { r } = await complete(e.body.token, (id) => (id >= 21 && id <= 25 ? 6 : 2));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'submitted');
  assert.ok(r.body.primary.includes('EC'));
  assert.equal(Object.keys(r.body.scores).length, 8);
  // 重复提交
  assert.equal((await call('POST', `/api/attempts/${a.id}/submit`, { picks: [1, 2, 3] }, e.body.token)).status, 409);
});

test('同邮箱（大小写不同）回访：密钥正确可看到历史，错误被拒且不泄露', async () => {
  const ok = await call('POST', '/api/enter', { email: 'zhang@example.com', key: 'secret123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isNew, false);
  assert.equal(ok.body.attempts[0].status, 'submitted');
  const wrong = await call('POST', '/api/enter', { email: 'zhang@example.com', key: 'wrong-key' });
  const unknown = await call('POST', '/api/enter', { email: 'nobody@example.com', key: 'wrong-key' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
  // 带 name 也不能覆盖已有账号的密钥
  const hijack = await call('POST', '/api/enter', { name: 'X', email: 'zhang@example.com', key: 'newkey123' });
  assert.equal(hijack.status, 401);
});

test('他人无法读取别人的记录；无 token 被拒', async () => {
  const a = (await call('POST', '/api/enter', { name: '甲', email: 'a@x.com', key: 'aaaaaa' })).body;
  const b = (await call('POST', '/api/enter', { name: '乙', email: 'b@x.com', key: 'bbbbbb' })).body;
  const att = (await call('POST', '/api/attempts', null, a.token)).body;
  assert.equal((await call('GET', `/api/attempts/${att.id}`, null, b.token)).status, 404);
  assert.equal((await call('GET', `/api/attempts/${att.id}`)).status, 401);
});

test('连续输错密钥会被锁定', async () => {
  await call('POST', '/api/enter', { name: '丙', email: 'c@x.com', key: 'cccccc' });
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/enter', { email: 'c@x.com', key: 'bad-key' })).status, 401);
  assert.equal((await call('POST', '/api/enter', { email: 'c@x.com', key: 'cccccc' })).status, 429);
});

test('并发：多人同时注册并作答互不影响', async () => {
  const users = await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '/api/enter', { name: 'U' + i, email: `u${i}@x.com`, key: 'key-' + i + '-xx' })));
  assert.ok(users.every((u) => u.status === 200 && u.body.isNew));
  const done = await Promise.all(users.map((u, i) => complete(u.body.token, () => (i % 6) + 1)));
  assert.ok(done.every((d) => d.r.status === 200));
  // 同一邮箱并发注册：只有一个账号
  const race = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/enter', { name: 'R', email: 'race@x.com', key: 'racekey1' })));
  assert.equal(race.filter((r) => r.status === 200 && r.body.isNew).length, 1);
});

test('输入校验', async () => {
  assert.equal((await call('POST', '/api/enter', { name: 'a', email: 'bad', key: '123456' })).status, 400);
  assert.equal((await call('POST', '/api/enter', { name: 'a', email: 'ok@x.com', key: '123' })).status, 400);
  const t = (await call('POST', '/api/enter', { name: '<img src=x>', email: 'xss@x.com', key: '123456' })).body.token;
  const a = (await call('POST', '/api/attempts', null, t)).body;
  assert.equal((await call('PUT', `/api/attempts/${a.id}/answers`, { answers: { 1: 9 } }, t)).status, 400);
  assert.equal((await call('PUT', `/api/attempts/${a.id}/answers`, { answers: { 999: 3 } }, t)).status, 400);
});

test('管理后台：口令保护、列表、统计、导出、重置密钥、删除', async () => {
  assert.equal((await call('GET', '/api/admin/stats')).status, 401);
  assert.equal((await call('GET', '/api/admin/stats', null, 'nope')).status, 401);
  const stats = await call('GET', '/api/admin/stats', null, 'admin-pass');
  assert.equal(stats.status, 200);
  assert.ok(stats.body.submitted >= 21);
  const list = await call('GET', '/api/admin/attempts?q=zhang', null, 'admin-pass');
  assert.equal(list.body.total, 1);
  const csv = await call('GET', '/api/admin/attempts/export.csv', null, 'admin-pass');
  assert.ok(csv.body.includes('zhang@Example.com') || csv.body.includes('Zhang@Example.com'));
  assert.ok(csv.body.includes("'<img") === false);
  const pid = list.body.rows[0].participantId;
  assert.equal((await call('POST', `/api/admin/participants/${pid}/reset-key`, null, 'admin-pass')).status, 200);
  assert.equal((await call('POST', '/api/enter', { email: 'zhang@example.com', key: 'secret123' })).status, 200); // 重置后首次输入即设为新密钥
  assert.equal((await call('POST', '/api/enter', { email: 'zhang@example.com', key: 'secret123' })).status, 200);
  assert.equal((await call('DELETE', `/api/admin/participants/${pid}`, null, 'admin-pass')).status, 200);
  assert.equal((await call('POST', '/api/enter', { email: 'zhang@example.com', key: 'secret123' })).status, 401);
});

test('后台报表：汇总数据与权限', async () => {
  assert.equal((await call('GET', '/api/admin/report')).status, 401);
  const r = await call('GET', '/api/admin/report?tz=480', null, 'admin-pass');
  assert.equal(r.status, 200);
  assert.ok(r.body.submitted >= 20);
  assert.equal(r.body.days.length, 30);
  assert.equal(r.body.days.reduce((a, d) => a + d.count, 0), r.body.submitted);
  assert.equal(Object.keys(r.body.primary).length, 8);
  assert.equal(r.body.durationBins.reduce((a, b) => a + b.count, 0), r.body.submitted);
  assert.ok(r.body.avgScores.TF >= 1 && r.body.avgScores.TF <= 8.4);
  assert.ok(r.body.completionRate > 0 && r.body.completionRate <= 1);
  assert.ok(!JSON.stringify(r.body).includes('@'));
});

test('静态资源与路径穿越', async () => {
  assert.equal((await call('GET', '/')).status, 200);
  assert.ok([403, 404].includes((await call('GET', '/%2e%2e/server/server.js')).status));
  assert.equal((await call('GET', '/..%2fserver%2fserver.js')).status, 403);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
});
