'use strict';
// 兑换码管理：只能从管理后台点链接进入（沿用后台登录时存放的口令）；直接打开会被拒绝。
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  let page = 1, status = '', fresh = null, msg = '', kind = 'shared', teams = [], teamSel = new URLSearchParams(location.search).get('team') || '';
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
  async function copy(text, done) { try { await navigator.clipboard.writeText(text); done(true); } catch (e) { done(false); } }
  const STATE = { active: ['可用', 'unused'], used: ['已用完', 'used'], expired: ['已过期', 'void'], voided: ['已作废', 'void'] };

  async function load() {
    if (!pw) return denied();
    try { teams = (await api('GET', '/api/admin/teams')).teams; draw(await api('GET', `/api/admin/codes?page=${page}&status=${status}`)); }
    catch (e) { e.status === 401 || e.status === 429 ? denied('登录已失效，请回到管理后台重新登录。') : denied(e.message); }
  }

  function freshBlock() {
    if (!fresh) return '';
    const one = fresh[0];
    const head = one.maxUses !== undefined ? `<h2 style="margin-top:14px">通用码已生成</h2>
      <p class="bigcode mono">${esc(one.code)}</p>
      <p class="muted">${one.expiresAt ? `有效至 ${fmt(one.expiresAt)}` : '长期有效'}；${one.maxUses ? `最多 ${one.maxUses} 人使用` : '人数不限'}；每人限用一次。</p>`
      : `<h2 style="margin-top:14px">本次生成的 ${fresh.length} 个一次性码</h2><p class="muted">${one.expiresAt ? `有效至 ${fmt(one.expiresAt)}` : '长期有效'}</p><textarea id="fresh" readonly>${esc(fresh.map((c) => c.code).join('\n'))}</textarea>`;
    return `${head}<div class="row"><button type="button" id="cpall">复制${one.maxUses !== undefined ? '兑换码' : '全部'}</button><span id="cpmsg" class="muted"></span></div>`;
  }

  function draw(d) {
    const s = d.summary, pages = Math.max(1, Math.ceil(d.total / d.size));
    const shared = kind === 'shared';
    app.innerHTML = `<div class="crumb"><a href="/admin.html">← 返回管理后台</a></div><h1>兑换码管理</h1>
      <section class="panel"><div class="kpis"><div><b>${s.total}</b>已生成</div><div><b>${s.active}</b>当前可用</div><div><b>${s.used}</b>已用完</div><div><b>${s.expired}</b>已过期</div><div><b>${s.voided}</b>已作废</div></div>
        <p class="muted" style="margin:10px 0 0">需要在服务器环境变量里设置 <span class="mono">REQUIRE_CODE=1</span>，答题时才会要求输入兑换码。</p></section>
      <section class="panel"><h2>生成兑换码</h2>
        <div class="tabs" role="group" aria-label="类型"><button type="button" data-kind="shared" aria-pressed="${shared}">通用码（多人共用）</button><button type="button" data-kind="single" aria-pressed="${!shared}">一次性码（逐个发放）</button></div>
        <p class="muted">${shared ? '适合一次分享活动：发一个码给所有人，设置有效时长和人数上限，每人限用一次。' : '适合逐单发放：每个码只能开始一次测试。'}</p>
        <form id="g" class="gen">
          ${shared ? '<div><label for="cc">自定义码（可不填，自动生成）</label><input id="cc" type="text" maxlength="24" placeholder="如 SHARE1024"><div class="muted small">与已作废或已过期的旧码重名时，旧码会归档，这个文字重新可用，人数从 0 开始计。</div></div>' : '<div><label for="cnt">数量</label><input id="cnt" type="number" min="1" max="200" value="10" required></div>'}
          <div><label for="hrs">有效时长（小时，留空=不限）</label><input id="hrs" type="number" min="0.1" step="any" value="${shared ? 3 : ''}" placeholder="如 3"></div>
          ${shared ? '<div><label for="mu">最多使用人数（留空=不限）</label><input id="mu" type="number" min="1" step="1" placeholder="如 50"></div>' : ''}
          <div><label for="tm">所属团队（可不选）</label><select id="tm"><option value="">不属于任何团队</option>${teams.map((t) => `<option value="${t.id}"${String(t.id) === String(teamSel) ? ' selected' : ''}>${esc(t.name)}${t.closed ? '（已关闭）' : ''}</option>`).join('')}</select></div>
          <div><label for="note">备注（可不填）</label><input id="note" type="text" maxlength="60" placeholder="${shared ? '如 10 月 24 日分享会' : '如 闲鱼订单号'}"></div>
          <button type="submit">生成</button></form>
        <div class="err" id="err" role="alert">${esc(msg)}</div>${freshBlock()}</section>
      <section class="panel"><h2>全部兑换码</h2>
        <div class="row" style="margin:0 0 10px"><select id="st" aria-label="状态筛选"><option value="">全部状态</option><option value="active">当前可用</option><option value="used">已用完</option><option value="expired">已过期</option><option value="voided">已作废</option></select>
          <button type="button" class="ghost" id="csv">导出 CSV</button></div>
        <div class="tw"><table><thead><tr><th>兑换码</th><th>类型</th><th>团队</th><th>备注</th><th>状态</th><th>使用</th><th>到期时间</th><th>操作</th></tr></thead><tbody>
        ${d.rows.map((r) => { const st = STATE[r.state]; return `<tr><td class="mono">${esc(r.code.split('#')[0])}${r.code.includes('#') ? ' <span class="muted" title="同名的新码已重新生成，这条是旧码的记录">（旧码）</span>' : ''}</td><td>${r.kind === 'shared' ? '通用' : '一次性'}</td><td>${esc(r.team)}</td><td>${esc(r.note)}</td>
          <td><span class="pill ${st[1]}">${st[0]}</span></td>
          <td>${r.kind === 'shared' ? `${r.uses}${r.maxUses ? ' / ' + r.maxUses : ''} 人` : r.usedBy ? esc(r.usedBy) + '<br><span class="muted">' + fmt(r.usedAt) + '</span>' : '—'}</td>
          <td>${r.expiresAt ? fmt(r.expiresAt) : '不限'}</td>
          <td>${r.code.includes('#') ? '<span class="muted">已归档</span>' : `${r.code.includes('#') ? '' : `<button class="ghost" data-cp="${esc(r.code)}">复制</button>`}${r.state !== 'voided' && !(r.kind === 'single' && r.usedAt) ? `<button class="ghost" data-ext="${r.id}">设置有效期</button>` : ''}${r.kind === 'shared' && r.state !== 'voided' ? `<button class="ghost" data-lim="${r.id}" data-cur="${r.maxUses || ''}">人数上限</button>` : ''}${r.state !== 'voided' && !(r.kind === 'single' && r.usedAt) ? `<button class="ghost" data-v="${r.id}">作废</button>` : ''}${r.state === 'voided' ? `<button class="ghost" data-rs="${r.id}">恢复</button>` : ''}`}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">还没有兑换码，先在上面生成几个。</td></tr>'}
        </tbody></table></div>
        <div class="row"><button class="ghost" id="pv" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${pages}（共 ${d.total} 个）</span><button class="ghost" id="nx" ${page >= pages ? 'disabled' : ''}>下一页</button></div></section>`;
    document.getElementById('st').value = status;
    app.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { kind = b.dataset.kind; fresh = null; msg = ''; load(); }));
    document.getElementById('g').addEventListener('submit', async (e) => {
      e.preventDefault(); msg = ''; teamSel = document.getElementById('tm').value;
      const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
      const body = shared
        ? { kind: 'shared', customCode: val('cc'), hours: val('hrs'), maxUses: val('mu'), note: val('note'), teamId: val('tm') }
        : { kind: 'single', count: Number(val('cnt')), hours: val('hrs'), note: val('note'), teamId: val('tm') };
      try { fresh = (await api('POST', '/api/admin/codes', body)).codes; page = 1; status = ''; }
      catch (er) { msg = er.message; fresh = null; }
      load();
    });
    const cp = document.getElementById('cpall');
    if (cp) cp.addEventListener('click', () => copy(fresh.map((c) => c.code).join('\n'), (ok) => {
      document.getElementById('cpmsg').textContent = ok ? '已复制' : '浏览器不允许自动复制，请手动选中后复制';
      const t = document.getElementById('fresh'); if (!ok && t) { t.focus(); t.select(); }
    }));
    document.getElementById('st').onchange = (e) => { status = e.target.value; page = 1; load(); };
    document.getElementById('pv').onclick = () => { page--; load(); };
    document.getElementById('nx').onclick = () => { page++; load(); };
    document.getElementById('csv').onclick = async () => {
      const res = await api('GET', '/api/admin/codes/export.csv', null, true);
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'redeem-codes.csv'; a.click(); URL.revokeObjectURL(a.href);
    };
    app.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = () => copy(b.dataset.cp, (ok) => { b.textContent = ok ? '已复制' : '复制失败'; setTimeout(() => (b.textContent = '复制'), 1200); })));
    app.querySelectorAll('[data-ext]').forEach((b) => (b.onclick = async () => {
      const h = prompt('从现在起，再有效多少小时？（可填小数，如 0.5）', '3');
      if (h === null) return;
      try { await api('POST', `/api/admin/codes/${b.dataset.ext}/extend`, { hours: Number(h) }); msg = ''; } catch (er) { msg = er.message; }
      load();
    }));
    app.querySelectorAll('[data-lim]').forEach((b) => (b.onclick = async () => {
      const v = prompt('最多使用人数（留空 = 不限）。可以随时调高或调低；低于已用人数时不再发放，已使用的人不受影响。', b.dataset.cur);
      if (v === null) return;
      try { await api('POST', `/api/admin/codes/${b.dataset.lim}/limit`, { maxUses: v.trim() === '' ? '' : Number(v) }); msg = ''; } catch (er) { msg = er.message; }
      load();
    }));
    app.querySelectorAll('[data-rs]').forEach((b) => (b.onclick = async () => {
      if (!confirm('恢复这个兑换码？恢复后立即可用，原有的使用记录保留。')) return;
      try { await api('POST', `/api/admin/codes/${b.dataset.rs}/restore`); msg = ''; } catch (er) { msg = er.message; }
      load();
    }));
    app.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
      if (!confirm('作废这个兑换码？作废后立即失效，已经开始的测试不受影响。')) return;
      try { await api('POST', `/api/admin/codes/${b.dataset.v}/void`); msg = ''; } catch (er) { msg = er.message; }
      load();
    }));
  }
  load();
})();
