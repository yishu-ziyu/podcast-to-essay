# 04 · ASR 引擎模块（外部 skill）

> 位置：`~/.claude/skills/asr-transcript-refinement/scripts/`
> 本仓库通过 `transcribe.sh` 硬编码绝对路径引用其中的 `transcribe_stepfun.py` 与 `merge.py`。
> 这部分**不在本仓库内**，但属于系统关键依赖，故在此完整记录函数级细节。

## 4.0 调用关系总览

```
ingest-prompt.md ──(描述调用)──> pipeline.sh [STEP_ASR_BACKEND=stepfun]
                                     │
              ┌──────────────────────┴───────────────────────┐
        [nano 分支]                                     [stepfun 分支]
   transcribe_funasr.py                              split.sh
   (GGUF, 内置 VAD, 不切片)                          ├─ transcribe_stepfun.py
        │                                           └─ merge.py
        └─> source.srt / source.txt                    └─> merged/all.srt / all.txt
pipeline.sh ──(提示下一步)──> verify.sh <cleaned_transcript.md>
cleanup.sh  (独立工具，不被 pipeline 调用)
setup.sh    (独立安装，旧 PyTorch 路径，不被 pipeline 调用)
```

---

## 4.1 transcribe_stepfun.py — Stepfun 云端单段识别

**作用**：调用 Stepfun `stepaudio-2.5-asr` 云端 ASR（SSE 流式），把一段音频转成 `.srt` + `.txt`。接口与旧 `transcribe_chunk.py`（FunASR）一致，故 `merge.py` / `verify.sh` 无需改动即可复用。

**调用**：
```
python transcribe_stepfun.py <input.wav> <output_prefix>
# 产出 <output_prefix>.srt 和 <output_prefix>.txt
```

**常量**：
- `API_KEY = os.environ.get("STEP_API_KEY")`
- `URL = "https://api.stepfun.com/step_plan/v1/audio/asr/sse"`
- `MODEL = "stepaudio-2.5-asr"`
- `SENTINEL_END_RE = re.compile(r"[.!?。？！]")` — 句末标点，用于 SRT 级分段。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `fmt_ts` | `fmt_ts(sec: float) -> str` | SRT 时间戳格式化 `HH:MM:SS,mmm`（逗号分隔）。 |
| `transcribe` | `transcribe(audio_path: Path) -> list[tuple[int,int,str]]` | 读音频→base64→POST SSE；解析 `transcript.text.delta` / `.done` / `error` 事件；按句末标点 flush，返回 `(start_ms, end_ms, text)` 段列表。 |
| `main` | `main()` | 校验 `STEP_API_KEY` 与参数；解析输入输出路径；调用 `transcribe`；写出 `.srt`（序号+时间轴+文本）与 `.txt`（`[HH:MM:SS,mmm] Speaker 0: text` 格式，兼容 `merge.py`）。 |

**依赖**：`requests`、`STEP_API_KEY` 环境变量。音频格式自动从扩展名探测（wav/mp3/ogg/pcm，默认 wav）。

**错误处理**：HTTP 非 200 → 打印并 `sys.exit(1)`；API `error` 事件 → `sys.exit(1)`；缺 key / 参数不足 → `sys.exit(1)`。

---

## 4.2 merge.py — 多段合并 + 时间戳偏移

**作用**：把 `chunks/chunk_*.srt` + `.txt` 合并成一个文件，按前一 chunk 的最后结束时间做**时间戳偏移**，并重新编号 SRT 索引。

**调用（位置参数）**：
```
python merge.py <chunks_dir> <output_srt> <output_txt>
```

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `parse_srt_ts` | `parse_srt_ts(ts: str) -> float` | 解析 `HH:MM:SS,mmm` → 秒（float）。 |
| `format_srt_ts` | `format_srt_ts(sec: float) -> str` | 秒 → `HH:MM:SS,mmm`。 |
| `main` | `main()` | 按 `chunk_*.srt` 排序；逐块解析块（序号/时间轴/内容），对每段时间戳加 `offset`；同时读同名 `.txt` 按 `\[ts\] Speaker N: ...` 合并；`offset += 该块最大 end`；最后重编号 SRT 索引并写出。 |

**关键逻辑**：
- 偏移累加：`offset += chunk_max_end`，使后续 chunk 时间戳接续前一 chunk。
- `.txt` 行匹配：`^\[(\S+)\] (Speaker \d+: .*)$`，仅合并符合该格式的行。
- 输出 `.txt` 沿用 `[ts] Speaker N: text` 格式。

**依赖**：仅标准库 `re` / `sys` / `pathlib`，无外部包。

