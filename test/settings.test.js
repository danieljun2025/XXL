'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/server');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-settings-'));
const dbPath = path.join(dir, 'live.db');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function withApp(fn) {
  const server = createApp({ dbPath, adminPassword: 'admin-pass', config: { enterPerMin: 100000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, token) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  try { await fn(call); } finally { await new Promise((r) => server.close(r)); }
}

test('每页题数默认 5；后台可以改，答题接口同步生效，校验取值与权限', async () => {
  await withApp(async (call) => {
    assert.equal((await call('GET', '/api/config')).body.pageSize, 5);
    assert.equal((await call('GET', '/api/admin/settings')).status, 401);
    assert.equal((await call('POST', '/api/admin/settings', { pageSize: 10 })).status, 401);
    const s = await call('GET', '/api/admin/settings', null, 'admin-pass');
    assert.deepEqual([s.body.pageSize, s.body.defaultPageSize], [5, 5]);
    assert.deepEqual(s.body.allowed, [1, 2, 5, 10, 20]);
    for (const bad of [0, 3, 7, 21, 1.5, 'x', null]) assert.equal((await call('POST', '/api/admin/settings', { pageSize: bad }, 'admin-pass')).status, 400, String(bad));
    const t = (await call('POST', '/api/enter', { name: '设', email: 's@x.com', key: 'secret1' })).body.token;
    assert.equal((await call('POST', '/api/attempts', {}, t)).body.config.pageSize, 5);
    assert.equal((await call('POST', '/api/admin/settings', { pageSize: 10 }, 'admin-pass')).body.pageSize, 10);
    assert.equal((await call('GET', '/api/config')).body.pageSize, 10);
    assert.equal((await call('POST', '/api/attempts', {}, t)).body.config.pageSize, 10); // 答到一半的人下次进入按新设置
  });
});

test('设置保存在数据库里，重启后仍然有效', async () => {
  await withApp(async (call) => {
    assert.equal((await call('GET', '/api/config')).body.pageSize, 10);
    assert.equal((await call('POST', '/api/admin/settings', { pageSize: 1 }, 'admin-pass')).status, 200);
  });
  await withApp(async (call) => {
    assert.equal((await call('GET', '/api/config')).body.pageSize, 1);
    assert.equal((await call('GET', '/api/admin/settings', null, 'admin-pass')).body.pageSize, 1);
  });
});
