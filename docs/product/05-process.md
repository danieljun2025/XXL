# 开发与发布流程

## 1. 需求分级（决定要写多少文档）

| 级别 | 例子 | 必须有 |
|---|---|---|
| **S 小** | 文案、样式、小 bug，< 0.5 天，不动数据 | Issue（可一句话）→ PR → CI |
| **M 中** | 新页面、新接口、报表改动 | Issue（用「功能需求」模板，含验收标准和指标）→ PR（填模板）→ 更新 CHANGELOG |
| **L 大** | 新能力、涉及个人信息/权限/数据库结构/收费 | 需求文档（`templates/prd.md`，放 `specs/`）+ 隐私检查 + 开关 + 回退方案；架构取舍写 ADR |

判断不了就按高一级处理。

## 2. 生命周期与出口标准

| 阶段 | 做什么 | 出口标准（Definition of Ready / Done） |
|---|---|---|
| 想法 | 开 Issue，写清问题和用户 | 有「谁、什么问题、怎么知道解决了」 |
| 分诊 | 打标签、RICE 评分、判断级别 | 有 `priority:`、`type:`、`area:`；写了 RICE |
| 立项 | M/L 写需求或验收标准 | **Ready**：验收标准可测试；风险和回退写了；依赖明确 |
| 开发 | 从最新 `main` 拉分支，小步提交 | 本地 `npm test` 通过 |
| 验证 | CI + 手测 + 截图 | **Done**：见下方 DoD |
| 发布 | 合并 → 自动部署 → 冒烟 | 发布清单走完 |
| 复盘 | 看指标，更新文档 | 在 Issue 里写结果；必要时开新 Issue |

### Definition of Done（合并前必须全部满足）
- [ ] 验收标准逐条验证（PR 里附截图或测试名）
- [ ] 自动测试已增加/更新，`npm test` 与 CI 通过
- [ ] 前端有改动时：桌面、手机、深色各看一眼；改了前端要重新生成静态备用版（`npm run build:static`）
- [ ] 数据库只做**向前兼容**的改动（只加表/加列，不删不改），旧版本代码能在新库上跑
- [ ] 涉及个人信息：隐私说明已同步，默认最小展示
- [ ] 新行为有**开关**或默认关闭；开关写进「配置清单」
- [ ] `CHANGELOG.md` 的 Unreleased 已更新；必要时更新 `docs/PROJECT-NOTES.md`
- [ ] 回退方式写在 PR 里

## 3. 分支与合并
- 主干开发：`main` 永远可发布。
- 一个需求一个分支一个 PR；PR 小而聚焦（建议 < 500 行变更）。
- 合并方式：**Squash merge**，标题用「动词 + 对象」（英文或中文均可），关联 Issue（`Closes #12`）。
- squash 合并后，旧工作分支历史与 `main` 对不上，重新开始时从最新 `main` 重置分支，推送用 `--force-with-lease`。
- 不在仓库里放口令、密钥、客户数据。

## 4. 发布
合并到 `main` 会触发 Render 自动部署（约 2–5 分钟，期间短暂不可用）。

**发布清单**（`templates/release-checklist.md` 可复制到 PR）：
1. 合并前：CI 绿；DoD 全勾；在非高峰时段发布（避开晚 7–10 点的闲鱼流量高峰）。
2. 合并后：等 Render 状态变为 Live。
3. 冒烟：`npm run smoke -- https://anchor.matchgamers.com` 通过；手动打开后台，看一眼报表和列表。
4. 更新 `CHANGELOG.md`（把 Unreleased 改成版本号和日期）、打 Git 标签 `vX.Y.Z`、在 GitHub 创建 Release。
5. 在 Issue 里关闭已完成项，更新路线图。

**版本号（SemVer）**：`主.次.修`。新增功能升「次」，修 bug 升「修」，不兼容的数据或接口变更升「主」。题库内容变更也要记入 CHANGELOG。

## 5. 回退与事故
**回退顺序（从快到慢）：**
1. **开关**：用环境变量关闭新功能（如删除 `REQUIRE_CODE`）。
2. **重新部署上一版**：Render 服务页 → Deploys → 选上一个成功的部署 → Rollback。
3. **回滚提交**：在 GitHub 上 revert 对应 PR，合并后自动部署。
4. **恢复数据**：从 Render 磁盘快照或最近一次 CSV 导出恢复（见运维手册）。

**事故处理**：先止血（开关/回滚）→ 再确认影响范围 → 如涉及用户数据，按 `06-risks-and-compliance.md` 通知 → 24 小时内写事故记录（`templates/retro.md`）→ 把改进项开成 Issue。

## 6. 配置开关清单
| 变量 | 默认 | 作用 | 回退 |
|---|---|---|---|
| `ADMIN_PASSWORD` | 无（后台关闭） | 管理后台口令 | 在 Render 里改 |
| `REQUIRE_CODE` | 关 | `1` 时开始新测试需要兑换码 | 删除或改 `0` |
| `TRUST_PROXY` | 镜像内为 `1` | 反向代理后取真实 IP | — |
| `DB_PATH` | `/data/career-anchor.db` | 数据库位置 | — |
| `teamMinGroup`（配置文件） | 3 | 团队汇总最少完成人数 | 改配置文件并发布 |

新增开关要同步更新此表。

## 7. 运维手册（摘要）
- **每周**：导出一次 CSV 存档；看 Render 状态；跑一次冒烟。
- **备份**：Render 磁盘快照 + 每周 CSV；数据库一致性备份命令 `sqlite3 /data/career-anchor.db ".backup '/backup/ca-$(date +%F).db'"`。恢复演练见 [#14](https://github.com/danieljun2025/XXL/issues/14)。
- **忘记密钥**：后台找到该用户 → 重置密钥。
- **删除个人数据**：后台删除该用户（会连带删除其测试记录）；30 天内处理。
- **暂停省钱**：Render → Settings → Suspend；先导出 CSV。
- **成本**：Render Starter + 1GB 磁盘约 7.25 美元/月（以官网为准）。

## 8. 和 Claude 协作的约定
- 开始前先读 `docs/PROJECT-NOTES.md` 和本目录 README；说明要做的 Issue 编号。
- 一次会话只做一个 Issue 的范围；新想法先开 Issue，不顺手加功能。
- 让 Claude 提 PR 之前，要求它：跑测试、列出验收标准的验证结果、写出回退方式。
- 每次会话结束时让 Claude 更新 CHANGELOG 和 PROJECT-NOTES。
- 合并到 `main` 前，你自己看一遍 PR 描述和截图，再说「合并」。

## 9. 节奏
| 频率 | 做什么 | 时长 |
|---|---|---|
| 每周一 | 看指标 → 看上周完成 → 排本周 Now（不超过 2 项） | 30 分钟 |
| 每次发布后 | 冒烟、更新文档、关闭 Issue | 15 分钟 |
| 每月 | 路线图复盘、指标目标校准、风险登记表检查 | 1 小时 |
| 每季度 | 复核战略、定价、是否开新方向 | 半天 |
