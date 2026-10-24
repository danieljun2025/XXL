# 产品管理体系

这是「职业锚测试」的产品管理体系。目标：功能再多也不乱，每一次改动都能说清楚**为什么做、怎么验证、出了问题怎么退回**。体系按一个人运营、Claude 协助开发来设计，够用、可执行，不搞形式主义。

> 每次新会话开始，先读：`docs/PROJECT-NOTES.md`（现状）→ 本页（怎么做事）→ `03-roadmap.md`（做什么）。

## 一张图：一个需求怎么走完

```
想法 ──▶ 分诊 ──▶ 立项 ──▶ 开发 ──▶ 验证 ──▶ 发布 ──▶ 复盘
 │        │         │        │        │        │        │
 Issue   打标签    需求文档   分支+PR   CI+手测   合并+部署  看指标
(模板)  +RICE评分 (按级别)  (小步)   +验收标准  +冒烟    +更新文档
```

## 文档地图

| 文档 | 回答的问题 | 多久看/更新一次 |
|---|---|---|
| [01-strategy.md](01-strategy.md) | 我们为谁做、解决什么、不做什么 | 每季度 |
| [02-metrics.md](02-metrics.md) | 怎么衡量做得好不好，数据从哪来 | 每周看，每月校准 |
| [03-roadmap.md](03-roadmap.md) | 现在、接下来、以后做什么 | 每周 |
| [04-prioritization.md](04-prioritization.md) | 为什么先做这个 | 每次排期 |
| [05-process.md](05-process.md) | 怎么开发、发布、回退、运维 | 有变化时 |
| [06-risks-and-compliance.md](06-risks-and-compliance.md) | 有哪些风险和合规要求 | 每月 |
| [07-support-and-feedback.md](07-support-and-feedback.md) | 客户问题和反馈怎么处理、怎么进入产品 | 每周 |
| [launch/](launch/) | 上线材料：兑换码启用清单、**平台规则核查**、闲鱼上架包、小红书作战手册 | 上线/运营时 |
| [templates/](templates/) | 需求文档、决策记录、发布清单、复盘、实验模板 | 使用时 |
| [decisions/](decisions/) | 已做出的关键决策（ADR）和理由 | 有新决策时 |
| [specs/](specs/) | 已做功能的需求文档（含补写的） | 每个中大型需求一份 |
| [../../CHANGELOG.md](../../CHANGELOG.md) | 每个版本改了什么 | 每次发布 |

## GitHub 上的对应物

- **Issues = 待办池（Backlog）。** 用模板创建，打 `priority:`、`type:`、`area:` 标签。
- **Pull Request = 交付单。** 模板里有检查清单，CI 通过才合并。
- **CI（GitHub Actions）**：每个 PR 自动跑测试，并检查静态备用版是不是最新生成的。
- **`npm run smoke -- <网址>`**：发布后的冒烟检查。

## 三条总原则

1. **先有问题，再有功能。** 没有「谁遇到什么问题、怎么知道解决了」，就不立项。
2. **小步、可回退。** 新功能默认由配置开关控制，数据库只做向前兼容的改动，每次发布都能退回上一版。
3. **能写下来的，就不要靠记忆。** 决策写 ADR，发布写 CHANGELOG，现状写 PROJECT-NOTES。
