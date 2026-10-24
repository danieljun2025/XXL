'use strict';
// 团队管理：只能从管理后台点链接进入（沿用后台登录时存放的口令）；直接打开会被拒绝。
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  let shown = null, msg = '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '');
  const denied = (m) => { app.innerHTML = `<div class="card"><h1>无权访问</h1><p>${esc(m || '请先登录管理后台，再从后台进入团队管理。')}</p><div class="row"><a href="/admin.html">前往管理后台</a></div></div>`; };
  async function api(method, path, body) {
    const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + pw, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.error || '请求失败'); e.status = res.status; throw e; }
    return d;
  }
  async function copy(text, done) { try { await navigator.clipboard.writeText(text); done(true); } catch (e) { done(false); } }
  const link = (key) => `${location.origin}/team.html#${key}`;

  async function load() {
    if (!pw) return denied();
    try { draw((await api('GET', '/api/admin/teams')).teams); }
    catch (e) { e.status === 401 || e.status === 429 ? denied('登录已失效，请回到管理后台重新登录。') : denied(e.message); }
  }

  function shownBlock() {
    if (!shown) return '';
    return `<div class="result"><b>${esc(shown.name)}</b>${shown.code ? `<p class="muted" style="margin:6px 0 0">团队码（发给成员，答题时填写）</p><p class="big mono">${esc(shown.code.code)}</p>
        <p class="muted" style="margin:0">${shown.code.expiresAt ? '有效至 ' + fmt(shown.code.expiresAt) : '长期有效'}；${shown.code.maxUses ? '最多 ' + shown.code.maxUses + ' 人' : '人数不限'}；每人限用一次</p>` : ''}
      <p class="muted" style="margin:10px 0 0">团队报告码（只发给团队负责人，用来查看团队汇总）</p><p class="big mono">${esc(shown.reportKey)}</p>
      <p class="muted" style="margin:0">报告链接：<span class="mono">${esc(link(shown.reportKey))}</span></p>
      <p class="warn">报告码只显示这一次，关闭后只能重新生成（旧码会失效）。</p>
      <div class="row">${shown.code ? '<button type="button" id="cpc">复制团队码</button>' : ''}<button type="button" id="cpk">复制报告链接</button><span id="cpm" class="muted"></span></div></div>`;
  }

  function draw(teams) {
    app.innerHTML = `<div class="crumb"><a href="/admin.html">← 返回管理后台</a></div><h1>团队管理</h1>
      <section class="panel"><h2>创建团队</h2>
        <p class="muted">一个团队对应一个客户（公司、班级、培训营）。成员用「团队码」答题，负责人用「团队报告码」只看本团队的汇总。</p>
        <form id="g"><div class="gen"><div><label for="tn">团队名称</label><input id="tn" type="text" maxlength="60" required placeholder="如 销售一部"></div>
          <div><label for="tnote">备注（可不填）</label><input id="tnote" type="text" maxlength="200" placeholder="如 客户 A、订单号"></div></div>
        <label class="chk"><input id="sn" type="checkbox"> 允许负责人看到成员的姓名和主职业锚（成员加入时会被告知；默认只看汇总）</label>
        <label class="chk"><input id="mk" type="checkbox" checked> 同时生成团队码（通用码）</label>
        <div class="gen" id="cs"><div><label for="cc">自定义码（可不填）</label><input id="cc" type="text" maxlength="24" placeholder="如 SALES1"></div>
          <div><label for="hrs">有效时长（小时，留空=不限）</label><input id="hrs" type="number" min="0.1" step="any" placeholder="如 72"></div>
          <div><label for="mu">最多人数（留空=不限）</label><input id="mu" type="number" min="1" step="1" placeholder="如 50"></div></div>
        <div class="row"><button type="submit">创建</button></div></form>
        <div class="err" id="err" role="alert">${esc(msg)}</div>${shownBlock()}</section>
      <section class="panel"><h2>全部团队</h2><div class="tw"><table><thead><tr><th>团队</th><th>成员</th><th>团队码</th><th>负责人可看姓名</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${teams.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.note ? `<br><span class="muted">${esc(t.note)}</span>` : ''}<br><span class="muted">创建于 ${fmt(t.createdAt)}</span></td>
          <td>${t.submitted} 人完成<br><span class="muted">参与 ${t.members}，进行中 ${t.drafts}</span></td>
          <td>${t.codes.map((c) => `<span class="chip mono">${esc(c.code)}${c.kind === 'shared' ? ` ${c.uses}${c.maxUses ? '/' + c.maxUses : ''}人` : ''}${c.voided ? ' 已作废' : ''}</span>`).join('') || '<span class="muted">无</span>'}</td>
          <td><label class="chk" style="margin:0"><input type="checkbox" data-sn="${t.id}" ${t.shareNames ? 'checked' : ''}> ${t.shareNames ? '是' : '否'}</label></td>
          <td><span class="pill ${t.closed ? 'off' : 'on'}">${t.closed ? '已关闭' : '开放'}</span></td>
          <td><a class="btn" href="/report.html?team=${t.id}">查看报告</a><a class="btn" href="/codes.html?team=${t.id}">生成码</a><button class="ghost" data-cl="${t.id}" data-to="${t.closed ? 0 : 1}">${t.closed ? '重新开放' : '关闭'}</button><button class="ghost" data-rk="${t.id}">重新生成报告码</button><button class="ghost" data-rn="${t.id}" data-name="${esc(t.name)}">改名</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">还没有团队，先在上面创建一个。</td></tr>'}
        </tbody></table></div></section>`;
    const cs = document.getElementById('cs'), mk = document.getElementById('mk');
    mk.onchange = () => { cs.style.display = mk.checked ? '' : 'none'; };
    document.getElementById('g').addEventListener('submit', async (e) => {
      e.preventDefault(); msg = '';
      const v = (id) => document.getElementById(id).value;
      const body = { name: v('tn'), note: v('tnote'), shareNames: document.getElementById('sn').checked };
      if (mk.checked) body.code = { customCode: v('cc'), hours: v('hrs'), maxUses: v('mu') };
      try { const r = await api('POST', '/api/admin/teams', body); shown = { name: r.team.name, reportKey: r.reportKey, code: r.code }; }
      catch (er) { msg = er.message; shown = null; }
      load();
    });
    const done = (ok) => { const m = document.getElementById('cpm'); if (m) m.textContent = ok ? '已复制' : '浏览器不允许自动复制，请手动选中复制'; };
    const cpk = document.getElementById('cpk'); if (cpk) cpk.onclick = () => copy(link(shown.reportKey), done);
    const cpc = document.getElementById('cpc'); if (cpc) cpc.onclick = () => copy(shown.code.code, done);
    app.querySelectorAll('[data-sn]').forEach((c) => (c.onchange = async () => {
      if (c.checked && !confirm('开启后，负责人将能看到成员的姓名和主职业锚。之后加入的成员会被告知；已加入的成员加入时看到的是"只看汇总"的说明。确定开启？')) { c.checked = false; return; }
      try { await api('POST', `/api/admin/teams/${c.dataset.sn}/update`, { shareNames: c.checked }); msg = ''; } catch (er) { msg = er.message; }
      load();
    }));
    app.querySelectorAll('[data-cl]').forEach((b) => (b.onclick = async () => { try { await api('POST', `/api/admin/teams/${b.dataset.cl}/update`, { closed: b.dataset.to === '1' }); } catch (er) { msg = er.message; } load(); }));
    app.querySelectorAll('[data-rn]').forEach((b) => (b.onclick = async () => {
      const n = prompt('新的团队名称', b.dataset.name); if (!n) return;
      try { await api('POST', `/api/admin/teams/${b.dataset.rn}/update`, { name: n }); msg = ''; } catch (er) { msg = er.message; } load();
    }));
    app.querySelectorAll('[data-rk]').forEach((b) => (b.onclick = async () => {
      if (!confirm('重新生成报告码？旧的报告码和链接会立即失效。')) return;
      try { const r = await api('POST', `/api/admin/teams/${b.dataset.rk}/regen-key`); const t = teams.find((x) => String(x.id) === b.dataset.rk); shown = { name: t.name + '（新的报告码）', reportKey: r.reportKey, code: null }; msg = ''; } catch (er) { msg = er.message; }
      load();
    }));
  }
  load();
})();
