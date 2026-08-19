# podcast-to-essay · Code Wiki

> 本仓库是一套**播客/短视频转录工作流**的知识库文档。
> 本目录（ `wiki/` ）是由代码分析自动生成的**结构化技术文档**，覆盖架构、模块职责、关键函数、依赖关系与运行方式。

---

## 这个仓库是什么

`podcast-to-essay` **自身不含 ASR（语音识别）实现**。它是一个**编排层 + 数据层 + 文档层**：

- **编排层**：`raw/<slug>/transcribe.sh` 调用外部 ASR 引擎，把音频切成小块、逐块识别、再合并。
- **数据层**：`raw/<slug>/` 存放 ASR 原始产出（带时间戳），`cleaned/<slug>.md` 存放标准化转录稿（无时间戳、段落呈现）。
- **文档层**：`README.md`（项目定位）、`INDEX.md`（期次登记）、`STYLE_NOTES.md`（风格学习笔记）。

真正的语音识别引擎在**外部 Claude skill**：

```
~/.claude/skills/asr-transcript-refinement/scripts/
```

仓库通过 `transcribe.sh` 里硬编码的绝对路径引用它（见 [06-依赖与运行](06-dependencies-and-running.md)）。

---

## 一句话数据流

```
音频 source.mp3
   │  transcribe.sh (ffmpeg 切块 + 调外部 ASR + merge)
   ▼
raw/<slug>/asr_raw.txt  +  asr_raw.srt   （带时间戳，ASR 原始）
   │  LLM cleanup pass（删时间戳 / 合段落 / 替换说话人）
   ▼
cleaned/<slug>.md                         （纯净段落流，对外交付物）
```

（原 `rewrite` / `published` 步骤已在 2026-06-24 删除——**写稿不归本项目**。）

---

## 文档索引

| 文件 | 内容 |
|------|------|
| [01-architecture.md](01-architecture.md) | 整体架构、系统上下文、后端切换逻辑、数据流图 |
| [02-directory-structure.md](02-directory-structure.md) | 目录布局、文件清单与统计、slug 命名、已知结构不一致 |
| [03-module-orchestration.md](03-module-orchestration.md) | 仓库内 `transcribe.sh` 编排脚本逐段解析 |
| [04-module-asr-engine.md](04-module-asr-engine.md) | 外部 ASR 引擎各脚本/函数说明（pipeline/split/transcribe_stepfun/merge/verify/cleanup/setup/ingest-prompt） |
| [05-data-formats.md](05-data-formats.md) | `asr_raw.txt` / `asr_raw.srt` / `cleaned/*.md` 格式与示例 |
| [06-dependencies-and-running.md](06-dependencies-and-running.md) | 依赖关系、环境前置、新一期运行步骤、已知接口漂移 |
| [07-conventions.md](07-conventions.md) | 转录标准、INDEX / STYLE_NOTES 约定 |

---

## 快速事实卡

| 项 | 值 |
|----|----|
| 项目定位 | 只做清晰干净的转录稿，写稿交给用户 |
| 默认 ASR 后端（引擎） | 本地 `Fun-ASR-Nano GGUF`（0 成本，~9x RT） |
| 本仓库实际使用的后端 | **云端 Stepfun `stepaudio-2.5-asr`**（0.15 元/小时，~30x RT）—— `transcribe.sh` 硬编码调用 |
| 必需环境变量 | `STEP_API_KEY`（Stepfun 密钥） |
| 必需系统工具 | `ffmpeg`、`python3` + `requests` |
| 对外交付物 | `cleaned/<slug>.md` |
| 当前已转录期次 | 2（E31 梦妮 / 朱雪怡抖音） |
