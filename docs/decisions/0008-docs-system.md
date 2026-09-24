# 0008 文档体系：渐进披露 + 每个领域一份权威文档

- 日期：2026-09-25
- 状态：采用

## 背景
`wiki/` 8 页描述的是 8 月的命令行流程（`transcribe.sh` 调外部 skill），与现在的网页应用不符；`README.md`、`web/README.md` 也已过时。过时文档比没有文档更误导。

## 决定
- `README.md` 给人，`AGENTS.md` 给 Agent（`CLAUDE.md` 引用它）。
- `docs/README.md` 是目录；架构、接口、数据各一份权威文档，决策、问题清单、测试记录各有位置；文档保持短小，用链接展开（参考宝玉的做法）。
- 行为或契约变化时，同一个提交里更新对应文档。
- 删除 `wiki/`、`INDEX.md`、`web/README.md`（Git 历史可找回）。`deploy/` 保持原位。

## 放弃的选项
- 按新架构重写 wiki 8 页：篇幅大、维护成本高。
- 只要 README + AGENTS + backlog：新会话的 Agent 需要自己读代码摸架构。

## 后果
文档少而准；代价是每次改动要顺手更新文档，由 AGENTS.md 约束。
