# 架构

> 权威范围：模块分工与任务流水线。接口细节见 [api.md](api.md)，磁盘文件见 [data.md](data.md)。

## 一条素材的路径

```
链接 / 本地文件
   │  ingest 任务：识别链接 → yt-dlp 下载 → 抽音轨        （本地文件直接上传，无任务）
   ▼
raw/<slug>/source.*  +  source-meta.json
   │  transcription 任务：ffmpeg 切 3 分钟块 → StepFun ASR 逐块识别 → 合并
   ▼
raw/<slug>/asr_raw.txt（初稿） + asr_raw.srt（分段稿）
   │  article 任务：step-3.7-flash 整理 → 结构校验，通过才写入
   ▼
cleaned/<slug>.md（文章） + raw/<slug>/article-meta.json（模型、段落映射）
```

三步都由用户在界面上手动开始。

## 服务端（`web/server/`，无第三方依赖）

| 层 | 文件 | 职责 |
|---|---|---|
| 入口 | `index.mjs` → `app.mjs` | 组装各层；读取仓库根 `.env.local`（本地）或环境变量；静态托管 `dist/` |
| 路由 | `routes/*.mjs` | health、auth、episodes、jobs；只做参数检查与权限，业务交给下层 |
| 任务 | `services/job-runner.mjs` | 任务排队、状态流转、SSE 推送、服务重启后标记 `interrupted` 并可继续 |
| 流水线 | `services/pipeline.mjs` | 三种任务的具体执行：ingest / transcription / article |
| 导入 | `services/media-ingest.mjs` + `domain/media-url.mjs` | 链接分类（B 站 / 抖音 / 直链 / 网页 / 不支持）与下载 |
| 转录 | `transcribe.mjs`（由 `raw/<slug>/transcribe.sh` 启动） | 切块、逐块识别（网络与服务端错误每块重试 2 次）、已完成的块直接复用 |
| 成文 | `article.mjs` | 调模型（推理过程计入输出上限，`max_tokens` 100k）、拆分单换行段落、校验结构；逐字稿按块标【段N】，模型在每段开头标 `{{N-M}}`，换算成段落映射后删掉标记（[0009](decisions/0009-chunk-tag-map.md)） |
| 存储 | `storage/*.mjs` | 条目、任务、游客额度的读写 |
| 错误 | `domain/errors.mjs` | 统一错误码与用户可见文案，每个失败带 `diagnosticId` |

任务状态：`queued → running ⇄ paused → succeeded | failed | cancelled`；服务重启时未完成的任务变 `interrupted`，可继续。

## 访问控制

- 设置了 `ACCESS_PASSWORD`：登录的是所有者，其余是游客；未设置（本地）所有人都是所有者。
- 所有者会话存在内存里，**服务重启后需要重新登录**。
- 游客按「IP + cookie」计每日额度（默认导入 5 / 转录 3 / 整理 3，`GUEST_*_PER_DAY` 可调），只能看到自己建的条目（`owner.json`）。

## 前端（`web/src/`）

| 文件 | 界面 |
|---|---|
| `App.tsx` | 顶栏、资料库浮层、登录与删除确认、提示条 |
| `components/Workbench.tsx` | 首页输入卡与最近文章；条目工作台（命名、转录进度、整理） |
| `components/TranscriptViewer.tsx` | 阅读器：文章 / 初稿 / 分段稿 / 素材，核对双栏 |
| `components/*` 其余 | 资料库列表、最近文章卡、确认框、可编辑标题 |
| `api.ts` / `lib.ts` | 接口封装；文章分段（须与服务端 `articleStructure()` 一致）、SRT 解析等 |

## 外部依赖

- StepFun：`STEP_API_KEY`；识别模型 `STEP_ASR_MODEL`（默认 `stepaudio-2.5-asr`），整理模型 `STEP_ARTICLE_MODEL`（默认 `step-3.7-flash`）
- `ffmpeg`；`yt-dlp`（镜像内用 `web/ytdlp-assets/` 里的独立二进制，见 [decisions/](decisions/README.md) 与 `web/Dockerfile`）
