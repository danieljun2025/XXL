'use strict';
// 生成纯静态版 career-anchor/index.html（无需后端，可直接放 GitHub Pages）。运行：npm run build:static
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const scoring = read('server/scoring.js').replace("'use strict';", '').replace(/module\.exports = .*;/, '');
const data = `const QUESTIONS = ${read('server/data/questions.json')};\nconst ANCHORS = ${read('server/data/anchors.json')};\n`;
const baseCss = read('public/style.css');
const dark = /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/.exec(baseCss)[1];
const css = baseCss.replace(/@media \(prefers-color-scheme:dark\)\{:root\{[^}]*\}\}/,
  `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark};color-scheme:dark}}\n:root[data-theme="dark"]{${dark};color-scheme:dark}`) + `
.banner{background:var(--sel);border-bottom:1px solid var(--line);padding:8px 16px;font-size:.88rem;text-align:center}`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>职业锚测试</title>
<style>
${css}
</style>
</head>
<body>
<div class="banner noprint">你的答题数据只保存在当前设备的浏览器中，不会上传到任何服务器。</div>
<main id="app" class="wrap" aria-live="polite"></main>
<script>
(function () {
${data}${scoring}
${read('tools/static-shim.js')}
})();
</script>
<script>
window.CA_STATIC = true;
${read('public/app.js')}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'career-anchor', 'index.html'), html);
console.log('已生成 career-anchor/index.html', Math.round(html.length / 1024) + ' KB');
