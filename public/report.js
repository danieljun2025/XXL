'use strict';
// 统计报表：只能从管理后台点链接进入（沿用后台登录时存放的口令）；直接打开会被拒绝。
(function () {
  const app = document.getElementById('app');
  let pw = ''; try { pw = sessionStorage.getItem('ca_admin') || ''; } catch (e) { /* 忽略 */ }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const denied = (msg) => { app.innerHTML = `<div class="card"><h1>无权访问</h1><p>${esc(msg || '请先登录管理后台，再从后台进入统计报表。')}</p><div class="row"><a href="/admin.html">前往管理后台</a></div></div>`; };
  async function api(path) {
    const res = await fetch(path, { headers: { Authorization: 'Bearer ' + pw } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(d.error || '请求失败'); e.status = res.status; throw e; }
    return d;
  }
  const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  function hbars(items, max, fmtVal) {
    return `<div class="hb">${items.map((it) => `<div class="hb-row" title="${esc(it.tip)}"><span class="hb-l">${esc(it.label)}</span><span class="hb-t"><i style="width:${max ? (it.value / max) * 100 : 0}%"></i></span><span class="hb-v">${esc(fmtVal(it))}</span></div>`).join('')}</div>`;
  }
  function report(st, A, order) {
    const dist = order.map((c) => ({ label: A[c].name, value: st.primary[c], tip: `${A[c].name}：${st.primary[c]} 人次` })).sort((a, b) => b.value - a.value);
    const total = dist.reduce((a, d) => a + d.value, 0);
    const avg = order.map((c) => ({ label: A[c].name, value: st.avgScores[c] || 0, tip: `${A[c].name} 平均 ${st.avgScores[c] ?? '—'}` })).sort((a, b) => b.value - a.value);
    const dmax = Math.max(1, ...st.days.map((d) => d.count));
    const first = st.days[0].date.slice(5), mid = st.days[15].date.slice(5), last = st.days[29].date.slice(5);
    return `<div class="kpis">
        <div><b>${st.participants}</b>测试者</div><div><b>${st.submitted}</b>已完成</div><div><b>${st.drafts}</b>进行中</div>
        <div><b>${pct(st.completionRate)}</b>完成率</div><div><b>${st.last7}</b>近 7 天完成</div><div><b>${st.medianMinutes == null ? '—' : st.medianMinutes < 1 ? '<1 分' : st.medianMinutes + ' 分'}</b>中位用时</div><div><b>${st.retakers}</b>重测人数</div></div>
      <h2>主职业锚分布</h2><p class="muted">共 ${total} 人次（并列的主职业锚各计一次）</p>
      ${st.submitted ? hbars(dist, Math.max(1, ...dist.map((d) => d.value)), (it) => `${it.value}（${total ? Math.round((it.value / total) * 100) : 0}%）`) : '<p class="muted">还没有人完成测试。</p>'}
      <h2>各维度平均得分</h2><p class="muted">已完成者的平均分，范围 1–8.4（含加分）</p>
      ${st.submitted ? hbars(avg, 8.4, (it) => it.value.toFixed(1)) : '<p class="muted">暂无数据。</p>'}
      <h2>近 30 天每日完成数</h2>
      <div class="cols" role="img" aria-label="近 30 天每日完成人数柱状图，最高 ${dmax} 人">${st.days.map((d) => `<span class="col" title="${esc(d.date)}：${d.count} 人"><i style="height:${(d.count / dmax) * 100}%"></i></span>`).join('')}</div>
      <div class="cols-x"><span>${first}</span><span>${mid}</span><span>${last}</span><span class="muted">最高 ${dmax} 人/天</span></div>`;
  }

  async function load() {
    if (!pw) return denied();
    try {
      const cfg = await (await fetch('/api/config')).json();
      const st = await api('/api/admin/report?tz=' + -new Date().getTimezoneOffset());
      app.innerHTML = `<div class="crumb"><a href="/admin.html">← 返回管理后台</a></div><div class="card"><h1>统计报表</h1>${report(st, cfg.anchors, cfg.order)}</div>`;
    } catch (e) { denied(e.status === 401 || e.status === 429 ? '登录已失效，请回到管理后台重新登录。' : e.message); }
  }
  load();
})();
