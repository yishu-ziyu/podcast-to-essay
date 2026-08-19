# 02 · 目录结构与文件清单

## 2.1 顶层布局

```
podcast-to-essay/
├── README.md              # 项目定位 + 转录稿标准 + 目录约定
├── INDEX.md               # 所有期次登记表（slug/标题/时长/raw/cleaned/备注）
├── STYLE_NOTES.md         # 风格学习笔记（只记点过的风格特征，不抽象规则）
├── wiki/                  # 本 Code Wiki（本文档所在目录）
├── raw/                   # ASR 原始产出（每期一子目录）
│   └── <slug>/
│       ├── source.<mp3|wav>     # 原始音频（命名依实际，e31 为 source.mp3）
│       ├── transcribe.sh        # 本期编排脚本（e31 有；zhuxueyi 无）
│       ├── chunks/              # ffmpeg 切块（可选，保留供复现）
│       │   ├── chunk_NNN.mp3
│       │   ├── chunk_NNN.srt
│       │   └── chunk_NNN.txt
│       ├── asr_raw.txt          # ASR 原文（带时间戳）← merge.py 产出
│       ├── asr_raw.srt          # ASR 字幕版
│       └── asr_raw/             # 约定中的目录，当前为空（见 §2.4）
└── cleaned/               # 标准化转录稿（每期一文件，对外交付物）
    └── <slug>.md
```

## 2.2 文件清单与统计（实测）

### `raw/2026-06-24-e31-cooling-earth/`（梦妮·碳基生物生存指南，82:38）

| 类型 | 数量 | 说明 |
|------|------|------|
| `.sh` | 1 | `transcribe.sh` |
| `.txt` | 2 | `asr_raw.txt`（83.6 KB）+ `chunks/chunk_NNN.txt` ×28 |
| `.srt` | 1 | `asr_raw.srt`（88.8 KB）+ `chunks/chunk_NNN.srt` ×28 |
| `.mp3` | 28 | `chunks/chunk_NNN.mp3`（每片 ≈1.37 MB，末片 `chunk_027` ≈768 KB） |
| `asr_raw/` | 空目录 | 已创建但无文件 |

- `chunks/` 子目录：**28 个 chunk**，命名 `chunk_%03d`（零填充 3 位）：`chunk_000` … `chunk_027`，每片三件套齐全（84 文件）。

### `raw/2026-06-24-zhuxueyi-observation/`（朱雪怡抖音，02:05）

| 类型 | 数量 | 说明 |
|------|------|------|
| `.mp3` | 1 | `chunk_000.mp3`（2.88 MB） |
| `.srt` | 1 | `chunk_000.srt`（3.47 KB） |
| `.txt` | 1 | `chunk_000.txt`（3.26 KB） |
| `cleaned/` | 1 | `cleaned/2026-06-24-zhuxueyi-observation.md`（4.28 KB，带时间戳的中间稿） |

- ⚠️ **结构不一致**：此期无顶层 `asr_raw.*`、无 `chunks/` 子目录，而是直接在期目录下放 `chunk_000.*`，并自带一个 `cleaned/` 子目录（含带时间戳的半标准化稿）。

### `cleaned/`（顶层，对外交付物）

| 文件 | 大小 |
|------|------|
| `2026-06-24-e31-cooling-earth.md` | 67.7 KB |
| `2026-06-24-zhuxueyi-observation.md` | 2.5 KB |

- chunk 总数：e31 = **28** 段，zhuxueyi = **1** 段，合计 **29** 段 ASR 切片。

## 2.3 slug 命名约定

格式：`YYYY-MM-DD-节目名-主题`（小写连字符），例如：

- `2026-06-24-e31-cooling-earth`
- `2026-06-24-zhuxueyi-observation`

对应产物：`raw/<slug>/` 与 `cleaned/<slug>.md`。

## 2.4 已知结构不一致（写稿/复现时需注意）

1. **`asr_raw/` 目录为空**：`transcribe.sh` 第 25 行 `mkdir -p chunks asr_raw` 创建了该目录，但 e31 的 ASR 原文实际落在 `asr_raw.txt` / `asr_raw.srt`，`asr_raw/` 始终为空。README 目录约定需与实际对齐。
2. **zhuxueyi 非标准结构**：没有顶层 `asr_raw.*` 与 `chunks/` 子目录；且 `raw/.../cleaned/` 内有一份**带时间戳 + H2 小节**的中间稿，违反"无时间戳 / 无小标题"标准。仅顶层 `cleaned/<slug>.md` 符合标准。建议以 **e31 为规范结构**，zhuxueyi 视为早期/非标准样例。
3. **INDEX.md 段数备注（已核实，非不一致）**：e31 备注"604 段"指 `asr_raw.txt` 的 **ASR 句段数**（即行数，已通过 `merge.py` 复现验证 = 604 blocks / 604 行），与磁盘 **28 个音频 chunk** 单位不同，并不冲突。zhuxueyi 备注"28 段"同理为其 ASR 句段数（该期仅 1 个 chunk）。登记口径："`N 段`"= ASR 句段数，非音频切块数。
