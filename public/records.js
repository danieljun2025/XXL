'use strict';
// 记录：答题记录列表、搜索、筛选、查看报告、重置密钥、删除、导出 CSV。只能从后台进入（沿用登录口令）。
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  let cfg, page = 1, q = '', status = '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '');
  const denied = (m) => { app.innerHTML = `<div class="card"><h1>无权访问</h1><p>${esc(m || '请先登录管理后台，再进入记录页。')}</p><div class="row"><a href="/admin.html">前往管理后台</a></div></div>`; };
  async function api(method, path, raw) {
    const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + pw } });
    if (raw && res.ok) return res;
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.error || '请求失败'); e.status = res.status; throw e; }
    return d;
  }
  async function load() {
    if (!pw) return denied();
    try {
      cfg = cfg || await (await fetch('/api/config')).json();
      draw(await api('GET', `/api/admin/attempts?page=${page}&q=${encodeURIComponent(q)}&status=${status}`));
    } catch (e) { denied(e.status === 401 || e.status === 429 ? '登录已失效，请回到管理后台重新登录。' : e.message); }
  }
  function draw(ls) {
    const A = cfg.anchors, pages = Math.max(1, Math.ceil(ls.total / ls.size));
    app.innerHTML = `<h1>记录</h1>
      <section class="panel"><form id="s" class="row" style="margin:0"><input id="q" type="text" placeholder="搜索姓名或邮箱" value="${esc(q)}" style="max-width:260px">
        <select id="st" aria-label="状态"><option value="">全部状态</option><option value="submitted" ${status === 'submitted' ? 'selected' : ''}>已提交</option><option value="draft" ${status === 'draft' ? 'selected' : ''}>进行中</option></select>
        <button>搜索</button><button type="button" class="ghost" id="csv">导出 CSV</button></form>
      <div class="tw"><table><thead><tr><th>姓名</th><th>邮箱</th><th>团队</th><th>状态</th><th>主职业锚</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
      ${ls.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.team)}</td><td>${r.status === 'submitted' ? '已提交' : '进行中'}</td><td>${(r.primary || []).map((c) => esc(A[c].name)).join('、')}</td><td>${fmt(r.submittedAt)}</td>
      <td>${r.status === 'submitted' ? `<button class="ghost" data-v="${r.id}">报告</button>` : ''}<button class="ghost" data-k="${r.participantId}">重置密钥</button><button class="ghost" data-d="${r.participantId}">删除</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">暂无数据</td></tr>'}
      </tbody></table></div>
      <div class="row"><button class="ghost" id="pv" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${pages}（共 ${ls.total} 条）</span><button class="ghost" id="nx" ${page >= pages ? 'disabled' : ''}>下一页</button></div></section>
      <div id="detail"></div>`;
    document.getElementById('s').addEventListener('submit', (e) => { e.preventDefault(); q = document.getElementById('q').value; status = document.getElementById('st').value; page = 1; load(); });
    document.getElementById('pv').onclick = () => { page--; load(); };
    document.getElementById('nx').onclick = () => { page++; load(); };
    document.getElementById('csv').onclick = async () => {
      const res = await api('GET', '/api/admin/attempts/export.csv', true);
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'career-anchor.csv'; a.click(); URL.revokeObjectURL(a.href);
    };
    app.querySelectorAll('[data-k]').forEach((b) => (b.onclick = async () => { if (confirm('重置该用户的查看密钥？用户下次进入时输入的密钥将成为新密钥。')) { await api('POST', `/api/admin/participants/${b.dataset.k}/reset-key`); alert('已重置'); } }));
    app.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => { if (confirm('永久删除该用户及其全部测试记录？此操作不可恢复。')) { await api('DELETE', `/api/admin/participants/${b.dataset.d}`); load(); } }));
    app.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
      const r = await api('GET', `/api/admin/attempts/${b.dataset.v}`);
      document.getElementById('detail').innerHTML = `<section class="panel"><h2>${esc(r.name)} · ${esc(r.reportNo)}</h2><p>主职业锚：${r.primary.map((c) => esc(A[c].name)).join('、')}</p>
        <table>${r.ranking.map((c) => `<tr><td>${esc(A[c].name)}</td><td>${r.scores[c].toFixed(1)}</td></tr>`).join('')}</table></section>`;
      document.getElementById('detail').scrollIntoView();
    }));
  }
  load();
})();
