'use strict';
// 兑换码管理：只能从管理后台点链接进入（沿用后台登录时存放的口令）；直接打开会被拒绝。
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  let page = 1, status = '', fresh = null, msg = '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '');
  const denied = (m) => { app.innerHTML = `<div class="card"><h1>无权访问</h1><p>${esc(m || '请先登录管理后台，再从后台进入兑换码管理。')}</p><div class="row"><a href="/admin.html">前往管理后台</a></div></div>`; };
  async function api(method, path, body, raw) {
    const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + pw, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (raw && res.ok) return res;
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.error || '请求失败'); e.status = res.status; throw e; }
    return d;
  }
  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); done(true); } catch (e) { done(false); }
  }

  async function load() {
    if (!pw) return denied();
    try { draw(await api('GET', `/api/admin/codes?page=${page}&status=${status}`)); }
    catch (e) { e.status === 401 || e.status === 429 ? denied('登录已失效，请回到管理后台重新登录。') : denied(e.message); }
  }

  function draw(d) {
    const s = d.summary, pages = Math.max(1, Math.ceil(d.total / d.size));
    app.innerHTML = `<div class="crumb"><a href="/admin.html">← 返回管理后台</a></div><h1>兑换码管理</h1>
      <section class="panel"><div class="kpis"><div><b>${s.total}</b>已生成</div><div><b>${s.unused}</b>未使用</div><div><b>${s.used}</b>已使用</div><div><b>${s.voided}</b>已作废</div></div>
        <p class="muted" style="margin:10px 0 0">每个码只能开始一次测试。需要在服务器环境变量里设置 <span class="mono">REQUIRE_CODE=1</span>，答题时才会要求输入兑换码。</p></section>
      <section class="panel"><h2>生成兑换码</h2>
        <form id="g" class="gen"><div><label for="cnt">数量</label><input id="cnt" type="number" min="1" max="200" value="10" required></div>
          <div><label for="note">备注（订单号、买家、套餐等，可不填）</label><input id="note" type="text" maxlength="60"></div>
          <button type="submit">生成</button></form>
        <div class="err" id="err" role="alert">${esc(msg)}</div>
        ${fresh ? `<h2 style="margin-top:14px">本次生成的 ${fresh.length} 个码</h2><textarea id="fresh" readonly>${esc(fresh.map((c) => c.code).join('\n'))}</textarea>
          <div class="row"><button type="button" id="cpall">复制全部</button><span id="cpmsg" class="muted"></span></div>` : ''}</section>
      <section class="panel"><h2>全部兑换码</h2>
        <div class="row" style="margin:0 0 10px"><select id="st" aria-label="状态筛选"><option value="">全部状态</option><option value="unused">未使用</option><option value="used">已使用</option><option value="voided">已作废</option></select>
          <button type="button" class="ghost" id="csv">导出 CSV</button></div>
        <div class="tw"><table><thead><tr><th>兑换码</th><th>备注</th><th>状态</th><th>使用者</th><th>使用时间</th><th>操作</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td class="mono">${esc(r.code)}</td><td>${esc(r.note)}</td>
          <td>${r.voided ? '<span class="pill void">已作废</span>' : r.usedAt ? '<span class="pill used">已使用</span>' : '<span class="pill unused">未使用</span>'}</td>
          <td>${esc(r.usedBy)}</td><td>${fmt(r.usedAt)}</td>
          <td><button class="ghost" data-cp="${esc(r.code)}">复制</button>${!r.usedAt && !r.voided ? `<button class="ghost" data-v="${r.id}">作废</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">还没有兑换码，先在上面生成几个。</td></tr>'}
        </tbody></table></div>
        <div class="row"><button class="ghost" id="pv" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${pages}（共 ${d.total} 个）</span><button class="ghost" id="nx" ${page >= pages ? 'disabled' : ''}>下一页</button></div></section>`;
    document.getElementById('st').value = status;
    document.getElementById('g').addEventListener('submit', async (e) => {
      e.preventDefault(); msg = '';
      try { fresh = (await api('POST', '/api/admin/codes', { count: Number(document.getElementById('cnt').value), note: document.getElementById('note').value })).codes; page = 1; status = ''; }
      catch (er) { msg = er.message; fresh = null; }
      load();
    });
    const cp = document.getElementById('cpall');
    if (cp) cp.addEventListener('click', () => copy(fresh.map((c) => c.code).join('\n'), (ok) => {
      document.getElementById('cpmsg').textContent = ok ? '已复制' : '浏览器不允许自动复制，请手动选中文本框内容复制';
      if (!ok) { const t = document.getElementById('fresh'); t.focus(); t.select(); }
    }));
    document.getElementById('st').onchange = (e) => { status = e.target.value; page = 1; load(); };
    document.getElementById('pv').onclick = () => { page--; load(); };
    document.getElementById('nx').onclick = () => { page++; load(); };
    document.getElementById('csv').onclick = async () => {
      const res = await api('GET', '/api/admin/codes/export.csv', null, true);
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'redeem-codes.csv'; a.click(); URL.revokeObjectURL(a.href);
    };
    app.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = () => copy(b.dataset.cp, (ok) => { b.textContent = ok ? '已复制' : '复制失败'; setTimeout(() => (b.textContent = '复制'), 1200); })));
    app.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
      if (!confirm('作废这个兑换码？作废后不能再使用。')) return;
      try { await api('POST', `/api/admin/codes/${b.dataset.v}/void`); } catch (er) { msg = er.message; }
      load();
    }));
  }
  load();
})();
