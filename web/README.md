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
- **后端**：纯 Node `http`，无外部依赖，运行在 `:8787`，直接读写仓库的 `raw/<slug>/` 与 `cleaned/<slug>.md`，并调用外部 ASR 引擎 `~/.claude/skills/asr-transcript-refinement/`。
- **Electron**：`main.cjs` 负责拉起后端（dev 再拉起 vite），dev 加载 `:5173`，prod 加载 `:8787`（后端同时托管 `dist/`）。

## 数据流（对应原 CLI 流水线）

1. 新建期次 → `raw/<slug>/` 下生成 `transcribe.sh`（引擎路径已注入）。
2. 上传音频 → 保存为 `raw/<slug>/source.<ext>`。
3. 开始转录 → 后端 `spawn bash transcribe.sh`：ffmpeg 切块 → Stepfun ASR → merge，日志以 **SSE** 实时回传。
4. 查看转录稿 → `asr_raw.txt` / `asr_raw.srt` / `cleaned/<slug>.md` 三标签切换。
5. ✨ 清洗 → **混元 AI**（设置 `HUNYUAN_API_KEY` 时）自动修正错字 + 合并段落 + 保留说话人标签；无 Key 时自动降级为启发式清洗。

## 前置条件

- Node ≥ 18（开发用 v22）
- `ffmpeg`（在 PATH 中）
- `python3` + `requests`（ASR 引擎依赖）
- 环境变量 `STEP_API_KEY`（云端 Stepfun ASR）
- （可选）环境变量 `HUNYUAN_API_KEY` — **混元 AI 清洗**，不设则自动降级为离线启发式清洗
- 外部引擎：`~/.claude/skills/asr-transcript-refinement/`

### 获取混元 API Key（推荐，免费 100万 tokens）
1. 访问 [腾讯云控制台 → 混元大模型](https://console.cloud.tencent.com/hunyuan/settings) 开通服务
2. 在 [API 密钥管理](https://console.cloud.tencent.com/hunyuan/start) 创建 OpenAI 兼容 Key（以 `sk-` 开头）
3. `export HUNYUAN_API_KEY=sk-xxx` 后重启 dev server

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
| POST | `/api/episodes/:slug/audio` | 上传音频（原始字节，头 `x-filename`） |
| POST | `/api/episodes/:slug/transcribe` | 触发转录，SSE 流式返回日志 |
| GET | `/api/episodes/:slug/transcript?type=raw\|srt\|cleaned` | 读取转录稿 |
| POST | `/api/episodes/:slug/clean` | 清洗转录稿（?mode=ai\|heuristic，默认：有 Key 用混元 AI，否则启发式） |

## 与原项目的对应关系

- 原 `raw/<slug>/transcribe.sh`（每期一份）由本应用在建期次时按模板自动生成，并已固化修复过的 `merge.py` 位置参数调用。
- 转录产物、清洗稿与原有 `raw/`、`cleaned/` 目录完全一致，可与原 CLI 流程混用。
