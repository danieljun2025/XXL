# 部署说明

## A. 纯静态版（当前上线方式，GitHub Pages）
`career-anchor/index.html` 是一个独立文件（访问路径：`/career-anchor/`）：只需输入名字即可答题，报告显示名字，可「保存为图片」或打印。
数据只存在答题者自己设备的浏览器里，不上传、没有后台。

1. 合并分支到主分支（`main`）。
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，Branch 选 `main` / `(root)`。
3. 根目录的 `CNAME` 文件决定自定义域名（当前为 `matchgamers.com`），按需修改并在域名解析处配置。
4. 网站首页 `/` 仍是原来的消消乐，职业锚测试在 `/career-anchor/`。

修改题目或文案后，重新生成页面再提交：
```bash
npm run build:static   # 生成 career-anchor/index.html
```

## B. 带后端的完整版（以后需要汇总全员结果时）
`server/` 是 Node + SQLite 服务（邮箱 + 查看密钥、后台、CSV 导出），已附 `Dockerfile`、`render.yaml`。

### Render
1. Render → New → Blueprint，选择本仓库，按 `render.yaml` 创建，在控制台填 `ADMIN_PASSWORD`。
2. 访问 `https://<服务名>.onrender.com/`，后台为 `/admin.html`。

### 自己的服务器
```bash
docker build -t career-anchor .
docker run -d --name ca --restart unless-stopped -p 3000:3000 \
  -v ca-data:/data -e ADMIN_PASSWORD=你的口令 career-anchor
```
前面放 Caddy/Nginx 做 HTTPS。数据库在 `/data/career-anchor.db`，备份用 `sqlite3 ... ".backup ..."`。

## 兑换码（卖测试服务时使用）
完整版支持一次性兑换码：每个码只能开始一次新的测试；已经开始的测试和历史结果不需要码。

1. 在 Render 服务页 → Environment 里添加环境变量 `REQUIRE_CODE` = `1`，保存后自动重启。（不设置时不要求兑换码，方便自己测试。）
2. 登录后台 → 「兑换码管理」→ 生成（可填备注，如订单号），复制后发给买家，可导出 CSV。
3. 买家在首次测试的表单里填写兑换码；输错或已被使用会提示"兑换码无效或已被使用"。
4. 买家填错了兑换码不会消耗任何码；连续输错过多会被临时限速。
5. 未使用的码可以在后台"作废"；已使用的码不能作废。

静态备用版（`/career-anchor/`）没有兑换码，也不要拿它卖。
