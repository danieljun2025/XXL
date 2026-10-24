'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/server');

let server, base;
test.before(async () => {
  server = createApp({ dbPath: ':memory:', adminPassword: 'admin-pass', config: { requireCode: true, enterPerMin: 100000, redeemLimit: 100000 } });
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
  assert.equal(s.total, s.active + s.used + s.expired + s.voided);
  assert.ok(s.used >= 4 && s.voided >= 1 && s.active >= 1);
  assert.equal((await admin('GET', '/api/admin/codes?status=active')).body.rows.every((r) => r.state === 'active'), true);
  const csv = await admin('GET', '/api/admin/codes/export.csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.body.includes('订单 A001') && csv.body.includes('已用完'));
  assert.equal((await call('GET', '/api/admin/codes/export.csv')).status, 401);
});

test('通用码：创建校验（时长、人数上限、自定义码）', async () => {
  assert.equal((await admin('POST', '/api/admin/codes', { kind: 'shared', hours: 0 })).status, 400);
  assert.equal((await admin('POST', '/api/admin/codes', { kind: 'shared', hours: 9999 })).status, 400);
  assert.equal((await admin('POST', '/api/admin/codes', { kind: 'shared', maxUses: 0 })).status, 400);
  assert.equal((await admin('POST', '/api/admin/codes', { kind: 'shared', customCode: 'ab' })).status, 400);
  const r = await admin('POST', '/api/admin/codes', { kind: 'shared', hours: 3, customCode: 'share 2026', note: '分享会' });
  assert.equal(r.status, 200);
  assert.equal(r.body.codes[0].code, 'SHARE2026');
  const left = r.body.codes[0].expiresAt - Date.now();
  assert.ok(left > 2.9 * 3600_000 && left <= 3 * 3600_000);
  assert.equal((await admin('POST', '/api/admin/codes', { kind: 'shared', customCode: 'SHARE-2026' })).status, 409); // 重复
  const auto = await admin('POST', '/api/admin/codes', { kind: 'shared' });
  assert.match(auto.body.codes[0].code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(auto.body.codes[0].expiresAt, null);
});

test('通用码：多人共用，每人限一次，已有草稿可继续', async () => {
  const code = (await admin('POST', '/api/admin/codes', { kind: 'shared', hours: 3 })).body.codes[0].code;
  const tokens = await Promise.all([40, 41, 42, 43].map(login));
  const res = await Promise.all(tokens.map((t) => call('POST', '/api/attempts', { code: code.toLowerCase() }, t)));
  assert.ok(res.every((r) => r.status === 200));
  // 同一个人完成后再拿这个码重测：被拒
  const t = tokens[0];
  const a = res[0].body;
  const answers = Object.fromEntries(a.questions.map((q) => [q.id, 3]));
  assert.equal((await call('POST', `/api/attempts/${a.id}/submit`, { answers, picks: a.questions.slice(0, 3).map((q) => q.id) }, t)).status, 200);
  const again = await call('POST', '/api/attempts', { code }, t);
  assert.equal(again.status, 400);
  assert.match(again.body.error, /已经用这个兑换码/);
  // 列表里显示使用人数
  const row = (await admin('GET', '/api/admin/codes')).body.rows.find((r) => r.code === code);
  assert.equal(row.kind, 'shared');
  assert.equal(row.uses, 4);
  assert.equal(row.state, 'active');
});

test('通用码：人数上限，并发下不超发', async () => {
  const code = (await admin('POST', '/api/admin/codes', { kind: 'shared', maxUses: 3 })).body.codes[0].code;
  const tokens = await Promise.all([50, 51, 52, 53, 54, 55].map(login));
  const res = await Promise.all(tokens.map((t) => call('POST', '/api/attempts', { code }, t)));
  assert.equal(res.filter((r) => r.status === 200).length, 3);
  assert.ok(res.filter((r) => r.status === 400).every((r) => /名额已满/.test(r.body.error)));
  const row = (await admin('GET', '/api/admin/codes?status=used')).body.rows.find((r) => r.code === code);
  assert.equal(row.state, 'used');
});

test('通用码：到期后不能用，延长有效期后恢复；作废立即失效', async () => {
  const c = (await admin('POST', '/api/admin/codes', { kind: 'shared', hours: 0.0004 })).body.codes[0]; // 约 1.4 秒
  assert.equal((await call('POST', '/api/attempts', { code: c.code }, await login(60))).status, 200);
  await new Promise((r) => setTimeout(r, 1700));
  const late = await call('POST', '/api/attempts', { code: c.code }, await login(61));
  assert.equal(late.status, 400);
  assert.match(late.body.error, /已过期/);
  assert.equal((await admin('GET', '/api/admin/codes?status=expired')).body.rows.some((r) => r.id === c.id), true);
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/extend`, { hours: 0 })).status, 400);
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/extend`, { hours: 3 })).status, 200);
  assert.equal((await call('POST', '/api/attempts', { code: c.code }, await login(62))).status, 200);
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/void`)).status, 200);
  const dead = await call('POST', '/api/attempts', { code: c.code }, await login(63));
  assert.equal(dead.status, 400);
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/extend`, { hours: 3 })).status, 409);
});

