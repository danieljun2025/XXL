'use strict';
// 报表图表：管理后台报表页和团队负责人页共用。页面需有 #app 和 #tip 两个元素。
(function () {
  const app = document.getElementById('app');
  const tip = document.getElementById('tip');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ---- 悬浮提示：任何带 data-tip 的元素 ----
  function showTip(text, x, y) {
    tip.textContent = text; tip.style.opacity = 1;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
    tip.style.top = Math.max(8, y - h - 12) + 'px';
  }
  const hideTip = () => { tip.style.opacity = 0; };
  document.addEventListener('pointermove', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); t ? showTip(t.dataset.tip, e.clientX, e.clientY) : hideTip(); });
  document.addEventListener('pointerleave', hideTip);

  const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  const niceMax = (v) => { if (v <= 4) return 4; const q = v <= 10 ? 2 : v <= 100 ? 10 : 20; return Math.ceil(v / q) * q; }; // 取偶数/整十，保证中间刻度是整数

  // ---- 完成率环 ----
  function ring(done, total) {
    const R = 52, C = 2 * Math.PI * R, f = total ? done / total : 0;
    return `<svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="完成率 ${pct(total ? f : null)}，${done} / ${total}">
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--line)" stroke-width="14"/>
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--brand)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C * f} ${C}" transform="rotate(-90 70 70)" data-tip="已完成 ${done} / 全部 ${total} 条记录"/>
      <text x="70" y="72" text-anchor="middle" class="ring-t">${pct(total ? f : null)}</text><text x="70" y="92" text-anchor="middle" class="ring-s">完成率</text></svg>`;
  }

  // ---- 横向条形 ----
  function hbars(items, max, fmtVal) {
    const top = Math.max(...items.map((i) => i.value));
    return `<div class="hb">${items.map((it) => `<div class="hb-row${it.value === top && top > 0 ? ' top' : ''}" data-tip="${esc(it.tip)}"><span class="hb-l">${esc(it.label)}</span><span class="hb-t"><i style="width:${max ? (it.value / max) * 100 : 0}%"></i></span><span class="hb-v">${esc(fmtVal(it))}</span></div>`).join('')}</div>`;
  }

  // ---- 雷达图：群体平均画像 ----
  function radar(order, A, avg) {
    const vals = order.map((c) => avg[c] || 0);
    const MAX = Math.max(4, Math.ceil(Math.max(...vals) + 0.5));
    const C = 170, R = 110, n = order.length;
    const pt = (i, r) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
    const rings = [1 / 3, 2 / 3, 1].map((f) => `<polygon class="gridl" points="${order.map((_, i) => pt(i, R * f).join(',')).join(' ')}"/>`).join('');
    const ticks = [1 / 3, 2 / 3, 1].map((f) => `<text class="ax radar-t" x="${C + 4}" y="${C - R * f - 2}">${(MAX * f).toFixed(1).replace('.0', '')}</text>`).join('');
    const axes = order.map((_, i) => `<line class="gridl" x1="${C}" y1="${C}" x2="${pt(i, R)[0]}" y2="${pt(i, R)[1]}"/>`).join('');
    const poly = order.map((c, i) => pt(i, (R * (avg[c] || 0)) / MAX).join(',')).join(' ');
    const dots = order.map((c, i) => { const [x, y] = pt(i, (R * (avg[c] || 0)) / MAX); return `<circle class="dot" cx="${x}" cy="${y}" r="4"/><circle cx="${x}" cy="${y}" r="14" fill="transparent" data-tip="${esc(A[c].name)} 平均 ${(avg[c] ?? 0).toFixed(1)}"/>`; }).join('');
    const labels = order.map((c, i) => { const [x, y] = pt(i, R + 26); return `<text class="lbl" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${esc(A[c].name.replace('型', ''))}</text>`; }).join('');
    return `<svg class="chart" viewBox="0 0 340 340" role="img" aria-label="各维度平均得分雷达图" style="max-width:380px;margin:0 auto">${rings}${axes}${ticks}<polygon class="shape" points="${poly}"/>${dots}${labels}</svg>`;
  }

  // 画布宽度跟随容器，保证手机上文字仍是 11px 左右
  const trendW = () => Math.max(300, Math.min(900, Math.round(app.clientWidth - 42)));
  // ---- 折线面积图：近 30 天 ----
  function trend(days) {
    const W = trendW(), H = 230, L = 34, Rr = 14, T = 16, B = 28;
    const iw = W - L - Rr, ih = H - T - B;
    const ymax = niceMax(Math.max(1, ...days.map((d) => d.count)));
    const x = (i) => L + (iw * i) / (days.length - 1), y = (v) => T + ih - (ih * v) / ymax;
    const pts = days.map((d, i) => [x(i), y(d.count)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ` L ${x(days.length - 1)} ${T + ih} L ${x(0)} ${T + ih} Z`;
    const yt = [0, ymax / 2, ymax].map((v) => `<line class="gridl" x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`).join('');
    const xt = [0, 7, 14, 21, 29].map((i) => `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 29 ? 'end' : 'middle'}">${days[i].date.slice(5)}</text>`).join('');
    const last = pts[pts.length - 1];
    return `<svg class="chart" id="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 30 天每日完成人数">${yt}${xt}<path class="area" d="${area}"/><path class="line" d="${line}"/>
      <line class="cross" id="cx" y1="${T}" y2="${T + ih}" style="display:none"/><circle class="dot" id="cd" r="5" style="display:none"/>
      <circle class="dot" cx="${last[0]}" cy="${last[1]}" r="4.5"/><text class="lbl" x="${last[0] - 8}" y="${last[1] - 10}" text-anchor="end">${days[days.length - 1].count}</text>
      <rect id="hit" x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  }
  function wireTrend(days) {
    const svg = document.getElementById('trend'); if (!svg) return;
    const hit = svg.querySelector('#hit'), cx = svg.querySelector('#cx'), cd = svg.querySelector('#cd');
    const [L, Rr, T, B, H] = [34, 14, 16, 28, 230]; const W = trendW(); const iw = W - L - Rr, ih = H - T - B;
    const ymax = niceMax(Math.max(1, ...days.map((d) => d.count)));
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - L) / iw) * (days.length - 1))));
      const X = L + (iw * i) / (days.length - 1), Y = T + ih - (ih * days[i].count) / ymax;
      cx.setAttribute('x1', X); cx.setAttribute('x2', X); cd.setAttribute('cx', X); cd.setAttribute('cy', Y);
      cx.style.display = cd.style.display = '';
      showTip(`${days[i].date}：${days[i].count} 人完成`, r.left + (X / W) * r.width, r.top + (Y / H) * r.height);
    });
    hit.addEventListener('pointerleave', () => { cx.style.display = cd.style.display = 'none'; hideTip(); });
  }

  // ---- 用时分布柱状图 ----
  function histogram(bins) {
    const W = 360, H = 190, L = 28, T = 16, B = 40, n = bins.length;
    const ymax = niceMax(Math.max(1, ...bins.map((b) => b.count)));
    const iw = W - L - 8, ih = H - T - B, slot = iw / n, bw = slot * 0.62;
    const y = (v) => T + ih - (ih * v) / ymax;
    const yt = [0, ymax / 2, ymax].map((v) => `<line class="gridl" x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`).join('');
    const bars = bins.map((b, i) => { const bx = L + slot * i + (slot - bw) / 2, by = y(b.count);
      return `<path class="bar" d="M${bx} ${T + ih} V${by + 4} Q${bx} ${by} ${bx + 4} ${by} H${bx + bw - 4} Q${bx + bw} ${by} ${bx + bw} ${by + 4} V${T + ih} Z" data-tip="${esc(b.label)}：${b.count} 人"/>
        ${b.count ? `<text class="lbl" x="${bx + bw / 2}" y="${by - 5}" text-anchor="middle">${b.count}</text>` : ''}
        <text class="ax" x="${bx + bw / 2}" y="${H - 20}" text-anchor="middle">${esc(b.label.replace(' 分', '').replace('以上', '+'))}</text>`; }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="答题用时分布">${yt}${bars}<text class="ax" x="${W / 2}" y="${H - 3}" text-anchor="middle">用时（分钟）</text></svg>`;
  }

  function report(st, A, order, opts = {}) {
    const total = st.submitted + st.drafts;
    const dist = order.map((c) => ({ label: A[c].name, value: st.primary[c] })).sort((a, b) => b.value - a.value);
    const dsum = dist.reduce((a, d) => a + d.value, 0);
    dist.forEach((d) => { d.tip = `${d.label}：${d.value} 人次（${dsum ? Math.round((d.value / dsum) * 100) : 0}%）`; });
    const ranked = order.slice().sort((a, b) => (st.avgScores[b] || 0) - (st.avgScores[a] || 0));
    const topAnchor = st.submitted ? dist[0].label : null;
    const empty = '<p class="muted">还没有人完成测试，数据会随着答题自动出现。</p>';
    return `<div class="head"><h1>${esc(opts.title || '统计报表')}</h1><span class="muted" style="margin:0">更新于 ${new Date().toLocaleString('zh-CN', { hour12: false })}</span></div>
    <div class="stack">${opts.note || ''}
      <section class="panel hero">${ring(st.submitted, total)}
        <div class="kpis">
          <div><b>${st.participants}</b>测试者</div><div><b>${st.submitted}</b>已完成</div><div><b>${st.drafts}</b>进行中</div>
          <div><b>${st.last7}</b>近 7 天完成</div><div><b>${st.medianMinutes == null ? '—' : st.medianMinutes < 1 ? '<1 分' : st.medianMinutes + ' 分'}</b>中位用时</div><div><b>${st.retakers}</b>重测人数</div></div></section>
      <div class="grid2">
        <section class="panel"><h2>主职业锚分布</h2><p class="muted">${st.submitted ? `最多的是「${esc(topAnchor)}」；共 ${dsum} 人次，并列的主职业锚各计一次` : '各职业锚的人次'}</p>
          ${st.submitted ? hbars(dist, Math.max(1, ...dist.map((d) => d.value)), (it) => `${it.value}（${dsum ? Math.round((it.value / dsum) * 100) : 0}%）`) : empty}</section>
        <section class="panel"><h2>群体平均画像</h2><p class="muted">已完成者在 8 个维度上的平均得分，刻度随数据自动缩放</p>
          ${st.submitted ? radar(order, A, st.avgScores) : empty}</section>
      </div>
      <section class="panel"><h2>近 30 天每日完成数</h2><p class="muted">共 ${st.days.reduce((a, d) => a + d.count, 0)} 人完成；鼠标移到曲线上看每天的数字</p>${trend(st.days)}</section>
      <div class="grid2">
        <section class="panel"><h2>答题用时分布</h2><p class="muted">从开始到提交，中位数 ${st.medianMinutes == null ? '—' : st.medianMinutes + ' 分钟'}</p>${st.submitted ? histogram(st.durationBins) : empty}</section>
        <section class="panel"><h2>各维度平均得分</h2><p class="muted">按平均分从高到低</p>
          ${st.submitted ? hbars(ranked.map((c) => ({ label: A[c].name, value: st.avgScores[c] || 0, tip: `${A[c].name} 平均 ${(st.avgScores[c] ?? 0).toFixed(1)}` })), 8.4, (it) => it.value.toFixed(1)) : empty}</section>
      </div>
      <details class="panel"><summary>查看数据表</summary>
        <div style="overflow-x:auto"><table><thead><tr><th>职业锚</th><th class="n">主职业锚人次</th><th class="n">平均得分</th></tr></thead><tbody>
        ${order.map((c) => `<tr><td>${esc(A[c].name)}</td><td class="n">${st.primary[c]}</td><td class="n">${st.avgScores[c] == null ? '—' : st.avgScores[c].toFixed(1)}</td></tr>`).join('')}</tbody></table></div></details>
    </div>`;
  }

  window.CAReport = { render: report, wire: wireTrend };
})();
