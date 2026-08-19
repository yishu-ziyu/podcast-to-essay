# Podcast → Essay · Web 工作台

把 `podcast-to-essay` 这个终端转录流水线包装成 **Web 客户端应用**：上传音频 → 查看转录稿 → 管理期次。用 **Electron** 封装，开发期可在普通浏览器中调试。

## 架构

```
podcast-to-essay/web/
├── server/index.mjs      # 零依赖 Node 后端（期次/上传/转录SSE/清洗）
├── src/                  # React + Vite 前端
├── electron/             # Electron 主进程（托管后端 + 可选 vite）
├── scripts/dev.mjs       # 开发启动器（并行拉起 vite + server）
└── vite.config.ts        # /api 代理到 :8787
```

- **前端**：React 18 + Vite + TypeScript，运行在 `:5173`。
- **后端**：纯 Node `http`，运行在 `:8787`，直接读写仓库的 `raw/<slug>/` 与 `cleaned/<slug>.md`，并直接调用 StepFun ASR。
- **Electron**：`main.cjs` 负责拉起后端（dev 再拉起 vite），dev 加载 `:5173`，prod 加载 `:8787`（后端同时托管 `dist/`）。

## 数据流（对应原 CLI 流水线）

1. 新建期次 → `raw/<slug>/` 下生成 `transcribe.sh`（引擎路径已注入）。
2. 上传音频 → 保存为 `raw/<slug>/source.<ext>`。
3. 开始转录 → 后端 `spawn bash transcribe.sh`：ffmpeg 切块 → Stepfun ASR → merge，日志以 **SSE** 实时回传。
4. 查看内容 → 文章 / 初稿 / 分段稿三种版本切换；分段稿是约 3 分钟一段的核对材料，不冒充可发布字幕。
5. 整理成文 → 通过 Step Plan 的 `step-3.7-flash` 将完整初稿改写为结构化文章。模型未配置、调用失败或结果未通过结构校验时不会写入 `cleaned/`，也不会把启发式结果标成文章。

## 前置条件

- Node ≥ 18（开发用 v22）
- `ffmpeg`（在 PATH 中）
- `yt-dlp` ≥ `2026.07.04`（用于 B站、抖音等链接；首次可执行 `pipx install yt-dlp`，已有旧版执行 `pipx upgrade yt-dlp`）
- Step Plan API Key：写入仓库根目录的 `.env.local`；同一个服务端密钥用于 `stepaudio-2.5-asr` 转录和 `step-3.7-flash` 文章整理，该文件已被 Git 忽略
- 可选覆盖：`STEP_API_BASE=https://api.stepfun.com/step_plan/v1`、`STEP_ARTICLE_MODEL=step-3.7-flash`

## 运行

### 浏览器开发模式（推荐先验证）
```bash
cd podcast-to-essay/web
npm install
npm run dev          # 并行启动 vite(:5173) + server(:8787)
# 打开 http://localhost:5173
```

### Electron 桌面模式
```bash
npm run build              # 构建前端到 dist/
npm run electron:dev       # dev：Electron 内加载 vite(:5173)
# 或
npm run electron:prod      # prod：构建后 Electron 内加载 :8787（含后端托管的 dist）
```

## API 速览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/episodes` | 列出所有期次及状态 |
| POST | `/api/episodes` | 新建期次 `{ slug }` |
| DELETE | `/api/episodes/:slug` | 删除期次（仅 raw 目录） |
| POST | `/api/episodes/:slug/audio` | 上传音轨/视频（原始字节；`x-filename` 只放 ASCII 的 `source.ext`，原名走 `x-original-name`） |
| POST | `/api/episodes/:slug/from-url` | `{ url }`，SSE 拉 B站/抖音/播客/直链音轨 |
| POST | `/api/episodes/:slug/transcribe` | 触发转录，SSE 流式返回日志 |
| GET | `/api/episodes/:slug/transcript?type=raw\|srt\|cleaned` | 读取转录稿 |
| POST | `/api/episodes/:slug/clean` | 使用 Step Plan 整理成文；成功前不覆盖已有文章，失败返回可见错误 |

## 与原项目的对应关系

- 原 `raw/<slug>/transcribe.sh`（每期一份）由本应用在建期次时按模板自动生成，并已固化修复过的 `merge.py` 位置参数调用。
- 转录产物与原有 `raw/` 目录兼容；文章落 `cleaned/<slug>.md`，生成模型和结构统计落 `raw/<slug>/article-meta.json`。
