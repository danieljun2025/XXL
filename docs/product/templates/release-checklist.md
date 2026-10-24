# 发布清单（复制到 PR 描述或发布 Issue）

版本：vX.Y.Z　日期：

## 合并前
- [ ] CI 全绿（测试 + 静态备用版是最新生成的）
- [ ] DoD 全部勾选（见 05-process.md）
- [ ] 数据库改动向前兼容（只加表/列）
- [ ] 新功能有开关，默认值已确认
- [ ] 回退方式已写
- [ ] 不在晚 7–10 点高峰发布

## 合并后
- [ ] Render 状态为 Live（约 2–5 分钟）
- [ ] `npm run smoke -- https://anchor.matchgamers.com` 通过
- [ ] 手动：打开首页、后台、报表、（如改动）兑换码/团队页
- [ ] CHANGELOG：Unreleased → 版本号与日期
- [ ] 打标签 `vX.Y.Z`，创建 GitHub Release
- [ ] 关闭相关 Issue，更新路线图

## 如果出问题
1. 先用开关关掉新功能
2. 不行就 Render 回退到上一个成功部署
3. 仍不行：revert PR；必要时从快照恢复
