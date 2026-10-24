# 部署说明

## A. 纯静态版（当前上线方式，GitHub Pages）
`career-anchor/index.html` 是一个独立文件（访问路径：`/career-anchor/`）：只需输入名字即可答题，报告显示名字，可「保存为图片」或打印。
数据只存在答题者自己设备的浏览器里，不上传、没有后台。

1. 合并分支到主分支（`main`）。
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，Branch 选 `main` / `(root)`。
3. 根目录的 `CNAME` 文件决定自定义域名（当前为 `matchgamers.com`），按需修改并在域名解析处配置。
4. 网站首页 `/` 是职业锚测试的介绍页，按钮指向 `anchor.matchgamers.com`；`/career-anchor/` 是静态备用版。

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

## 兑换码
完整版支持两种兑换码，开始一次新的测试时需要；已经开始的测试和历史结果不需要码。

1. 在 Render 服务页 → Environment 里添加环境变量 `REQUIRE_CODE` = `1`，保存后自动重启。（不设置时不要求兑换码，方便自己测试。）
2. 登录后台 → 「兑换码管理」生成：
   - **通用码（多人共用）**：一次分享活动发一个码，可设置「有效时长（小时）」和「最多使用人数」，两者可只设一个或都设；每人限用一次；可自定义码（如 `SHARE1024`），也可自动生成。活动延长时可点「设置有效期」，或随时「作废」。
   - **一次性码（逐个发放）**：每个码只能开始一次测试，适合逐单发放（如闲鱼订单），也可设置有效时长。
3. 买家/参与者在首次测试的表单里填写兑换码；输错不会消耗任何码，连续输错过多会被临时限速。
4. 后台可查看状态（可用/已用完/已过期/已作废）、使用人数、导出 CSV。

静态备用版（`/career-anchor/`）没有兑换码，也不要拿它卖。

## 团队版（卖给公司、班级、培训营）
1. 后台 →「团队管理」→ 创建团队，可同时生成**团队码**（通用码，可设有效时长和人数上限）。
2. 把**团队码**发给成员；把**团队报告码**（或带 `#报告码` 的链接）只发给团队负责人。报告码只显示一次，丢了可在团队管理页重新生成（旧码立即失效）。
3. 成员用团队码开始测试时会先看到"负责人能看到什么"的说明，同意后才开始。默认负责人只看汇总；如需让负责人看到成员姓名和主职业锚，在团队管理页开启（成员会被如实告知）。
4. 负责人在 `/team.html` 输入报告码查看团队汇总；完成人数不足 3 人时不显示汇总。
5. 管理员在「统计报表」里可按团队筛选；记录列表和 CSV 里有"团队"列；团队可「关闭」（不再接收新成员，负责人仍可看报告）。
6. 没有创建团队、也没有启用兑换码时，答题表单不会出现码输入框。
