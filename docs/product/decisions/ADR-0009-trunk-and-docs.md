# ADR-0009：主干开发 + squash 合并，文档放在仓库里

- 状态：已采纳　日期：2026-10-24

## 决定
main 永远可发布；一个需求一个 PR，squash 合并；CHANGELOG、ADR、路线图和现状都放在仓库 docs 里。

## 后果
- 好处：历史干净，文档与代码同版本，新会话读文档即可接上。
- 代价：squash 后工作分支需要重置并 force-with-lease 推送。
