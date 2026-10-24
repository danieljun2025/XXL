'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/server');

let server, base;
test.before(async () => {
  server = createApp({ dbPath: ':memory:', adminPassword: 'admin-pass', config: { enterPerMin: 100000 } });
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
const login = async (n) => (await call('POST', '/api/enter', { name: 'T' + n, email: `t${n}@x.com`, key: 'secret' + n })).body.token;
async function finish(token, code, bias) {
  const a = await call('POST', '/api/attempts', code ? { code } : {}, token);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const answers = Object.fromEntries(a.body.questions.map((q) => [q.id, bias(q.id)]));
  const r = await call('POST', `/api/attempts/${a.body.id}/submit`, { answers, picks: a.body.questions.slice(0, 3).map((q) => q.id) }, token);
  assert.equal(r.status, 200);
  return r.body;
}

let team, tcode, tkey;

test('没有团队时不显示兑换码输入框；创建团队后才显示', async () => {
  assert.equal((await call('GET', '/api/config')).body.showCodeField, false);
  assert.equal((await call('POST', '/api/admin/teams', { name: 'x' })).status, 401);
  assert.equal((await admin('POST', '/api/admin/teams', { name: '' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/teams', { name: '好', code: { hours: -1 } })).status, 400);
  const r = await admin('POST', '/api/admin/teams', { name: '销售一部', note: '客户 A', code: { customCode: 'SALES1', maxUses: 50, hours: 24 } });
  assert.equal(r.status, 200);
  team = r.body.team; tcode = r.body.code.code; tkey = r.body.reportKey;
  assert.equal(tcode, 'SALES1');
  assert.match(tkey, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal((await call('GET', '/api/config')).body.showCodeField, true);
});

test('检查团队码：返回团队信息；无效码被拒；没有码也能开始普通测试', async () => {
  const t = await login(1);
  const c = await call('POST', '/api/codes/check', { code: 'sales1' }, t);
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.team, { name: '销售一部', shareNames: false });
  assert.equal((await call('POST', '/api/codes/check', { code: 'NOPE99' }, t)).status, 400);
  assert.equal((await call('POST', '/api/codes/check', { code: 'sales1' })).status, 401);
  // 不带码：普通测试，不属于任何团队（未启用 REQUIRE_CODE）
  const plain = await finish(t, null, () => 3);
  assert.equal(plain.team, undefined);
});

test('用团队码答题：答题记录归属团队，报告里带团队名', async () => {
  const outs = [];
  for (const n of [2, 3]) outs.push(await finish(await login(n), tcode, (id) => (id >= 21 && id <= 25 ? 6 : 2)));
  assert.ok(outs.every((o) => o.team === '销售一部'));
  const rep = await admin('GET', `/api/admin/report?team=${team.id}`);
  assert.equal(rep.body.submitted, 2);
  assert.equal(rep.body.participants, 2);
  assert.equal(rep.body.team.name, '销售一部');
  const all = await admin('GET', '/api/admin/report');
  assert.ok(all.body.submitted >= 3);
  assert.equal((await admin('GET', '/api/admin/report?team=9999')).status, 404);
});

test('负责人凭报告码查看：人数不足 3 人时不显示汇总，也不暴露姓名', async () => {
  assert.equal((await call('POST', '/api/team/report', { key: 'AAAA-BBBB-CCCC' })).status, 401);
  assert.equal((await call('POST', '/api/team/report', {})).status, 401);
  const r = await call('POST', '/api/team/report', { key: tkey.toLowerCase() });
  assert.equal(r.status, 200);
  assert.equal(r.body.insufficient, true);
  assert.equal(r.body.report, undefined);
  assert.equal(r.body.submitted, 2);
  assert.equal(r.body.members, undefined);
  assert.ok(!JSON.stringify(r.body).includes('@'));
});

test('满 3 人后显示汇总；默认不含任何个人信息，开启后才显示姓名和主职业锚', async () => {
  await finish(await login(4), tcode, (id) => (id >= 31 && id <= 35 ? 6 : 2));
  const r = await call('POST', '/api/team/report', { key: tkey, tz: 480 });
  assert.equal(r.body.insufficient, false);
  assert.equal(r.body.report.submitted, 3);
  assert.equal(Object.values(r.body.report.primary).reduce((a, b) => a + b, 0) >= 3, true);
  assert.equal(r.body.members, undefined);
  assert.ok(!JSON.stringify(r.body).includes('T2') && !JSON.stringify(r.body).includes('@'));
  assert.equal((await admin('POST', `/api/admin/teams/${team.id}/update`, { shareNames: true })).status, 200);
  const r2 = await call('POST', '/api/team/report', { key: tkey });
  assert.equal(r2.body.members.length, 3);
  assert.ok(r2.body.members.every((m) => m.name && m.primary.length >= 1 && !('email' in m)));
  const c = await call('POST', '/api/codes/check', { code: tcode }, await login(9));
  assert.equal(c.body.team.shareNames, true);
});

test('报告码不能当管理员口令用；重新生成后旧码失效；关闭团队后不能再加入但仍可看报告', async () => {
  assert.equal((await call('GET', '/api/admin/stats', null, tkey)).status, 401);
  const old = tkey;
  const re = await admin('POST', `/api/admin/teams/${team.id}/regen-key`);
  tkey = re.body.reportKey;
  assert.notEqual(tkey, old);
  assert.equal((await call('POST', '/api/team/report', { key: old })).status, 401);
  assert.equal((await call('POST', '/api/team/report', { key: tkey })).status, 200);
  assert.equal((await admin('POST', `/api/admin/teams/${team.id}/update`, { closed: true })).status, 200);
  const late = await call('POST', '/api/attempts', { code: tcode }, await login(5));
  assert.equal(late.status, 400);
  assert.match(late.body.error, /团队已关闭/);
  assert.equal((await call('POST', '/api/team/report', { key: tkey })).body.team.closed, true);
});

test('后台列表：团队统计、兑换码归属、记录与导出里带团队名', async () => {
  const list = await admin('GET', '/api/admin/teams');
  const t = list.body.teams.find((x) => x.id === team.id);
  assert.equal(t.members, 3);
  assert.equal(t.submitted, 3);
  assert.equal(t.codes[0].code, 'SALES1');
  const codes = await admin('GET', '/api/admin/codes');
  assert.equal(codes.body.rows.find((r) => r.code === 'SALES1').team, '销售一部');
  const attempts = await admin('GET', '/api/admin/attempts');
  assert.ok(attempts.body.rows.some((r) => r.team === '销售一部'));
  const csv = await admin('GET', '/api/admin/attempts/export.csv');
  assert.ok(csv.body.includes('团队') && csv.body.includes('销售一部'));
});

test('一次性码也可以归属团队；团队下的普通测试者不会混入其他团队', async () => {
  const t2 = (await admin('POST', '/api/admin/teams', { name: '二班' })).body;
  const [c] = (await admin('POST', '/api/admin/codes', { kind: 'single', count: 1, teamId: t2.team.id })).body.codes;
  assert.equal((await admin('POST', '/api/admin/codes', { kind: 'single', count: 1, teamId: 9999 })).status, 400);
  const out = await finish(await login(6), c.code, () => 4);
  assert.equal(out.team, '二班');
  assert.equal((await admin('GET', `/api/admin/report?team=${t2.team.id}`)).body.submitted, 1);
  assert.equal((await admin('GET', `/api/admin/report?team=${team.id}`)).body.submitted, 3);
});

test('报告码尝试过多会被限速', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/team/report', { key: 'ZZZZ-ZZZZ-ZZZZ' });
  assert.equal(last.status, 429);
});
