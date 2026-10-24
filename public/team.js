'use strict';
// 团队负责人页：凭「团队报告码」查看本团队的汇总；报告码在后台「团队管理」里生成。
(function () {
  const app = document.getElementById('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
  let cfg = null;

  function askKey(msg, key) {
    app.innerHTML = `<div class="card"><h1>团队报告</h1><p class="muted">请输入负责人拿到的「团队报告码」。这里只能看到本团队的汇总统计。</p>
      <form id="f" class="keybox"><input id="k" type="text" autocomplete="off" autocapitalize="characters" maxlength="20" placeholder="例如 AB3K-7MQ2-XY9P" value="${esc(key || '')}" required aria-label="团队报告码"><button type="submit">查看</button></form>
      <div class="err" role="alert">${esc(msg || '')}</div></div>`;
    document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); load(document.getElementById('k').value); });
  }

  async function load(key) {
    key = String(key || '').trim();
    if (!key) return askKey();
    let d;
    try {
      const res = await fetch('/api/team/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, tz: -new Date().getTimezoneOffset() }) });
      d = await res.json().catch(() => ({}));
      if (!res.ok) return askKey(d.error || '请求失败', key);
    } catch (e) { return askKey('网络错误，请重试', key); }
    try { history.replaceState(null, '', '#' + key); } catch (e) { /* 忽略 */ }
    cfg = cfg || await (await fetch('/api/config')).json();
    const t = d.team, A = cfg.anchors;
    const note = `<p class="notice">${t.shareNames ? '本报告包含团队汇总，以及成员的姓名和主职业锚（成员在加入时已被告知）。' : '本报告只包含团队汇总统计，不包含任何成员的姓名、答案或个人结果。'}${t.closed ? ' 该团队已停止接收新成员。' : ''}</p>`;
    let body;
    if (d.insufficient) {
      body = `<section class="panel"><h2>汇总暂不显示</h2><p>目前已有 <b>${d.submitted}</b> 人完成测试（参与 ${d.participants} 人，进行中 ${d.drafts} 人）。为保护成员隐私，需要至少 <b>${d.minGroup}</b> 人完成后才显示汇总。</p><p class="muted">继续邀请成员完成测试，稍后刷新本页即可。</p></section>`;
    } else {
      body = CAReport.render(d.report, A, cfg.order, { title: t.name + ' · 团队报告', note });
    }
    const members = d.members ? `<section class="panel"><h2>成员</h2><div style="overflow-x:auto"><table><thead><tr><th>姓名</th><th>主职业锚</th><th>完成时间</th></tr></thead><tbody>${d.members.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.primary.map((c) => esc(A[c].name)).join('、')}</td><td>${fmt(m.submittedAt)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">还没有人完成</td></tr>'}</tbody></table></div></section>` : '';
    app.innerHTML = `${d.insufficient ? `<div class="head"><h1>${esc(t.name)} · 团队报告</h1></div>` : ''}<div class="stack">${d.insufficient ? note : ''}${body}${members}<div class="row"><button class="ghost" id="rf">刷新</button></div></div>`;
    if (!d.insufficient) CAReport.wire(d.report.days);
    document.getElementById('rf').onclick = () => load(key);
  }
  load(decodeURIComponent((location.hash || '').slice(1)));
})();
