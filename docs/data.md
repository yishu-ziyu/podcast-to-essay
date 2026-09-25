# 数据文件

> 权威范围：数据目录里每个文件的含义与生命周期。本地数据目录是仓库根；线上是容器里的 `/data`（Docker 卷 `web_data`）。

```
<数据目录>/
├── raw/<slug>/            一个条目
├── cleaned/<slug>.md      通过校验的文章
├── jobs/<id>.json         任务记录
├── quota.json             游客每日额度计数
└── .env.local             仅本地：密钥（不入库）
```

## `raw/<slug>/`

| 文件 | 谁写 | 内容 | 何时清掉 |
|---|---|---|---|
| `source.<ext>` | 上传 / ingest | 原始音轨或视频（不入库） | 更换音轨时 |
| `source-meta.json` | 上传 / ingest / 改名 | `url`、`title`、`originalName`、`duration`（`HH:MM:SS`，音频落盘后用 ffprobe 读取；读不到就不写），可选 `sourceSavedAt`。**标题和时长只从这里读** | 更换音轨时重写（保留标题，时长按新音频重读） |
| `owner.json` | 游客新建时 | 条目归属，用于游客隔离 | — |
| `transcribe.sh` | 新建时 | 启动 `web/transcribe.mjs` 的薄包装 | — |
| `chunks/chunk_NNN.mp3/.txt` | 转录 | 3 分钟切块与逐块结果；**存在即复用**（不入库） | 更换音轨时 |
| `asr_raw.txt` | 转录 | 初稿：`[HH:MM:SS] Speaker 0: 文本` 每块一行 | 更换音轨时 |
| `asr_raw.srt` | 转录 | 分段稿，每块一条（仅供定位核对，不是可发布字幕） | 更换音轨时 |
| `asr-meta.json` | 转录完成 | `{ model }` 这次用的识别模型（2026-09-25 起才有） | 更换音轨时 |
| `transcription-state.json` | 转录 | 最近一次转录的状态与错误（不入库） | 更换音轨时 |
| `article-meta.json` | 整理成功 | 整理模型、生成时间、段落数、`paraMap`（段落 → 秒区间，核对用；区间是整块的起止，精度约 3 分钟，见 [0009](decisions/0009-chunk-tag-map.md)） | 删除条目时 |

`sourceSavedAt` 之前的转录任务记录不再计入条目状态，避免旧音轨的失败带到新音轨。

## `cleaned/<slug>.md`

Markdown 文章：`##` / `###` 标题、自然段、`>` 引用。段落的切分规则由服务端 `articleStructure()` 和前端 `articleUnits()` 共同定义，两者必须一致，否则核对时段落映射会错位。

## slug

`YYYY-MM-DD-<来源片段>`，如 `2026-08-19-bv1darmbce4a`；只含 `[A-Za-z0-9._-]`。

## 入库规则

`raw/` 和 `cleaned/` 是用户数据。音轨、切块、状态文件被 `.gitignore` 排除；初稿、分段稿、元数据和文章是否提交由用户决定。
