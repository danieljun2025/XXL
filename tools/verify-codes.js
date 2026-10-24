'use strict';
// 兑换码启用后的端到端验证：node tools/verify-codes.js <网址>
// 口令从环境变量 ADMIN_PASSWORD 读取（不要写在命令行里）。
// 会创建临时的验证用户和兑换码，结束时删除验证用户并作废验证码，不留下业务数据。
const ADMIN_PW = () => process.env.ADMIN_PASSWORD || '';

async function verify(base, adminPassword, log = () => {}) {
  base = base.replace(/\/+$/, '');
  const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const results = [];
  const created = { codes: [], emails: [] };

  async function call(method, path, body, token) {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  const admin = (m, p, b) => call(m, p, b, adminPassword);
  let n = 0;
  async function user(tag) {
    const email = `verify-${run}-${tag}-${++n}@example.invalid`;
    created.emails.push(email);
    const r = await call('POST', '/api/enter', { name: '验证用户' + tag, email, key: 'verify-' + run });
    if (r.status !== 200) throw new Error(`创建验证用户失败（${r.status} ${r.body.error || ''}）`);
    return r.body.token;
  }
  async function step(name, fn) {
    try { await fn(); results.push({ name, ok: true }); log(`  通过  ${name}`); }
    catch (e) { results.push({ name, ok: false, error: e.message }); log(`  失败  ${name}：${e.message}`); }
  }
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
  const rejected = (r, re) => { expect(r.status === 400, `应被拒绝（400），实际 ${r.status}`); if (re) expect(re.test(r.body.error || ''), `提示不符：${r.body.error}`); };
  const newCode = async (body) => {
    const r = await admin('POST', '/api/admin/codes', { note: `自动验证 ${run}`, ...body });
    expect(r.status === 200, `生成兑换码失败（${r.status} ${r.body.error || ''}）`);
    created.codes.push(r.body.codes[0]);
    return r.body.codes[0];
  };

  try {
    const cfg = await call('GET', '/api/config');
    if (cfg.status !== 200 || !cfg.body.requireCode) {
      results.push({ name: '服务已启用兑换码（REQUIRE_CODE=1）', ok: false, error: '当前未启用，请先在 Render 环境变量里设置 REQUIRE_CODE=1 并等待重启完成' });
      log('  失败  服务已启用兑换码：当前未启用，请先设置 REQUIRE_CODE=1 并等待重启');
      return { ok: false, results };
    }
    log('  通过  服务已启用兑换码');
    results.push({ name: '服务已启用兑换码', ok: true });
    const probe = await admin('GET', '/api/admin/codes?page=1');
    if (probe.status !== 200) { results.push({ name: '管理员口令有效', ok: false, error: `状态 ${probe.status}` }); log(`  失败  管理员口令有效：状态 ${probe.status}`); return { ok: false, results }; }

    const single = await newCode({ kind: 'single', count: 1 });
    const shared = await newCode({ kind: 'shared', maxUses: 1, hours: 1 });
    const timed = await newCode({ kind: 'shared', hours: 0.0004 }); // 约 1.4 秒
    const toVoid = await newCode({ kind: 'single', count: 1 });
    await admin('POST', `/api/admin/codes/${toVoid.id}/void`);

    const a = await user('A');
    await step('不填兑换码不能开始测试', async () => rejected(await call('POST', '/api/attempts', {}, a), /兑换码/));
    await step('无效兑换码被拒绝', async () => rejected(await call('POST', '/api/attempts', { code: 'ZZZZ-ZZZZ' }, a)));
    await step('有效的一次性码可以开始测试（忽略大小写）', async () => { const r = await call('POST', '/api/attempts', { code: single.code.toLowerCase() }, a); expect(r.status === 200 && r.body.questions && r.body.questions.length === 40, `状态 ${r.status} ${r.body.error || ''}`); });
    await step('已有未完成的测试时继续作答，不再需要兑换码', async () => { const r = await call('POST', '/api/attempts', {}, a); expect(r.status === 200 && r.body.questions, `状态 ${r.status}`); });
    await step('用过的一次性码不能再用', async () => rejected(await call('POST', '/api/attempts', { code: single.code }, await user('B'))));
    await step('通用码按人数上限发放（第一人成功）', async () => { const r = await call('POST', '/api/attempts', { code: shared.code }, await user('C')); expect(r.status === 200, `状态 ${r.status} ${r.body.error || ''}`); });
    await step('通用码名额用完后被拒绝', async () => rejected(await call('POST', '/api/attempts', { code: shared.code }, await user('D')), /名额/));
    await step('已作废的码被拒绝', async () => rejected(await call('POST', '/api/attempts', { code: toVoid.code }, await user('E'))));
    await new Promise((r) => setTimeout(r, 2200));
    await step('过期的码被拒绝', async () => rejected(await call('POST', '/api/attempts', { code: timed.code }, await user('F')), /过期/));
  } catch (e) {
    results.push({ name: '验证过程', ok: false, error: e.message });
    log(`  失败  验证过程：${e.message}`);
  } finally {
    // 清理：删除验证用户，作废验证码
    try {
      let deleted = 0;
      const list = await admin('GET', `/api/admin/participants?q=${encodeURIComponent('verify-' + run)}`);
      const ids = new Set((list.body.rows || []).map((r) => r.id));
      for (const id of ids) { const d = await admin('DELETE', `/api/admin/participants/${id}`); if (d.status === 200) deleted++; }
      for (const c of created.codes) await admin('POST', `/api/admin/codes/${c.id}/void`);
      log(`  清理  已删除 ${deleted} 个验证用户，已作废验证用的兑换码`);
    } catch (e) { log(`  清理失败：${e.message}（请到后台手动删除姓名以"验证用户"开头的用户）`); }
  }
  return { ok: results.every((r) => r.ok), results };
}

module.exports = { verify };

if (require.main === module) {
  const base = process.argv[2] || '';
  if (!/^https?:\/\//.test(base) || !ADMIN_PW()) {
    console.error('用法：先设置环境变量 ADMIN_PASSWORD，再运行\n  PowerShell：$env:ADMIN_PASSWORD="你的口令"; npm run verify:codes -- https://anchor.matchgamers.com\n  macOS/Linux：ADMIN_PASSWORD=你的口令 npm run verify:codes -- https://anchor.matchgamers.com');
    process.exit(2);
  }
  console.log(`验证兑换码流程：${base}`);
  verify(base, ADMIN_PW(), console.log).then((r) => { console.log(r.ok ? '\n全部通过' : '\n有失败项，请先不要对外发码'); process.exit(r.ok ? 0 : 1); });
}
