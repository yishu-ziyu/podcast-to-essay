# podcast-to-essay

> 奕枢的播客转录工作流
> 启动：2026-06-24 ｜ 2026-08-20：产品流程扩展为“素材 → 初稿 → 文章”

## 定位

**把音频或视频保存、转录，再整理成一篇可核对的文章。**

每条播客 / 短视频 / 长音频进入后，原始素材和 ASR 初稿保存在 `raw/<slug>/`，通过结构校验的 AI 整理稿落在 `cleaned/<slug>.md`。工作台支持音视频文件以及 B站、抖音、播客和媒体直链。

## 文章标准

- **忠于原稿**：不虚构事实、日期、任职时长或因果关系
- **可读结构**：自然段与二级标题组织内容，不把逐字稿直接拼接成文章
- **无 ASR 痕迹**：不含时间戳或 `Speaker 0` 等内部标签
- **可追溯**：保留原始素材、初稿、分段稿以及生成模型元数据
- **失败不伪装成功**：模型不可用或结构校验失败时，不产生新的 `cleaned/<slug>.md`

## 目录约定

```
podcast-to-essay/
├── README.md              # 本文件
├── INDEX.md               # 所有期次登记表 + 状态
├── STYLE_NOTES.md         # 风格学习笔记（仅记录你点过的风格特征，不展开成规则）
├── raw/                   # ASR 原始产出（每期一子目录）
│   └── <slug>/
│       ├── source.<wav|mp3|m4a>   # 原始音频
│       ├── chunks/                # ffmpeg 切块（可选，保留供复现）
│       ├── asr_raw.txt            # ASR 原文（带时间戳）
│       └── asr_raw.srt            # ASR 字幕版
└── cleaned/               # 通过校验的文章（每期一文件）
    └── <slug>.md
```

**slug 命名**：`YYYY-MM-DD-节目名-主题`，如 `2026-06-24-e31-cooling-earth.md`

## 工作流（每期 3 步）

1. **raw** — 音频 → Stepfun ASR → 带时间戳原文（落 `raw/<slug>/asr_raw.txt`）
2. **transcribed** — Stepfun ASR 生成初稿与约 3 分钟粒度的分段稿
3. **cleaned** — `step-3.7-flash` 整理成文并通过结构校验（落 `cleaned/<slug>.md`）

## 资产复用

- **ASR**：`asr-transcript-refinement` skill（v4.1+）
- **Stepfun 默认**（用户偏好）：`stepaudio-2.5-asr`，0.15 元/小时，30x RT
- **文章整理**：Step Plan `step-3.7-flash`
- **本地 fallback**：`Fun-ASR-Nano GGUF`，~9x RT，0 成本

## 当前进度

- 2026-06-24：项目脚手架重写
- E31（梦妮·碳基生物生存指南·82 分钟）转录完成 + cleaned 标准化
- 朱雪怡抖音短视频 2 分钟 转录完成 + cleaned 标准化

## Git

仓库：[yishu-ziyu/podcast-to-essay](https://github.com/yishu-ziyu/podcast-to-essay)

音轨、切块、`.env` 不入库。克隆后把音频放到 `raw/<slug>/source.*` 再跑转录。
