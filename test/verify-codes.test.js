'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/server');
const { verify } = require('../tools/verify-codes');

async function withApp(config, fn) {
  const server = createApp({ dbPath: ':memory:', adminPassword: 'admin-pass', config: { enterPerMin: 100000, ...config } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => server.close(r)); }
}
const admin = (base, p) => fetch(base + p, { headers: { Authorization: 'Bearer admin-pass' } }).then((r) => r.json());

test('验证脚本：在已启用兑换码的服务上全部通过，并清理干净', async () => {
  await withApp({ requireCode: true }, async (base) => {
    const r = await verify(base, 'admin-pass');
    assert.equal(r.ok, true, JSON.stringify(r.results.filter((x) => !x.ok)));
    assert.ok(r.results.length >= 10);
    assert.equal((await admin(base, '/api/admin/stats')).participants, 0);
    const codes = await admin(base, '/api/admin/codes');
    assert.equal(codes.summary.active, 0);
  });
});

test('验证脚本：服务未启用兑换码时明确失败，且不创建任何数据', async () => {
  await withApp({ requireCode: false }, async (base) => {
    const r = await verify(base, 'admin-pass');
    assert.equal(r.ok, false);
    assert.match(r.results[0].error, /REQUIRE_CODE=1/);
    assert.equal((await admin(base, '/api/admin/codes')).summary.total, 0);
  });
});

test('验证脚本：管理员口令错误时失败，不创建数据', async () => {
  await withApp({ requireCode: true }, async (base) => {
    const r = await verify(base, 'wrong');
    assert.equal(r.ok, false);
    assert.equal((await admin(base, '/api/admin/codes')).summary.total, 0);
  });
});

test('管理员可以按姓名/邮箱列出所有用户，包括还没有答题记录的', async () => {
  await withApp({}, async (base) => {
    await fetch(base + '/api/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '只注册', email: 'only-reg@x.com', key: 'secret1' }) });
    assert.equal((await fetch(base + '/api/admin/participants')).status, 401);
    const all = await admin(base, '/api/admin/participants');
    assert.equal(all.rows.length, 1);
    assert.equal(all.rows[0].attempts, 0);
    assert.equal((await admin(base, '/api/admin/participants?q=ONLY-REG')).rows.length, 1);
    assert.equal((await admin(base, '/api/admin/participants?q=%25')).rows.length, 0); // 通配符被转义
    assert.equal((await admin(base, '/api/admin/participants?q=nobody')).rows.length, 0);
  });
});