test('一次性码也可以设置有效期', async () => {
  const c = (await admin('POST', '/api/admin/codes', { count: 1, hours: 0.0004 })).body.codes[0];
  await new Promise((r) => setTimeout(r, 1700));
  const r = await call('POST', '/api/attempts', { code: c.code }, await login(70));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /已过期/);
});

test('通用码：创建后可以修改最多使用人数（调高、调低、改为不限）', async () => {
  const c = (await admin('POST', '/api/admin/codes', { kind: 'shared', maxUses: 1 })).body.codes[0];
  assert.equal((await call('POST', '/api/attempts', { code: c.code }, await login(80))).status, 200);
  const full = await call('POST', '/api/attempts', { code: c.code }, await login(81));
  assert.match(full.body.error, /名额已满/);
  assert.equal((await admin('GET', '/api/admin/codes?status=used')).body.rows.some((r) => r.id === c.id), true);
  // 调高：恢复可用
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/limit`, { maxUses: 3 })).status, 200);
  assert.equal((await call('POST', '/api/attempts', { code: c.code }, await login(81))).status, 200);
  const row = () => admin('GET', '/api/admin/codes').then((r) => r.body.rows.find((x) => x.id === c.id));
  assert.equal((await row()).maxUses, 3);
  assert.equal((await row()).uses, 2);
  // 调到比已用人数还低：不再发放，已使用的人不受影响
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/limit`, { maxUses: 1 })).status, 200);
  assert.match((await call('POST', '/api/attempts', { code: c.code }, await login(82))).body.error, /名额已满/);
  assert.equal((await row()).state, 'used');
  // 改为不限
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/limit`, { maxUses: '' })).status, 200);
  assert.equal((await row()).maxUses, null);
  assert.equal((await call('POST', '/api/attempts', { code: c.code }, await login(82))).status, 200);
  // 校验
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/limit`, { maxUses: 0 })).status, 400);
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/limit`, { maxUses: 1.5 })).status, 400);
  assert.equal((await admin('POST', '/api/admin/codes/99999/limit', { maxUses: 5 })).status, 404);
  assert.equal((await call('POST', `/api/admin/codes/${c.id}/limit`, { maxUses: 5 })).status, 401);
  const single = (await admin('POST', '/api/admin/codes', { kind: 'single', count: 1 })).body.codes[0];
  assert.equal((await admin('POST', `/api/admin/codes/${single.id}/limit`, { maxUses: 5 })).status, 400);
});

test('作废后可以「恢复」，原有使用记录保留', async () => {
  const c = (await admin('POST', '/api/admin/codes', { kind: 'shared' })).body.codes[0];
  assert.equal((await call('POST', '/api/attempts', { code: c.code }, await login(90))).status, 200);
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/restore`)).status, 409); // 还没作废
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/void`)).status, 200);
  assert.equal((await call('POST', '/api/attempts', { code: c.code }, await login(91))).status, 400);
  assert.equal((await admin('POST', `/api/admin/codes/${c.id}/restore`)).status, 200);
  assert.equal((await call('POST', '/api/attempts', { code: c.code }, await login(91))).status, 200);
  const row = (await admin('GET', '/api/admin/codes')).body.rows.find((x) => x.id === c.id);
  assert.equal(row.uses, 2);
  assert.equal(row.state, 'active');
});

test('作废或过期后，可以用同一个文字重新生成新码（旧码归档，计数重新开始）', async () => {
  const old = (await admin('POST', '/api/admin/codes', { kind: 'shared', customCode: 'reuse2026', maxUses: 1 })).body.codes[0];
  assert.equal(old.code, 'REUSE2026');
  const first = await login(100);
  assert.equal((await call('POST', '/api/attempts', { code: 'REUSE2026' }, first)).status, 200);
  // 正在使用中：不能重名
  const dup = await admin('POST', '/api/admin/codes', { kind: 'shared', customCode: 'REUSE2026' });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /先作废/);
  // 作废后可以重新生成
  assert.equal((await admin('POST', `/api/admin/codes/${old.id}/void`)).status, 200);
  const fresh = await admin('POST', '/api/admin/codes', { kind: 'shared', customCode: 'REUSE2026', maxUses: 2, note: '第二批' });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.codes[0].code, 'REUSE2026');
  assert.notEqual(fresh.body.codes[0].id, old.id);
  // 旧码被归档，保留记录
  const rows = (await admin('GET', '/api/admin/codes')).body.rows;
  const archived = rows.find((r) => r.id === old.id);
  assert.equal(archived.code, `REUSE2026#${old.id}`);
  assert.equal(archived.state, 'voided');
  assert.equal(archived.uses, 1);
  // 新码计数重新开始：用过旧码的人可以再用一次新码；新码人数上限独立
  assert.equal((await call('POST', '/api/attempts', { code: 'reuse2026' }, await login(101))).status, 200);
  const info = rows.find((r) => r.id === fresh.body.codes[0].id);
  assert.equal(info.maxUses, 2);
  assert.equal(info.state, 'active');
  // 归档名不能被当作兑换码输入
  assert.equal((await call('POST', '/api/attempts', { code: `REUSE2026#${old.id}` }, await login(102))).status, 400);
  // 已归档的旧码不能恢复（它的名字已经不能被输入）
  assert.equal((await admin('POST', `/api/admin/codes/${old.id}/restore`)).status, 409);
  // 过期的旧码同样可以被同名新码取代
  const exp = (await admin('POST', '/api/admin/codes', { kind: 'shared', customCode: 'SHORTLIVED', hours: 0.0004 })).body.codes[0];
  await new Promise((r) => setTimeout(r, 1700));
  const again = await admin('POST', '/api/admin/codes', { kind: 'shared', customCode: 'shortlived' });
  assert.equal(again.status, 200);
  assert.notEqual(again.body.codes[0].id, exp.id);
});

test('错误次数过多会被限速', async () => {
  const s2 = createApp({ dbPath: ':memory:', adminPassword: 'admin-pass', config: { requireCode: true, enterPerMin: 100000 } });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    const t = (await (await fetch(b2 + '/api/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'L', email: 'l@x.com', key: 'secret1' }) })).json()).token;
    let last;
    for (let i = 0; i < 31; i++) last = await fetch(b2 + '/api/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ code: 'ZZZZ-ZZZZ' }) });
    assert.equal(last.status, 429);
  } finally { await new Promise((r) => s2.close(r)); }
});
