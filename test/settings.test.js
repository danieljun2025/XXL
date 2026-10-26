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

const flat = (r) => r.body.groups.flatMap((g) => g.items);

test('设置注册表：按分组返回；每页题数默认 5；校验取值、权限、未知键、只读项', async () => {
  await withApp(async (call) => {
    assert.equal((await call('GET', '/api/config')).body.pageSize, 5);
    assert.equal((await call('GET', '/api/admin/settings')).status, 401);
    assert.equal((await call('POST', '/api/admin/settings', { values: { pageSize: 10 } })).status, 401);
    const s = await call('GET', '/api/admin/settings', null, 'admin-pass');
    assert.deepEqual(s.body.groups.map((g) => g.id), ['quiz', 'access', 'data', 'system']);
    const ps = flat(s).find((i) => i.key === 'pageSize');
    assert.deepEqual([ps.value, ps.default, ps.type], [5, 5, 'select']);
    assert.deepEqual(ps.options.map((o) => o.value), [1, 2, 5, 10, 20]);
    assert.ok(flat(s).some((i) => i.type === 'action' && i.action === 'backup'));
    assert.ok(flat(s).filter((i) => i.type === 'readonly').every((i) => typeof i.value === 'string' && i.value));
    const post = (values) => call('POST', '/api/admin/settings', { values }, 'admin-pass');
    for (const bad of [0, 3, 7, 21, 1.5, 'x', '5']) assert.equal((await post({ pageSize: bad })).status, 400, String(bad));
    assert.equal((await post({ nope: 1 })).status, 400);              // 未知键
    assert.equal((await post({ version: 'x' })).status, 400);         // 只读项不能改
    assert.equal((await post({ backup: 1 })).status, 400);            // 操作项不能当设置
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ pageSize: 10, nope: 1 })).status, 400);
    assert.equal((await call('GET', '/api/config')).body.pageSize, 5); // 失败的保存不会改动任何值
    const t = (await call('POST', '/api/enter', { name: '设', email: 's@x.com', key: 'secret1' })).body.token;
    assert.equal((await call('POST', '/api/attempts', {}, t)).body.config.pageSize, 5);
    assert.equal((await post({ pageSize: 10 })).status, 200);
    assert.equal((await call('GET', '/api/config')).body.pageSize, 10);
    assert.equal((await call('POST', '/api/attempts', {}, t)).body.config.pageSize, 10);
  });
});

test('设置保存在数据库里，重启后仍然有效；null 表示恢复默认', async () => {
  await withApp(async (call) => {
    assert.equal((await call('GET', '/api/config')).body.pageSize, 10);
    assert.equal((await call('POST', '/api/admin/settings', { values: { pageSize: 1 } }, 'admin-pass')).status, 200);
  });
  await withApp(async (call) => {
    assert.equal((await call('GET', '/api/config')).body.pageSize, 1);
    assert.equal(flat(await call('GET', '/api/admin/settings', null, 'admin-pass')).find((i) => i.key === 'pageSize').value, 1);
    assert.equal((await call('POST', '/api/admin/settings', { values: { pageSize: null } }, 'admin-pass')).status, 200);
    assert.equal((await call('GET', '/api/config')).body.pageSize, 5);
  });
});

test('新增一个设置只需要登记一条：自动出现在对应分组，并可保存', async () => {
  const server = createApp({
    dbPath: ':memory:', adminPassword: 'admin-pass', config: { enterPerMin: 100000 },
    extraSettings: [{ key: 'fakeFeature', group: 'quiz', type: 'select', label: '假想功能', help: '测试用', options: [{ value: 'on', label: '开' }, { value: 'off', label: '关' }], default: 'on' }],
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (m, p, b) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-pass' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
  try {
    const quiz = (await call('GET', '/api/admin/settings')).groups.find((g) => g.id === 'quiz');
    const f = quiz.items.find((i) => i.key === 'fakeFeature');
    assert.deepEqual([f.value, f.default], ['on', 'on']);
    assert.equal((await call('POST', '/api/admin/settings', { values: { fakeFeature: 'off' } })).ok, true);
    assert.equal((await call('GET', '/api/admin/settings')).groups.find((g) => g.id === 'quiz').items.find((i) => i.key === 'fakeFeature').value, 'off');
    assert.match((await call('POST', '/api/admin/settings', { values: { fakeFeature: 'maybe' } })).error, /假想功能/);
  } finally { await new Promise((r) => server.close(r)); }
});

test('团队汇总最少人数是一个设置：最低 3，可以调高', async () => {
  await withApp(async (call) => {
    const adm = (m, p, b) => call(m, p, b, 'admin-pass');
    const post = (values) => adm('POST', '/api/admin/settings', { values });
    assert.equal((await post({ teamMinGroup: 2 })).status, 400); // 不低于隐私说明承诺的 3
    assert.equal(flat(await adm('GET', '/api/admin/settings')).find((i) => i.key === 'teamMinGroup').value, 3);
    const team = (await adm('POST', '/api/admin/teams', { name: '阈值团队', code: { customCode: 'THRESH' } })).body;
    for (let n = 0; n < 3; n++) {
      const t = (await call('POST', '/api/enter', { name: 'T' + n, email: `th${n}@x.com`, key: 'secret1' })).body.token;
      const a = (await call('POST', '/api/attempts', { code: 'THRESH' }, t)).body;
      const answers = Object.fromEntries(a.questions.map((q) => [q.id, 3]));
      await call('POST', `/api/attempts/${a.id}/submit`, { answers, picks: a.questions.slice(0, 3).map((q) => q.id) }, t);
    }
    const rep = () => call('POST', '/api/team/report', { key: team.reportKey });
    assert.equal((await rep()).body.insufficient, false); // 3 人 ≥ 3
    assert.equal((await post({ teamMinGroup: 5 })).status, 200);
    assert.equal((await rep()).body.insufficient, true);  // 调高到 5 后不显示
    assert.equal((await post({ teamMinGroup: null })).status, 200);
    assert.equal((await rep()).body.insufficient, false);
  });
});

test('概览：关键数字与待办提醒（备份、兑换码状态）', async () => {
  await withApp(async (call) => {
    assert.equal((await call('GET', '/api/admin/overview')).status, 401);
    const o1 = await call('GET', '/api/admin/overview', null, 'admin-pass');
    const todo = (o, id) => o.body.todos.find((t) => t.id === id);
    assert.equal(todo(o1, 'backup').level, 'warn');           // 还没备份过
    assert.match(todo(o1, 'backup').text, /还没有/);
    assert.equal(todo(o1, 'codes').level, 'info');            // 兑换码未启用
    assert.equal(todo(o1, 'service').level, 'ok');
    assert.ok('participants' in o1.body.kpis && 'activeCodes' in o1.body.kpis);
  });
});

test('概览：兑换码已启用但没有可用的码时提醒', async () => {
  const server = createApp({ dbPath: ':memory:', adminPassword: 'admin-pass', config: { enterPerMin: 100000, requireCode: true } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (m, p, b) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-pass' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
  try {
    const codesTodo = async () => (await call('GET', '/api/admin/overview')).todos.find((t) => t.id === 'codes');
    assert.equal((await codesTodo()).level, 'warn');
    assert.match((await codesTodo()).text, /没有可用的兑换码/);
    await call('POST', '/api/admin/codes', { kind: 'shared', maxUses: 10 });
    assert.equal((await codesTodo()).level, 'ok');
    assert.match((await codesTodo()).text, /当前可用 1 个/);
  } finally { await new Promise((r) => server.close(r)); }
});
