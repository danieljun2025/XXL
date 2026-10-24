# 路线图

按 **Now / Next / Later** 管理，不承诺具体日期，只承诺顺序和退出标准。每周一更新。
更新时间：2026-10-24。

## Now（本周）：把「可以放心开卖」做完
目标：满足闸门，上线首批商品。

| 顺序 | 事项 | Issue | 退出标准 |
|---|---|---|---|
| 0 | 合并「团队码 + 产品管理体系」（PR #11） | [#11](https://github.com/danieljun2025/XXL/pull/11) | CI 通过、发布清单走完、部署后冒烟通过 |
| 1 | 备份：确认自动快照 + 下载数据库备份 + 恢复演练 | [#14](https://github.com/danieljun2025/XXL/issues/14) | Disks 页面出现自动快照；后台可下载备份并演练恢复（已在测试里覆盖） |
| 2 | 隐私说明页与删除流程 | [#12](https://github.com/danieljun2025/XXL/issues/12) | 页面上线，表单与同意页有链接 |
| 3 | 服务说明与退款规则 | [#13](https://github.com/danieljun2025/XXL/issues/13) | 页面上线，文案与商品描述一致 |
| 4 | 启用兑换码：清单与首批码 | [#15](https://github.com/danieljun2025/XXL/issues/15) | `REQUIRE_CODE=1`，完整验证通过，可一键回退 |
| 5 | 闲鱼上架包（草稿见 [launch/xianyu-listing-pack.md](launch/xianyu-listing-pack.md)） | [#16](https://github.com/danieljun2025/XXL/issues/16) | 三条商品文案、自动回复、主图就绪并上架 |

WIP 限制 2：同时只推进两项，其余排队。

## Next（接下来 1–2 个月）：跑起来、看数据、能交付
| 事项 | Issue | 目的 |
|---|---|---|
| 健康检查、冒烟与监控 | [#17](https://github.com/danieljun2025/XXL/issues/17) | 挂了能第一时间知道 |
| 卡密导出（闲鱼自动发货） | [#19](https://github.com/danieljun2025/XXL/issues/19) | 降低发码的人工成本 |
| 转化漏斗埋点 | [#18](https://github.com/danieljun2025/XXL/issues/18) | 知道用户在哪里流失 |
| 解读版交付流程 | [#20](https://github.com/danieljun2025/XXL/issues/20) | 把利润来源标准化 |
| 小红书渠道（作战手册见 [launch/xiaohongshu-playbook.md](launch/xiaohongshu-playbook.md)） | [#29](https://github.com/danieljun2025/XXL/issues/29) | 获客与信任，导向闲鱼成交 |
| 渠道归因（渠道码 / 来源参数） | [#30](https://github.com/danieljun2025/XXL/issues/30) | 知道哪个渠道带来完成的测试 |
| 团队版定价与交付 SOP | [#21](https://github.com/danieljun2025/XXL/issues/21) | 让已开发的团队功能能卖出去 |

## Later（观察与储备）
| 事项 | Issue | 触发条件 |
|---|---|---|
| 每日异地备份 | [#23](https://github.com/danieljun2025/XXL/issues/23) | 订单数据积累到有价值，或出现第一次备份事故 |
| 预发布环境 | [#22](https://github.com/danieljun2025/XXL/issues/22) | 开始有数据库迁移风险时 |
| PDF 与分享卡片 | [#24](https://github.com/danieljun2025/XXL/issues/24) | 买家多次提到想要 PDF/想分享 |
| 题目评审与测评说明 | [#25](https://github.com/danieljun2025/XXL/issues/25) | 开始有口碑和重复购买，需要提升可信度 |
| 英文版 | [#26](https://github.com/danieljun2025/XXL/issues/26) | 至少 3 位买家明确提出需求 |

## 已完成（摘要，详见 CHANGELOG）
- 完整版与静态备用版、首页清单、站点整合（v1.0.0）
- 统计报表与可视化、答题者报告可视化（v1.1.0）
- 一次性码与通用码（v1.2.0，默认关闭）
- 团队码与分团队报告（PR #11，待发布）

## 本周回顾模板
- 上周完成：
- 数据（见 02-metrics.md 每周记录表）：
- 学到什么：
- 本周 Now 清单有无调整：
