# 部署说明

## A. 纯静态版（当前上线方式，GitHub Pages）
根目录的 `index.html` 是一个独立文件：只需输入名字即可答题，报告显示名字，可「保存为图片」或打印。
数据只存在答题者自己设备的浏览器里，不上传、没有后台。

1. 合并分支到主分支（`main`）。
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，Branch 选 `main` / `(root)`。
3. 根目录的 `CNAME` 文件决定自定义域名（当前为 `matchgamers.com`），按需修改并在域名解析处配置。
4. 原消消乐在 `/game/`。

修改题目或文案后，重新生成页面再提交：
```bash
npm run build:static   # 生成根目录 index.html
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
