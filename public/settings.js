'use strict';
// 设置：服务端「设置注册表」驱动。左侧是分组（网址 #quiz #access #data #system），右侧按分组渲染；
// 新增设置不用改这个文件：服务端登记一条，就会出现在对应分组里。
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  let groups = [], cur = '', pending = {}, msg = '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const denied = (m) => { app.innerHTML = `<div class="card"><h1>无权访问</h1><p>${esc(m || '请先登录管理后台，再进入设置页。')}</p><div class="row"><a href="/admin.html">前往管理后台</a></div></div>`; };
  async function api(method, path, body, raw) {
    const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + pw, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (raw && res.ok) return res;
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.error || '请求失败'); e.status = res.status; throw e; }
    return d;
  }
  const dirty = () => Object.keys(pending).length > 0;
  const fromHash = () => { const h = decodeURIComponent(location.hash.slice(1)); return groups.some((g) => g.id === h) ? h : groups[0].id; };

  async function load() {
    if (!pw) return denied();
    try { groups = (await api('GET', '/api/admin/settings')).groups; cur = cur || fromHash(); draw(); }
    catch (e) { e.status === 401 || e.status === 429 ? denied('登录已失效，请回到管理后台重新登录。') : denied(e.message); }
  }

  // ---- 操作项（按钮）：备份、清理 ----
  const ACTIONS = {
    async backup(setStatus) {
      setStatus('正在生成备份…');
      const res = await api('GET', '/api/admin/backup', null, true);
      const cd = res.headers.get('content-disposition') || '';
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = (/filename="([^"]+)"/.exec(cd) || [])[1] || 'career-anchor.db'; a.click(); URL.revokeObjectURL(a.href);
      setStatus('备份已下载，请移到自己的电脑或网盘保存');
    },
    async purge(setStatus) {
      const m = prompt('清理多少个月没有任何活动的用户及其全部测试记录？（隐私说明承诺最长保存 12 个月）', '12');
      if (m === null) return;
      const pv = await api('GET', `/api/admin/purge-preview?months=${encodeURIComponent(m)}`);
      if (!pv.count) { setStatus(`没有超过 ${pv.months} 个月无活动的用户`); return; }
      if (!confirm(`将永久删除 ${pv.count} 位超过 ${pv.months} 个月无活动的用户及其全部测试记录，无法恢复。建议先下载一份数据库备份。确定删除？`)) return;
      const r = await api('POST', '/api/admin/purge', { months: pv.months });
      setStatus(`已删除 ${r.deleted} 位用户`);
    },
  };

  function row(it) {
    if (it.type === 'readonly') return `<div class="setrow"><div><b>${esc(it.label)}</b>${it.help ? `<span class="muted">${esc(it.help)}</span>` : ''}</div><div class="ctl"><span>${esc(it.value)}</span></div></div>`;
    if (it.type === 'action') return `<div class="setrow"><div><b>${esc(it.label)}</b><span class="muted">${esc(it.help)}</span><span class="small" data-st="${esc(it.action)}" role="status" style="display:block;color:var(--brand)"></span></div><div class="ctl"><button type="button" class="ghost" data-act="${esc(it.action)}">${it.action === 'backup' ? '下载备份' : '预览并清理…'}</button></div></div>`;
    const val = it.key in pending ? pending[it.key] : it.value;
    return `<div class="setrow"><div><b>${esc(it.label)}</b><span class="muted">${esc(it.help)}</span><span class="muted small" style="display:block">默认：${esc((it.options.find((o) => o.value === it.default) || {}).label)}</span></div>
      <div class="ctl"><select data-key="${esc(it.key)}" aria-label="${esc(it.label)}">${it.options.map((o) => `<option value="${esc(JSON.stringify(o.value))}"${o.value === val ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      ${it.value !== it.default ? `<button type="button" class="ghost" data-reset="${esc(it.key)}">恢复默认</button>` : ''}</div></div>`;
  }

  function draw() {
    const g = groups.find((x) => x.id === cur) || groups[0];
    const hasSelect = g.items.some((i) => i.type === 'select');
    app.innerHTML = `<h1>设置</h1><div class="set"><nav class="setnav" aria-label="设置分组">${groups.map((x) => `<a href="#${esc(x.id)}"${x.id === g.id ? ' aria-current="page"' : ''}>${esc(x.name)}</a>`).join('')}</nav>
      <section class="panel"><h2>${esc(g.name)}</h2><p class="muted">${esc(g.desc)}</p>
        ${g.items.length ? g.items.map(row).join('') : '<p class="muted">这个分组暂时没有可调整的设置。</p>'}
        ${hasSelect ? `<div class="savebar"><button type="button" id="save" ${dirty() ? '' : 'disabled'}>保存</button><span class="muted small" id="msg" role="status">${esc(msg || (dirty() ? '有未保存的修改' : ''))}</span></div>` : ''}</section></div>`;
    app.querySelectorAll('select[data-key]').forEach((s) => (s.onchange = () => {
      const it = g.items.find((i) => i.key === s.dataset.key), v = JSON.parse(s.value);
      if (v === it.value) delete pending[it.key]; else pending[it.key] = v;
      msg = ''; draw();
    }));
    const save = document.getElementById('save');
    if (save) save.onclick = async () => {
      try { await api('POST', '/api/admin/settings', { values: pending }); pending = {}; msg = '已保存，立即生效'; await load(); } catch (er) { msg = er.message; draw(); }
    };
    app.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => {
      try { await api('POST', '/api/admin/settings', { values: { [b.dataset.reset]: null } }); delete pending[b.dataset.reset]; msg = '已恢复默认'; await load(); } catch (er) { msg = er.message; draw(); }
    }));
    app.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      const st = app.querySelector(`[data-st="${b.dataset.act}"]`);
      try { await ACTIONS[b.dataset.act]((t) => { st.textContent = t; }); } catch (er) { st.textContent = er.message; }
    }));
  }
  window.addEventListener('hashchange', () => {
    if (!groups.length) return;
    if (dirty() && !confirm('有未保存的修改，切换分组会丢弃它们。继续？')) { location.hash = '#' + cur; return; }
    pending = {}; msg = ''; cur = fromHash(); draw();
  });
  load();
})();
