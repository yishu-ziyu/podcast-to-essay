# 文档地图

每类信息只记在一个地方；文档保持短小，细节用链接展开。改了行为或契约，就在同一个提交里改对应文档。

## 系统是什么样

| 文档 | 回答什么 |
|---|---|
| [architecture.md](architecture.md) | 前端、服务端、任务流水线怎么分工，一条素材怎么变成文章 |
| [api.md](api.md) | 有哪些接口、谁能调、出错时返回什么 |
| [data.md](data.md) | 磁盘上每个文件是什么、谁写谁读、什么时候被清掉 |

## 为什么这样做

| 文档 | 回答什么 |
|---|---|
| [decisions/](decisions/README.md) | 做过的产品与技术决定、当时的理由、放弃的选项 |

## 接下来做什么

| 文档 | 回答什么 |
|---|---|
| [backlog.md](backlog.md) | 使用中发现的问题、已知缺口、待办，按优先级 |
| [evals/](evals/README.md) | 验收契约，以及每次真实链接端到端测试的记录 |

## 线上

| 文档 | 回答什么 |
|---|---|
| [../deploy/REDEPLOY.md](../deploy/REDEPLOY.md) | 线上链路、服务器状态、部署步骤 |
| [../deploy/BACKUP.md](../deploy/BACKUP.md) | 数据备份与恢复 |

## 什么记在哪

- 用产品时发现问题 → `backlog.md` 加一行
- 做了一个会影响以后的取舍 → `decisions/` 新增一篇，并在其 README 登记
- 动手做一件较大的事之前写验收契约，做完写端到端记录 → `evals/`
- 改了接口、数据文件、流水线 → 同步改 `api.md` / `data.md` / `architecture.md`
- 部署或服务器有变化 → `deploy/REDEPLOY.md`

写作风格的个人笔记在根目录 [STYLE_NOTES.md](../STYLE_NOTES.md)，不属于产品文档。
