# 接口

> 权威范围：HTTP 路由、权限、错误格式。前端封装在 `web/src/api.ts`，实现在 `web/server/routes/`。

所有路径以 `/api` 开头，前端用相对路径 `api/...`，所以可以挂在反向代理的子路径下（线上是 `/lcw/`）。

## 会话

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 当前身份（`owner`）、游客剩余额度、整理模型 |
| GET | `/health/live` · `/health/ready` | 存活 / 就绪（数据目录、磁盘余量、yt-dlp、ffmpeg、StepFun 密钥），容器健康检查用后者 |
| POST | `/login` · `/logout` | `{ password }` 登录为所有者（cookie `p2e_session`） |

## 条目

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/episodes` | 当前身份能看到的全部条目及状态 |
| POST | `/episodes` | `{ slug }` 新建空条目（本地文件上传前用）；扣导入额度 |
| PATCH | `/episodes/:slug` | `{ title }` 改标题 |
| DELETE | `/episodes/:slug` | 仅所有者；删除 `raw/<slug>/` 与 `cleaned/<slug>.md` |
| POST | `/episodes/:slug/audio` | 上传原始字节；头 `x-filename: source.<ext>`，原名放 `x-original-name`（URL 编码）。转录进行中返回 409；替换音轨会清掉旧初稿 |
| GET | `/episodes/:slug/transcript?type=raw\|srt\|cleaned` | 读初稿 / 分段稿 / 文章原文 |
| POST | `/episodes/:slug/transcribe` | 开始转录，返回任务 |
| POST | `/episodes/:slug/transcription/pause` · `/resume` | 暂停 / 继续转录 |
| POST | `/episodes/:slug/clean` | 整理成文，返回任务；成功前不覆盖已有文章 |

## 任务

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/ingests` | `{ url, requestId }` 导入链接：先分类，不支持的直接 400；同一 `requestId` 幂等 |
| GET | `/jobs` · `/jobs/:id` | 任务列表 / 单个任务 |
| GET | `/jobs/:id/events` | SSE，每次状态变化推一条 `data: <job>` |
| POST | `/jobs/:id/continue` | 继续 `interrupted` 的任务 |

`POST /episodes/:slug/from-url` 是旧的导入入口，前端已不用，保留兼容。

## 错误

失败统一返回 `{ error: <用户可见文案>, failure: { code, userMessage, retryable, stage, diagnosticId } }`。
`diagnosticId` 同时写进服务端日志，用户报错时凭它查。额度用尽返回 429，状态冲突返回 409。
