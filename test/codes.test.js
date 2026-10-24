'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/server');

let server, base;
test.before(async () => {
  server = createApp({ dbPath: ':memory:', adminPassword: 'admin-pass', config: { requireCode: true, enterPerMin: 1000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((r) => server.close(r)));

async function call(method, path, body, token) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
}
const admin = (m, p, b) => call(m, p, b, 'admin-pass');
const login = async (n) => (await call('POST', '/api/enter', { name: 'U' + n, email: `u${n}@x.com`, key: 'secret' + n })).body.token;

test('配置对外声明需要兑换码', async () => {
  assert.equal((await call('GET', '/api/config')).body.requireCode, true);
});

test('管理员生成兑换码：数量校验、格式、需要口令', async () => {
  assert.equal((await call('POST', '/api/admin/codes', { count: 3 })).status, 401);
  assert.equal((await admin('POST', '/api/admin/codes', { count: 0 })).status, 400);
  assert.equal((await admin('POST', '/api/admin/codes', { count: 201 })).status, 400);
  const r = await admin('POST', '/api/admin/codes', { count: 5, note: '订单 A001' });
  assert.equal(r.status, 200);
  assert.equal(r.body.codes.length, 5);
  assert.ok(r.body.codes.every((c) => /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(c.code)));
  assert.equal(new Set(r.body.codes.map((c) => c.code)).size, 5);
});

test('没有码或码无效时不能开始答题，也不会消耗任何码', async () => {
  const t = await login(1);
  assert.equal((await call('POST', '/api/attempts', {}, t)).status, 400);
  assert.equal((await call('POST', '/api/attempts', { code: 'AAAA-BBBB' }, t)).status, 400);
  const list = await admin('GET', '/api/admin/codes?status=used');
  assert.equal(list.body.total, 0);
});

test('有效兑换码只能用一次，忽略大小写与连字符；使用后可继续作答而不再需要码', async () => {
  const { body } = await admin('POST', '/api/admin/codes', { count: 2, note: '一次性' });
  const [c1, c2] = body.codes.map((c) => c.code);
  const t1 = await login(2), t2 = await login(3);
  const a = await call('POST', '/api/attempts', { code: c1.toLowerCase().replace('-', ' ') }, t1);
  assert.equal(a.status, 200);
  assert.equal(a.body.questions.length, 40);
  // 同一个码被别人再用：失败
  assert.equal((await call('POST', '/api/attempts', { code: c1 }, t2)).status, 400);
  // 已有未完成的测试：不需要码，返回同一份草稿
  const again = await call('POST', '/api/attempts', {}, t1);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, a.body.id);
  // 另一个码正常
  assert.equal((await call('POST', '/api/attempts', { code: c2 }, t2)).status, 200);
  // 后台能看到使用者
  const used = await admin('GET', '/api/admin/codes?status=used');
  assert.ok(used.body.rows.some((r) => r.code === c1 && r.usedBy === 'U2'));
});

test('并发抢同一个码：只有一人成功，其余不产生答题记录', async () => {
  const { body } = await admin('POST', '/api/admin/codes', { count: 1 });
  const code = body.codes[0].code;
  const tokens = await Promise.all([10, 11, 12, 13, 14].map(login));
  const res = await Promise.all(tokens.map((t) => call('POST', '/api/attempts', { code }, t)));
  assert.equal(res.filter((r) => r.status === 200).length, 1);
  assert.equal(res.filter((r) => r.status === 400).length, 4);
  const me = await Promise.all(tokens.map((t) => call('GET', '/api/me', null, t)));
  assert.equal(me.reduce((n, r) => n + r.body.attempts.length, 0), 1);
});

test('作废：只能作废未使用的；作废后不可使用', async () => {
  const { body } = await admin('POST', '/api/admin/codes', { count: 2 });
  const [v, u] = body.codes;
  assert.equal((await admin('POST', `/api/admin/codes/${v.id}/void`)).status, 200);
  assert.equal((await call('POST', '/api/attempts', { code: v.code }, await login(20))).status, 400);
  assert.equal((await call('POST', '/api/attempts', { code: u.code }, await login(21))).status, 200);
  assert.equal((await admin('POST', `/api/admin/codes/${u.id}/void`)).status, 409); // 已使用
  assert.equal((await admin('POST', `/api/admin/codes/${v.id}/void`)).status, 409); // 已作废
});

test('列表、汇总与 CSV 导出', async () => {
  const all = await admin('GET', '/api/admin/codes');
  const s = all.body.summary;
  assert.equal(s.total, s.unused + s.used + s.voided);
  assert.ok(s.used >= 4 && s.voided >= 1 && s.unused >= 1);
  assert.equal((await admin('GET', '/api/admin/codes?status=unused')).body.rows.every((r) => !r.usedAt && !r.voided), true);
  const csv = await admin('GET', '/api/admin/codes/export.csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.body.includes('订单 A001') && csv.body.includes('已使用'));
  assert.equal((await call('GET', '/api/admin/codes/export.csv')).status, 401);
});

test('错误次数过多会被限速', async () => {
  const t = await login(30);
  let last;
  for (let i = 0; i < 31; i++) last = await call('POST', '/api/attempts', { code: 'ZZZZ-ZZZZ' }, t);
  assert.equal(last.status, 429);
});
