# 决策记录（ADR）

记录「为什么这样做」。出现以下情况就写一条：换技术方案、改数据/权限/隐私模型、改定价或交付方式、引入第三方服务。用 [templates/adr.md](../templates/adr.md)，编号递增，不修改已采纳的旧决策，被取代时新写一条并标注。

| 编号 | 标题 | 状态 |
|---|---|---|
| [0001](ADR-0001-node-sqlite.md) | 后端用 Node + SQLite，部署到 Render | 已采纳 |
| [0002](ADR-0002-view-key.md) | 用「邮箱 + 查看密钥」，不发邮件 | 已采纳 |
| [0003](ADR-0003-original-questions.md) | 题目与解读全部原创 | 已采纳 |
| [0004](ADR-0004-server-side-scoring.md) | 计分在服务端，题目响应不含维度 | 已采纳 |
| [0005](ADR-0005-static-fallback.md) | 同时保留静态备用版 | 已采纳 |
| [0006](ADR-0006-flags-default-off.md) | 新能力默认关闭，用环境变量开关上线 | 已采纳 |
| [0007](ADR-0007-team-privacy.md) | 团队负责人默认只看汇总，3 人阈值，加入前知情同意 | 已采纳 |
| [0008](ADR-0008-admin-subpages.md) | 后台子页面复用管理员登录，直接访问被拒绝 | 已采纳 |
| [0009](ADR-0009-trunk-and-docs.md) | 主干开发 + squash 合并，文档放在仓库里 | 已采纳 |
