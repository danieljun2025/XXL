'use strict';
// 概览：登录入口 + 关键数字 + 待办提醒 + 快捷入口。其他功能在顶部标签里。
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      try { await api('GET', '/api/admin/stats'); try { sessionStorage.setItem('ca_admin', pw); } catch (x) { /* 忽略 */ } CAAdminNav.mount(); load(); } catch (er) { login(er.message); }
    });
  }
  const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  const LABEL = { warn: '待处理', ok: '正常', info: '提示' };
  async function load() {
    try {
      const o = await api('GET', '/api/admin/overview'), k = o.kpis;
      const warns = o.todos.filter((t) => t.level === 'warn').length;
      app.innerHTML = `<h1>概览</h1>
        <section class="panel"><div class="kpis">
          <div><b>${k.submitted}</b>已完成</div><div><b>${k.drafts}</b>进行中</div><div><b>${pct(k.completionRate)}</b>完成率</div>
          <div><b>${k.last7}</b>近 7 天完成</div><div><b>${k.participants}</b>测试者</div><div><b>${k.openTeams}</b>开放的团队</div><div><b>${k.activeCodes}</b>可用的兑换码</div></div></section>
        <section class="panel"><h2>待办提醒${warns ? `（${warns} 项待处理）` : ''}</h2><div class="todo">
          ${o.todos.map((t) => `<div class="t"><span class="pill ${t.level}">${LABEL[t.level]}</span><span>${esc(t.text)}</span>${t.action ? `<a href="${esc(t.action.href)}">${esc(t.action.label)}</a>` : ''}</div>`).join('')}</div></section>
        <section class="panel"><h2>快捷入口</h2><div class="qa"><a href="/codes.html">生成兑换码</a><a href="/teams.html">创建团队</a><a href="/settings.html#data">下载数据库备份</a><button type="button" id="csv">导出记录 CSV</button><a href="/report.html">看统计报表</a></div></section>`;
      document.getElementById('csv').onclick = async () => {
        const res = await api('GET', '/api/admin/attempts/export.csv', true);
        const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'career-anchor.csv'; a.click(); URL.revokeObjectURL(a.href);
      };
    } catch (e) { try { sessionStorage.removeItem('ca_admin'); } catch (x) { /* 忽略 */ } pw = ''; CAAdminNav.mount(); login(e.message); }
  }
  pw ? load() : login();
})();
