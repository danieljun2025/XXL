# 部署说明

## Render（推荐）
1. 登录 Render → New → Blueprint，选择本仓库的 `claude/elegant-goldberg-v6iywx` 分支（合并后用主分支）。
2. 按 `render.yaml` 创建服务，在控制台填写 `ADMIN_PASSWORD`（后台口令）。
3. 部署完成后访问 `https://<服务名>.onrender.com/`，后台为 `/admin.html`。
4. 绑定域名：Settings → Custom Domains，按提示在域名解析处加 CNAME。

## 自己的服务器
```bash
docker build -t career-anchor .
docker run -d --name ca --restart unless-stopped -p 3000:3000 \
  -v ca-data:/data -e ADMIN_PASSWORD=你的口令 career-anchor
```
前面放 Caddy/Nginx 做 HTTPS（`TRUST_PROXY=1` 已在镜像内默认开启，只在反向代理后使用）。

## 备份
数据库在 `/data/career-anchor.db`：`sqlite3 /data/career-anchor.db ".backup '/backup/ca-$(date +%F).db'"`。
