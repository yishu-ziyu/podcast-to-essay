# podcast-to-essay

> 奕枢的播客转录工作流
> 启动：2026-06-24 ｜ 2026-06-24 改方向：只做转录，不写稿

## 定位

**只做清晰干净的转录稿**。写稿的事交给用户自己。

每条播客 / 短视频 / 长音频进来后，产出一份"段落呈现、无时间戳、没错字、无小标题"的转录稿，落 `cleaned/` 顶层。写作用素材，不替代写作。工作台可投几乎任意音轨或视频文件，也可贴 B站 / 抖音 / 播客 / 直链。

## 转录稿标准（2026-06-24 用户定）

- **无错字**：100% 上下文确证才改错字，否则保留 ASR 原貌
- **无时间戳**：删除所有 `[00:00:10,480]` 类时间戳
- **段落呈现**：合并时间戳相邻的同说话人内容，按"说话人名：内容"分段
- **无小标题**：不写 H1/H2/H3/小节，纯净一段一段流
- **多人 → Speaker 标签**：Stepfun 单说话人输出，按人物实际身份替换（梦妮/朱雪怡/嘉宾名）

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
└── cleaned/               # 标准化转录稿（每期一文件）
    └── <slug>.md
```

**slug 命名**：`YYYY-MM-DD-节目名-主题`，如 `2026-06-24-e31-cooling-earth.md`

## 工作流（每期 3 步）

1. **raw** — 音频 → Stepfun ASR → 带时间戳原文（落 `raw/<slug>/asr_raw.txt`）
2. **cleaned** — LLM cleanup 去错字/去时间戳/分段（落 `cleaned/<slug>.md`）
3. ~~rewrite~~ ~~published~~ — 删除这两步，**写稿不归这**

## 资产复用

- **ASR**：`asr-transcript-refinement` skill（v4.1+）
- **Stepfun 默认**（用户偏好）：`stepaudio-2.5-asr`，0.15 元/小时，30x RT
- **本地 fallback**：`Fun-ASR-Nano GGUF`，~9x RT，0 成本

## 当前进度

- 2026-06-24：项目脚手架重写
- E31（梦妮·碳基生物生存指南·82 分钟）转录完成 + cleaned 标准化
- 朱雪怡抖音短视频 2 分钟 转录完成 + cleaned 标准化

## Git

仓库：[yishu-ziyu/podcast-to-essay](https://github.com/yishu-ziyu/podcast-to-essay)

音轨、切块、`.env` 不入库。克隆后把音频放到 `raw/<slug>/source.*` 再跑转录。
