'use strict';
(function () {
  const app = document.getElementById('app');
  const S = { token: null, name: '', attempts: [], cfg: null, att: null, page: 0, picks: [], mode: 'new' };
  try { S.token = sessionStorage.getItem('ca_token'); } catch (e) { /* 忽略 */ }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
  const $ = (sel) => app.querySelector(sel);

  async function api(method, path, body) {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.token && path !== '/api/enter') { setToken(null); render(); throw new Error(data.error || '登录已过期'); }
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }
  function setToken(t) { S.token = t; try { t ? sessionStorage.setItem('ca_token', t) : sessionStorage.removeItem('ca_token'); } catch (e) { /* 忽略 */ } }
  const view = (html) => { app.innerHTML = html; window.scrollTo(0, 0); const h = app.querySelector('h1,h2'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } };

  // ---------- 入口 ----------
  function renderEnter(msg) {
    if (window.CA_STATIC) {
      view(`<div class="card"><h1>职业锚测试</h1>
        <p class="muted">共 40 题，约 10 分钟。完成后立即生成你的职业锚报告，报告上会显示你的名字，并可保存为图片。</p>
        <form id="f" autocomplete="off"><label for="name">你的名字</label><input id="name" type="text" maxlength="30" required>
        <div class="err" id="err" role="alert">${esc(msg || '')}</div>
        <div class="row"><button type="submit">开始测试</button></div></form></div>`);
      $('#f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const r = await api('POST', '/api/enter', { name: $('#name').value });
          setToken(r.token); S.name = r.name; S.attempts = r.attempts;
          await afterLogin();
        } catch (er) { btn.disabled = false; $('#err').textContent = er.message; }
      });
      return;
    }
    const isNew = S.mode === 'new';
    view(`<div class="card">
      <h1>职业锚测试</h1>
      <p class="muted">共 40 题，约 10 分钟。完成后立即获得你的职业锚报告，结果会保存，之后可凭「邮箱 + 查看密钥」再次查看。</p>
      <div class="tabs" role="group" aria-label="身份">
        <button type="button" data-mode="new" aria-pressed="${isNew}">首次测试</button>
        <button type="button" data-mode="back" aria-pressed="${!isNew}">我已有记录</button>
      </div>
      <form id="f" autocomplete="off">
        ${isNew ? '<label for="name">姓名</label><input id="name" type="text" maxlength="30" required>' : ''}
        <label for="email">邮箱</label><input id="email" type="email" maxlength="120" required>
        <label for="key">查看密钥</label><input id="key" type="password" minlength="6" maxlength="32" required autocomplete="new-password">
        ${isNew ? '<label for="key2">再次输入查看密钥</label><input id="key2" type="password" minlength="6" maxlength="32" required autocomplete="new-password"><p class="muted">密钥 6–32 位，用于以后查看结果。系统不会发邮件，忘记后需联系管理员重置，请牢记。</p>' : '<p class="muted">忘记密钥？请联系管理员重置。</p>'}
        <div class="err" id="err" role="alert">${esc(msg || '')}</div>
        <div class="row"><button type="submit">${isNew ? '开始测试' : '进入'}</button></div>
      </form></div>`);
    app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { S.mode = b.dataset.mode; renderEnter(); }));
    $('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = $('#key').value;
      if (isNew && key !== $('#key2').value) return ($('#err').textContent = '两次输入的密钥不一致');
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const r = await api('POST', '/api/enter', { name: isNew ? $('#name').value : undefined, email: $('#email').value, key });
        setToken(r.token); S.name = r.name; S.attempts = r.attempts;
        await afterLogin();
      } catch (er) { btn.disabled = false; $('#err').textContent = er.message; }
    });
  }

  async function afterLogin() {
    if (!S.cfg) S.cfg = await api('GET', '/api/config');
    const draft = S.attempts.find((a) => a.status === 'draft');
    if (!S.attempts.length || (S.attempts.length === 1 && draft)) return startOrResume();
    renderHome();
  }

  function renderHome() {
    const hasDraft = S.attempts.some((a) => a.status === 'draft');
    view(`<div class="card"><h1>你好，${esc(S.name)}</h1><p class="muted">你的测试记录：</p>
      <ul class="hist">${S.attempts.map((a) => `<li><span>${a.status === 'submitted' ? `已完成 · ${fmt(a.submittedAt)} ${(a.primary || []).map((c) => `<span class="badge">${esc(S.cfg.anchors[c].name)}</span>`).join('')}` : `未完成 · 开始于 ${fmt(a.startedAt)}`}</span>
        <button class="ghost" data-open="${a.id}">${a.status === 'submitted' ? '查看结果' : '继续作答'}</button></li>`).join('')}</ul>
      <div class="row">${hasDraft ? '' : '<button id="again">重新测试</button>'}<button class="ghost" id="out">退出</button></div></div>`);
    app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openAttempt(Number(b.dataset.open))));
    const again = $('#again'); if (again) again.addEventListener('click', startOrResume);
    $('#out').addEventListener('click', logout);
  }

  async function logout() { try { await api('POST', '/api/logout'); } catch (e) { /* 忽略 */ } setToken(null); S.att = null; S.mode = 'back'; renderEnter(); }

  async function startOrResume() { S.att = await api('POST', '/api/attempts'); S.page = firstUnanswered(); S.picks = []; renderQuiz(); }
  async function openAttempt(id) {
    S.att = await api('GET', '/api/attempts/' + id);
    if (S.att.status === 'submitted') return renderResult(S.att);
    S.page = firstUnanswered(); S.picks = []; renderQuiz();
  }
  const pageSize = () => Math.max(1, Number(S.att.config.pageSize) || 5);
  function firstUnanswered() {
    const i = S.att.questions.findIndex((q) => !S.att.answers[q.id]);
    return i < 0 ? Math.floor((S.att.questions.length - 1) / pageSize()) : Math.floor(i / pageSize());
  }

  // ---------- 答题 ----------
  let saveTimer = null; const dirty = {};
  async function flush() {
    clearTimeout(saveTimer);
    const answers = { ...dirty }; if (!Object.keys(answers).length) return;
    for (const k in dirty) delete dirty[k];
    try { await api('PUT', `/api/attempts/${S.att.id}/answers`, { answers }); }
    catch (e) { Object.assign(dirty, answers); throw e; }
  }

  function renderQuiz(msg) {
    const A = S.att, size = pageSize(), total = A.questions.length, pages = Math.ceil(total / size);
    const qs = A.questions.slice(S.page * size, (S.page + 1) * size);
    const answered = Object.keys(A.answers).length;
    const last = S.page === pages - 1;
    view(`<div class="card"><h2>第 ${S.page + 1} / ${pages} 页 · 已答 ${answered} / ${total}</h2>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${answered}"><i style="width:${(answered / total) * 100}%"></i></div>
      <p class="muted">请根据你的真实感受，选择每句话与你的符合程度（1 = 完全不符合，6 = 完全符合）。答案会自动保存，可随时关闭，之后用同一邮箱和密钥继续。</p>
      ${qs.map((q, i) => `<fieldset class="q" style="border:0;margin:0;padding:14px 0"><legend style="padding:0;font-weight:600">${S.page * size + i + 1}. ${esc(q.text)}</legend>
        <div class="scale">${[1, 2, 3, 4, 5, 6].map((v) => `<label class="opt"><input type="radio" name="q${q.id}" value="${v}" data-q="${q.id}" ${A.answers[q.id] === v ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
        <div class="ends"><span>完全不符合</span><span>完全符合</span></div></fieldset>`).join('')}
      <div class="err" id="err" role="alert">${esc(msg || '')}</div>
      <div class="row"><button class="ghost" id="prev" ${S.page === 0 ? 'disabled' : ''}>上一页</button><button id="next" disabled>${last ? (A.config.top3Bonus ? '下一步' : '提交并查看结果') : '下一页'}</button></div></div>`);
    const next = $('#next');
    const ready = () => (next.disabled = !qs.every((q) => A.answers[q.id]));
    ready();
    app.querySelectorAll('input[type=radio]').forEach((r) => r.addEventListener('change', () => {
      const id = Number(r.dataset.q), v = Number(r.value);
      A.answers[id] = v; dirty[id] = v; ready();
      const n = Object.keys(A.answers).length;
      $('.bar i').style.width = (n / total) * 100 + '%';
      $('h2').textContent = `第 ${S.page + 1} / ${pages} 页 · 已答 ${n} / ${total}`;
      clearTimeout(saveTimer); saveTimer = setTimeout(() => flush().catch(() => {}), 500);
    }));
    $('#prev').addEventListener('click', async () => { try { await flush(); } catch (e) { /* 忽略，下一页再试 */ } S.page--; renderQuiz(); });
    next.addEventListener('click', async () => {
      next.disabled = true;
      try { await flush(); } catch (e) { return renderQuiz('保存失败：' + e.message + '（请检查网络后重试）'); }
      if (!last) { S.page++; return renderQuiz(); }
      A.config.top3Bonus ? renderPicks() : submit();
    });
  }

  function renderPicks(msg) {
    const A = S.att;
    view(`<div class="card"><h2>最后一步：选出最认同的 3 句话</h2>
      <p class="muted">从下面 40 句话中，选出最能代表你的 3 句。已选 <b id="cnt">${S.picks.length}</b> / 3。</p>
      ${A.questions.map((q) => `<label class="pick"><input type="checkbox" value="${q.id}" ${S.picks.includes(q.id) ? 'checked' : ''}><span>${esc(q.text)}</span></label>`).join('')}
      <div class="err" id="err" role="alert">${esc(msg || '')}</div>
      <div class="row"><button class="ghost" id="back">返回修改</button><button id="go" disabled>提交并查看结果</button></div></div>`);
    const sync = () => {
      S.picks = [...app.querySelectorAll('input:checked')].map((c) => Number(c.value));
      $('#cnt').textContent = S.picks.length; $('#go').disabled = S.picks.length !== 3;
      app.querySelectorAll('input:not(:checked)').forEach((c) => (c.disabled = S.picks.length >= 3));
    };
    app.querySelectorAll('input').forEach((c) => c.addEventListener('change', sync)); sync();
    $('#back').addEventListener('click', () => { S.page = Math.ceil(A.questions.length / pageSize()) - 1; renderQuiz(); });
    $('#go').addEventListener('click', submit);
  }

  async function submit() {
    const btn = $('#go') || $('#next'); if (btn) btn.disabled = true;
    try {
      const r = await api('POST', `/api/attempts/${S.att.id}/submit`, { picks: S.att.config.top3Bonus ? S.picks : [] });
      S.attempts = (await api('GET', '/api/me')).attempts; S.att = r; renderResult(r);
    } catch (e) { S.att.config.top3Bonus ? renderPicks(e.message) : renderQuiz(e.message); }
  }

  // ---------- 结果 ----------
  function radar(scores, order, primary) {
    const C = 170, R = 108, n = order.length, MAX = S.cfg.top3Bonus ? 8.4 : 6;
    const pt = (i, r) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
    const rings = [1 / 3, 2 / 3, 1].map((v) => `<polygon class="grid" points="${order.map((_, i) => pt(i, R * v).join(',')).join(' ')}"/>`).join('');
    const ticks = [1 / 3, 2 / 3, 1].map((v) => `<text class="tick" x="${C + 4}" y="${C - R * v - 2}">${(MAX * v).toFixed(1).replace('.0', '')}</text>`).join('');
    const axes = order.map((_, i) => `<line class="grid" x1="${C}" y1="${C}" x2="${pt(i, R)[0]}" y2="${pt(i, R)[1]}"/>`).join('');
    const shape = `<polygon class="shape" points="${order.map((c, i) => pt(i, (R * Math.min(scores[c], MAX)) / MAX).join(',')).join(' ')}"/>`;
    const dots = order.map((c, i) => { const [x, y] = pt(i, (R * Math.min(scores[c], MAX)) / MAX); return primary.includes(c) ? `<circle class="pdot" cx="${x}" cy="${y}" r="6"/>` : `<circle class="odot" cx="${x}" cy="${y}" r="3.5"/>`; }).join('');
    const labels = order.map((c, i) => { const [x, y] = pt(i, R + 28); const p = primary.includes(c); return `<text class="rl${p ? ' main' : ''}" x="${x}" y="${y - 6}" text-anchor="middle">${esc(S.cfg.anchors[c].name.replace('型', ''))}</text><text class="rs${p ? ' main' : ''}" x="${x}" y="${y + 9}" text-anchor="middle">${scores[c].toFixed(1)}</text>`; }).join('');
    return `<svg class="radar" viewBox="0 0 340 340" role="img" aria-label="八个职业锚得分雷达图">${rings}${axes}${ticks}${shape}${dots}${labels}</svg>`;
  }
  const list = (arr) => `<ul class="tag-list">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

  // ---------- 保存为图片（Canvas 自绘，无需外部库） ----------
  function drawReport(r) {
    const AN = S.cfg.anchors, order = S.cfg.order, MAX = S.cfg.top3Bonus ? 8.4 : 6;
    const W = 1080, P = 64, CW = W - P * 2;
    const FONT = '-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
    const col = { bg: '#ffffff', text: '#1f2933', muted: '#667085', brand: '#2f6fed', line: '#e4e7ec', sel: '#e8f0fe' };
    function layout(ctx, draw) {
      let y = 0;
      const wrap = (t, size, color, opt = {}) => {
        const x = P + (opt.indent || 0), w = CW - (opt.indent || 0), lh = Math.round(size * 1.55);
        ctx.font = `${opt.bold ? '700' : '400'} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        let line = '';
        for (const ch of t) {
          if (ctx.measureText(line + ch).width > w && line) { if (draw) ctx.fillText(line, x, y); y += lh; line = ch; } else line += ch;
        }
        if (line) { if (draw) ctx.fillText(line, x, y); y += lh; }
      };
      const bullets = (arr) => arr.forEach((t) => { if (draw) { ctx.fillStyle = col.brand; ctx.beginPath(); ctx.arc(P + 8, y + 21, 5, 0, 7); ctx.fill(); } wrap(t, 28, col.text, { indent: 28 }); });
      if (draw) { ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, 99999); ctx.fillStyle = col.brand; ctx.fillRect(0, 0, W, 14); }
      y = 70;
      wrap(`${r.name} 的职业锚报告`, 44, col.brand, { bold: true });
      wrap(`${r.name} · ${fmt(r.submittedAt)} · ${r.reportNo}`, 24, col.muted);
      y += 24;
      wrap('我的主职业锚', 30, col.muted);
      wrap(r.primary.map((c) => AN[c].name).join(' · '), 66, col.text, { bold: true });
      y += 16;
      r.primary.forEach((c) => {
        const a = AN[c];
        if (draw) { ctx.fillStyle = col.sel; ctx.fillRect(P, y, CW, 2); }
        y += 24;
        wrap(`${a.name}（${a.en}）`, 32, col.brand, { bold: true });
        wrap(a.definition, 28, col.text);
        y += 10; wrap('核心动机', 28, col.muted, { bold: true }); wrap(a.motivation, 28, col.text);
        y += 10; wrap('典型优势', 28, col.muted, { bold: true }); bullets(a.strengths);
        y += 10; wrap('发展建议', 28, col.muted, { bold: true }); bullets(a.advice);
        y += 20;
      });
      if (draw) { ctx.fillStyle = col.sel; ctx.fillRect(P, y, CW, 2); }
      y += 30;
      wrap('八个维度得分', 34, col.text, { bold: true });
      y += 20;
      const R = 220, cx = W / 2, cy = y + R + 50;
      if (draw) {
        const pt = (i, rr) => { const t = -Math.PI / 2 + (2 * Math.PI * i) / order.length; return [cx + rr * Math.cos(t), cy + rr * Math.sin(t)]; };
        ctx.strokeStyle = col.line; ctx.lineWidth = 2;
        [1 / 3, 2 / 3, 1].forEach((f) => { ctx.beginPath(); order.forEach((_, i) => { const [x, yy] = pt(i, R * f); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }); ctx.closePath(); ctx.stroke(); });
        order.forEach((_, i) => { const [x, yy] = pt(i, R); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, yy); ctx.stroke(); });
        ctx.beginPath();
        order.forEach((c, i) => { const [x, yy] = pt(i, (R * Math.min(r.scores[c], MAX)) / MAX); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); });
        ctx.closePath(); ctx.fillStyle = 'rgba(47,111,237,.25)'; ctx.fill(); ctx.strokeStyle = col.brand; ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = col.text; ctx.font = `400 26px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        order.forEach((c, i) => { const [x, yy] = pt(i, R + 46); ctx.fillText(AN[c].name.replace('型', ''), x, yy); });
      }
      y = cy + R + 90;
      r.ranking.forEach((c) => {
        if (draw) {
          ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = `400 28px ${FONT}`; ctx.fillStyle = col.text; ctx.fillText(AN[c].name, P, y);
          ctx.fillStyle = col.line; ctx.fillRect(P + 280, y + 10, 560, 16);
          ctx.fillStyle = r.primary.includes(c) ? col.brand : '#9db8f5'; ctx.fillRect(P + 280, y + 10, (560 * Math.min(r.scores[c], MAX)) / MAX, 16);
          ctx.fillStyle = col.text; ctx.textAlign = 'right'; ctx.fillText(r.scores[c].toFixed(1), W - P, y);
        }
        y += 48;
      });
      y += 30;
      wrap('本测评基于 Schein 职业锚理论，仅作为自我认知参考，不构成录用、诊断或其他决策依据。', 22, col.muted);
      y += 50;
      return y;
    }
    const probe = document.createElement('canvas').getContext('2d');
    const H = layout(probe, false);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    layout(c.getContext('2d'), true);
    return c;
  }

  function saveImage(r) {
    const c = drawReport(r);
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `职业锚报告-${r.name.replace(/[\\/:*?"<>|]/g, '')}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      let box = $('#preview');
      if (!box) { box = document.createElement('div'); box.id = 'preview'; box.className = 'card noprint'; app.appendChild(box); }
      box.innerHTML = '<p class="muted">图片已生成。如果没有自动下载，请长按（电脑上右键）下面的图片，选择"保存图片"。</p><img alt="职业锚报告图片" style="width:100%;border:1px solid var(--line);border-radius:8px">';
      box.querySelector('img').src = url;
      box.scrollIntoView({ behavior: 'smooth' });
    }, 'image/png');
  }

  function renderResult(r) {
    const AN = S.cfg.anchors, order = S.cfg.order, MAX = S.cfg.top3Bonus ? 8.4 : 6;
    const sec = r.ranking.filter((c) => !r.primary.includes(c)).slice(0, 2);
    const box = (title, inner, cls = '') => `<div class="dbox ${cls}"><h3>${title}</h3>${inner}</div>`;
    view(`<section class="rhero"><p class="meta">${esc(fmt(r.submittedAt))} · 报告编号 ${esc(r.reportNo)}</p>
      <h1>${esc(r.name)} 的职业锚报告</h1>
      <p class="lead">${r.primary.length > 1 ? '你有两个并列突出的职业锚' : '你最突出的职业锚是'}</p>
      ${r.primary.map((c) => `<div class="pa"><span class="pcode" aria-hidden="true">${esc(c)}</span><div class="pa-t"><b>${esc(AN[c].name)}</b><span>${esc(AN[c].definition)}</span></div><span class="pscore" title="得分">${r.scores[c].toFixed(1)}<small>/${MAX}</small></span></div>`).join('')}</section>
      <section class="card"><h2>你的职业锚画像</h2><p class="muted">雷达图越向外，说明该动机对你越重要；亮色标记的是你的主职业锚。</p>
        <div class="profile">${radar(r.scores, order, r.primary)}
          <ol class="rank" aria-label="八个维度得分排名">${r.ranking.map((c, i) => `<li class="${r.primary.includes(c) ? 'main' : ''}"><span class="rn">${i + 1}</span><span class="rname">${esc(AN[c].name)}</span><span class="rbar"><i style="width:${Math.min(r.scores[c], MAX) / MAX * 100}%"></i></span><span class="rval">${r.scores[c].toFixed(1)}</span></li>`).join('')}</ol></div>
        <p class="muted small">分数 = 该维度 5 题均分${S.cfg.top3Bonus ? '，你最认同的 3 句话所属维度各加 0.8 分' : ''}。</p></section>
      ${r.primary.map((c) => `<section class="card"><h2>${esc(AN[c].name)} <span class="en">${esc(AN[c].en)}</span></h2>
        <p class="motive"><b>核心动机</b>${esc(AN[c].motivation)}</p>
        <div class="dgrid">${box('典型优势', list(AN[c].strengths), 'good')}${box('潜在盲区', list(AN[c].blindspots), 'warn')}${box('适合的岗位与环境', list(AN[c].fit))}${box('发展建议', list(AN[c].advice))}</div>
        <p class="avoid"><b>不太适合：</b>${esc(AN[c].avoid.join('；'))}</p></section>`).join('')}
      <section class="card"><h2>次要职业锚</h2><div class="sgrid">${sec.map((c) => `<div class="sbox"><div class="sh"><b>${esc(AN[c].name)}</b><span>${r.scores[c].toFixed(1)}</span></div><p>${esc(AN[c].definition)}</p></div>`).join('')}</div></section>
      <p class="muted small card">本测评基于 Schein 职业锚理论，仅作为自我认知参考，不构成录用、诊断或其他决策依据。</p>
      <div class="row noprint"><button id="save">保存为图片</button><button class="ghost" id="print">打印 / 保存为 PDF</button><button class="ghost" id="home">我的记录</button><button class="ghost" id="out">退出</button></div>`);
    $('#print').addEventListener('click', () => window.print());
    $('#save').addEventListener('click', () => saveImage(r));
    $('#home').addEventListener('click', async () => { S.attempts = (await api('GET', '/api/me')).attempts; renderHome(); });
    $('#out').addEventListener('click', logout);
  }

  // ---------- 启动 ----------
  async function render() {
    if (!S.token) return renderEnter();
    try {
      const me = await api('GET', '/api/me'); S.name = me.name; S.attempts = me.attempts;
      await afterLogin();
    } catch (e) { setToken(null); renderEnter(); }
  }
  render();
})();
