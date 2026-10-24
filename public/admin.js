'use strict';
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  let cfg, page = 1, q = '', status = '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '');
  async function api(method, path, raw) {
    const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + pw } });
    if (raw && res.ok) return res;
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || '请求失败');
    return d;
  }
  function login(msg) {
    app.innerHTML = `<div class="card"><h1>管理后台</h1><form id="f"><label for="p">管理员口令</label><input id="p" type="password" required><div class="err">${esc(msg || '')}</div><div class="row"><button>登录</button></div></form></div>`;
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault(); pw = document.getElementById('p').value;
      try { await api('GET', '/api/admin/stats'); try { sessionStorage.setItem('ca_admin', pw); } catch (x) { /* 忽略 */ } load(); } catch (er) { login(er.message); }
    });
  }
  async function load() {
    try {
      cfg = cfg || await (await fetch('/api/config')).json();
      const ls = await api('GET', `/api/admin/attempts?page=${page}&q=${encodeURIComponent(q)}&status=${status}`);
      draw(ls);
    } catch (e) { login(e.message); }
  }
  function draw(ls) {
    const A = cfg.anchors, pages = Math.max(1, Math.ceil(ls.total / ls.size));
    app.innerHTML = `<div class="card"><h1>管理后台</h1><p class="muted">共 ${ls.total} 条记录。</p><div class="row"><a class="btnlink" href="/report.html">查看统计报表 →</a></div></div>
      <div class="card"><form id="s" class="row" style="margin:0"><input id="q" type="text" placeholder="搜索姓名或邮箱" value="${esc(q)}" style="max-width:260px">
        <select id="st" style="padding:10px;border-radius:10px"><option value="">全部状态</option><option value="submitted" ${status === 'submitted' ? 'selected' : ''}>已提交</option><option value="draft" ${status === 'draft' ? 'selected' : ''}>进行中</option></select>
        <button>搜索</button><button type="button" class="ghost" id="csv">导出 CSV</button><button type="button" class="ghost" id="out">退出</button></form>
      <div class="tw"><table><thead><tr><th>姓名</th><th>邮箱</th><th>状态</th><th>主职业锚</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
      ${ls.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${r.status === 'submitted' ? '已提交' : '进行中'}</td><td>${(r.primary || []).map((c) => esc(A[c].name)).join('、')}</td><td>${fmt(r.submittedAt)}</td>
      <td>${r.status === 'submitted' ? `<button class="ghost" data-v="${r.id}">报告</button>` : ''}<button class="ghost" data-k="${r.participantId}">重置密钥</button><button class="ghost" data-d="${r.participantId}">删除</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">暂无数据</td></tr>'}
      </tbody></table></div>
      <div class="row"><button class="ghost" id="pv" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${pages}（共 ${ls.total} 条）</span><button class="ghost" id="nx" ${page >= pages ? 'disabled' : ''}>下一页</button></div></div>
      <div id="detail"></div>`;
    document.getElementById('s').addEventListener('submit', (e) => { e.preventDefault(); q = document.getElementById('q').value; status = document.getElementById('st').value; page = 1; load(); });
    document.getElementById('pv').onclick = () => { page--; load(); };
    document.getElementById('nx').onclick = () => { page++; load(); };
    document.getElementById('out').onclick = () => { try { sessionStorage.removeItem('ca_admin'); } catch (e) { /* 忽略 */ } pw = ''; login(); };
    document.getElementById('csv').onclick = async () => {
      const res = await api('GET', '/api/admin/attempts/export.csv', true);
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'career-anchor.csv'; a.click(); URL.revokeObjectURL(a.href);
    };
    app.querySelectorAll('[data-k]').forEach((b) => (b.onclick = async () => { if (confirm('重置该用户的查看密钥？用户下次进入时输入的密钥将成为新密钥。')) { await api('POST', `/api/admin/participants/${b.dataset.k}/reset-key`); alert('已重置'); } }));
    app.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => { if (confirm('永久删除该用户及其全部测试记录？此操作不可恢复。')) { await api('DELETE', `/api/admin/participants/${b.dataset.d}`); load(); } }));
    app.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
      const r = await api('GET', `/api/admin/attempts/${b.dataset.v}`);
      document.getElementById('detail').innerHTML = `<div class="card"><h2>${esc(r.name)} · ${esc(r.reportNo)}</h2><p>主职业锚：${r.primary.map((c) => esc(A[c].name)).join('、')}</p>
        <table>${r.ranking.map((c) => `<tr><td>${esc(A[c].name)}</td><td>${r.scores[c].toFixed(1)}</td></tr>`).join('')}</table></div>`;
      document.getElementById('detail').scrollIntoView();
    }));
  }
  pw ? load() : login();
})();
