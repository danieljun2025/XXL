'use strict';
// 发布后的冒烟检查：node tools/smoke.js <网址>
// 只做只读请求；不写数据，不需要口令。
const base = (process.argv[2] || process.env.SMOKE_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('用法：npm run smoke -- https://anchor.matchgamers.com');
  process.exit(2);
}

const checks = [
  ['首页可打开', async () => { const r = await get('/'); ok(r.status === 200, `状态 ${r.status}`); ok(r.text.includes('职业锚'), '页面里没有「职业锚」'); }],
  ['配置接口返回 8 个职业锚', async () => { const r = await get('/api/config'); ok(r.status === 200, `状态 ${r.status}`); const d = JSON.parse(r.text); ok(d.order && d.order.length === 8 && d.anchors, '字段不完整'); }],
  ['后台页面可打开', async () => { const r = await get('/admin.html'); ok(r.status === 200, `状态 ${r.status}`); }],
  ['报表接口需要口令', async () => { const r = await get('/api/admin/report'); ok(r.status === 401 || r.status === 503, `未带口令应拒绝，实际 ${r.status}`); }],
  ['团队报告码错误被拒绝', async () => { const r = await post('/api/team/report', { key: 'ZZZZ-ZZZZ-ZZZZ' }); ok(r.status === 401 || r.status === 404 || r.status === 429, `实际 ${r.status}`); }],
  ['注册接口会校验输入', async () => { const r = await post('/api/enter', { name: 'x', email: 'bad', key: '1' }); ok(r.status === 400 || r.status === 429, `实际 ${r.status}`); }],
];

function ok(cond, msg) { if (!cond) throw new Error(msg); }
async function req(path, opts) {
  const t = Date.now();
  const res = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...opts });
  return { status: res.status, text: await res.text(), ms: Date.now() - t };
}
const get = (p) => req(p);
const post = (p, body) => req(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  通过  ${name}`); } catch (e) { failed++; console.log(`  失败  ${name}：${e.message}`); }
  }
  console.log(failed ? `\n${failed} 项失败（${base}）` : `\n全部通过（${base}）`);
  process.exit(failed ? 1 : 0);
})();
