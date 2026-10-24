# 职业锚在线测试

基于 Schein 职业锚理论的 40 题测评。零依赖（需要 Node 22.5+，使用内置 `node:sqlite`）。

## 运行
```bash
ADMIN_PASSWORD=你的后台口令 PORT=3000 npm start
# 测试页  http://localhost:3000/
# 后台    http://localhost:3000/admin.html
npm test
```
- 数据库默认 `data/career-anchor.db`（SQLite，可用 `DB_PATH` 修改）。**备份：定时拷贝该文件**（WAL 模式下建议先用 `sqlite3 db ".backup file"`）。
- 放在反向代理（Nginx/Caddy）后请设 `TRUST_PROXY=1` 并启用 HTTPS。
- 未设置 `ADMIN_PASSWORD` 时后台关闭。

## 机制
- 身份：姓名 + 邮箱 + 自设查看密钥（scrypt 加盐哈希）。回访需「邮箱 + 密钥」；连续错 5 次锁 15 分钟；忘记密钥由后台重置。
- 每次作答题序随机（种子入库），每题自动保存草稿，可断点续答；计分在服务端完成。
- 题目与解读在 `server/data/questions.json`、`anchors.json`，参数在 `config.json`（`top3Bonus`、`pageSize` 等）。
- 纯静态版（GitHub Pages）见 `career-anchor/`，由 `npm run build:static` 生成；首页是项目清单（职业锚测试链接到 anchor.matchgamers.com 的完整版），消消乐在 `game/xxl/`，`career-anchor/` 为不联网的静态备用版。

## 已知取舍
- 先注册某邮箱者先占有它（无邮件验证）；被他人占用时由管理员重置/删除。
- 会话与限速为单进程实现；数百并发以上需多实例与共享限速。

- 兑换码：设置环境变量 `REQUIRE_CODE=1` 后，开始新测试需要一次性兑换码，后台「兑换码管理」生成与作废，详见 `DEPLOY.md`。
