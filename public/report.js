'use strict';
// 统计报表：只能从管理后台点链接进入（沿用后台登录时存放的口令）；直接打开会被拒绝。
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  let team = new URLSearchParams(location.search).get('team') || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const denied = (msg) => { app.innerHTML = `<div class="card"><h1>无权访问</h1><p>${esc(msg || '请先登录管理后台，再从后台进入统计报表。')}</p><div class="row"><a href="/admin.html">前往管理后台</a></div></div>`; };
  async function api(path) {
    const res = await fetch(path, { headers: { Authorization: 'Bearer ' + pw } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.error || '请求失败'); e.status = res.status; throw e; }
    return d;
  }
  async function load() {
    if (!pw) return denied();
    try {
      const cfg = await (await fetch('/api/config')).json();
      const [teams, st] = await Promise.all([api('/api/admin/teams'), api('/api/admin/report?tz=' + -new Date().getTimezoneOffset() + (team ? '&team=' + encodeURIComponent(team) : ''))]);
      const sel = `<div class="filter"><label for="tm">统计范围</label><select id="tm"><option value="">全部测试者</option>${teams.teams.map((t) => `<option value="${t.id}"${String(t.id) === String(team) ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`;
      app.innerHTML = `<div class="crumb"><a href="/admin.html">← 返回管理后台</a></div>${sel}${CAReport.render(st, cfg.anchors, cfg.order, { title: st.team ? st.team.name + ' · 统计报表' : '统计报表' })}`;
      CAReport.wire(st.days);
      document.getElementById('tm').onchange = (e) => { team = e.target.value; history.replaceState(null, '', team ? '?team=' + team : location.pathname); load(); };
    } catch (e) { e.status === 404 && team ? ((team = ''), load()) : denied(e.status === 401 || e.status === 429 ? '登录已失效，请回到管理后台重新登录。' : e.message); }
  }
  load();
})();
