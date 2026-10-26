'use strict';
// 管理后台顶部导航：所有后台页面共用。只有登录后（sessionStorage 里有口令）才显示；页面用 <body data-tab="..."> 标出当前标签。
(function () {
  const TABS = [['overview', '概览', '/admin.html'], ['records', '记录', '/records.html'], ['stats', '统计', '/report.html'], ['codes', '兑换码', '/codes.html'], ['teams', '团队', '/teams.html'], ['settings', '设置', '/settings.html']];
  function mount() {
    let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
    const old = document.querySelector('.anav'); if (old) old.remove();
    if (!pw) return;
    const cur = document.body.dataset.tab;
    const el = document.createElement('div');
    el.className = 'anav';
    el.innerHTML = `<div class="abar"><b>职业锚 · 管理后台</b><span class="sp"></span><button type="button" class="out" id="anav-out">退出</button></div>
      <nav aria-label="后台导航">${TABS.map(([id, name, href]) => `<a href="${href}"${id === cur ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</nav>`;
    document.body.prepend(el);
    el.querySelector('#anav-out').onclick = () => { try { sessionStorage.removeItem('ca_admin'); } catch (e) { /* 忽略 */ } location.href = '/admin.html'; };
  }
  window.CAAdminNav = { mount };
  mount();
})();