> ⚠️ 本仓库 `transcribe.sh` 以 `--input-dir chunks --output asr_raw.txt` 形式调用，与此位置参数签名**不匹配**（见 [06-依赖与运行 #4](06-dependencies-and-running.md) 接口漂移）。

---

## 4.3 split.sh — 长音频切片

**作用**：用 ffmpeg/ffprobe 把长音频切成 16 kHz 单声道 PCM16 WAV，供 Stepfun 逐块转写（绕开 base64 体积限制）。短于阈值则直接拷贝为单块、不切片。

**调用**：
```
split.sh <input_audio> [output_dir] [chunk_seconds=600]
# 注：本仓库 transcribe.sh 走的是自带 ffmpeg 切块（见 03 章），未调用 split.sh；
#     引擎 pipeline.sh 调 stepfun 时传 split.sh "$INPUT" "$CHUNKS_DIR" 180（3 分钟）
```

**关键逻辑**：
- `ffprobe` 取时长（取整秒）。
- 短音频（≤阈值）：`ffmpeg -y -i "$INPUT" -ac 1 -ar 16000 -acodec pcm_s16le "${OUT_DIR}/chunk_00.wav"`。
- 长音频：segment muxer 切片 `chunk_%02d.wav`（`-segment_time "$CHUNK_SEC" -reset_timestamps 1`）。
- 输出：`$OUT_DIR/chunk_NN.wav`（零填充两位）。

**依赖**：`ffmpeg`、`ffprobe`。ffmpeg 报错被 `2>/dev/null` 吞掉，依赖 `set -e` 在非零退出时中止。

---

## 4.4 pipeline.sh — 一键入口（引擎侧）

**作用**：选后端并串起整个转写，产出原始 SRT/TXT，并打印后续 cleanup 指示。

**调用**：
```
pipeline.sh <input_audio> [output_dir]
# 显式云端：STEP_ASR_BACKEND=stepfun bash pipeline.sh <audio>
```

**关键逻辑**：
- 解析 `SCRIPT_DIR` / `SKILL_ROOT` / `NANO_DIR="${NANO_DIR:-$HOME/Downloads/项目与数据/agent_audio_funasr}"`。
- 后端选择：`STEP_ASR_BACKEND=stepfun` → stepfun 分支；否则 **nano 默认**，且校验 `$NANO_DIR/llama-funasr-nano` 可执行。
- nano 分支：`python3 "$NANO_DIR/transcribe_funasr.py" "$INPUT" "$PREFIX.txt"`（内置 VAD，不切片）→ `source.srt` / `source.txt`。
- stepfun 分支：`split.sh` 切块 → 逐块 `transcribe_stepfun.py` → `merge.py` → `merged/all.srt` + `merged/all.txt`。
- 末尾提示下一步跑 `verify.sh <cleaned_transcript.md>`。

**依赖**：`python3`；nano 分支需 GGUF 二进制 + 模型；stepfun 分支需 `split.sh` + `STEP_ASR_BACKEND` + `STEP_API_KEY`。

---

## 4.5 verify.sh — cleanup 后坏模式校验

**作用**：LLM cleanup **之后**检查最终 `transcript.md` 是否残留已知坏模式（ASR 标签泄漏 / 未清理的说话人 / 时间戳前缀 / 重复字符噪声）。发现则非零退出。

**调用**：`verify.sh <transcript.md>`（文件缺失 `exit 2`）。

**校验范围**：仅第一个 `## ` 之前的**正文区**（无标题则整文件）。逐条匹配 `PATTERNS` 数组并报告行号，命中 `exit 1`，否则 `exit 0`。

**坏模式清单（精确 regex）**：
- FunASR 元数据标签泄漏：`<\|zh\|>`、`<\|NEUTRAL\|>`、`<\|Speech\|>`、`<\|withitn\|>`、`<\|HAPPY\|>`、`<\|SAD\|>`、`<\|ANGRY\|>`、`<\|SURPRISED\|>`
- 未清理说话人：`^Speaker [0-9]+:`、`\[Speaker [0-9]+\]`
- 未清理时间戳：`^\[[0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3}\]`
- 重复字符噪声：`^哈哈哈哈哈哈`

**依赖**：仅 `grep` / `mktemp` / `head` / `cp`，无 Python、无网络。

---

## 4.6 cleanup.sh — 中间产物清理

**作用**：最终 `.md` 写完后删 ASR 中间产物（默认删 `transcript_run_*/`、`transcript_*_part*/` 下 `chunks/`），保留 `merged/all.txt` + `merged/all.srt` 供复查。`--purge` 连同 merged 与父目录全删。

**调用**：
```
bash cleanup.sh [--purge] [--dry-run] [--keep-wav] [DIR]
```

**依赖**：仅 `rm` / `cd` / `ls`。独立工具，不被 `pipeline.sh` 调用（pipeline 只提示 verify）。

---

## 4.7 setup.sh — 旧 PyTorch FunASR 后端安装（默认已不用）

**作用**：建 `.venv-funasr` venv，装 `torch` / `torchaudio` / `funasr` / `modelscope`，预下载 `SenseVoiceSmall` + `fsmn-vad` + `cam++`。面向**旧 PyTorch 路径**，与当前默认 nano GGUF 后端无关（pipeline 注释称 GGUF 已取代它）。

**调用**：`bash setup.sh` 或 `PYTHON_BIN=/path/to/python3.12 bash setup.sh`（要求 Python 3.12，缺失 `exit 1`）。

---

## 4.8 ingest-prompt.md — agent 摄入指令模板

**作用**：给"下一个 agent"的端到端指令（音频 → 转录 → 知识库摄入 → 清理），复制即用。其中硬编码调用 `pipeline.sh`（stepfun 后端）并以裸 `rm` 清理。超出本仓库范围（指向 `~/Desktop/知识库/` 目录与 Wiki 体系），仅作背景记录。

**重要规则**：原始稿存 `.md`；中文路径先 `cp /tmp/` 用 ASCII 文件名；Stepfun 返回 "risk blocked" 则告知用户且**不要再试 Nano**；分类不确定用 `grep` 找已有分类、不新建。
