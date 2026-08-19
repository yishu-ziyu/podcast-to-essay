# 03 · 编排模块：transcribe.sh

> 仓库内唯一的"代码"脚本，位于 `raw/2026-06-24-e31-cooling-earth/transcribe.sh`。
> 它是本仓库与外部 ASR 引擎之间的**胶水层**——负责切块、逐段识别、合并三步。

## 3.1 元信息

- Shebang：`#!/usr/bin/env bash`，`set -euo pipefail`（任一命令失败即退出）。
- 运行位置：必须在 `raw/<slug>/` 目录内运行（脚本用 `$(dirname "$0")` 解析 `HERE`）。
- 前置：`STEP_API_KEY` 必须已 `export`，否则第 18–21 行直接退出。
- 依赖外部绝对路径（硬编码）：
  ```bash
  SKILL="/Users/mahaoxuan/.claude/skills/asr-transcript-refinement"
  TRANSCRIBE="${SKILL}/scripts/transcribe_stepfun.py"
  MERGE="${SKILL}/scripts/merge.py"
  ```

## 3.2 三段式流程

### 步骤 1 — ffmpeg 切块（幂等）

```bash
mkdir -p chunks asr_raw
ffmpeg -y -i source.mp3 -ac 1 -ar 16000 -c:a libmp3lame -b:a 64k \
  -f segment -segment_time 180 -reset_timestamps 1 \
  chunks/chunk_%03d.mp3 2>/dev/null
N=$(ls -1 chunks/chunk_*.mp3 | wc -l | tr -d ' ')
```

- 输入：期目录内 `source.mp3`。
- 参数：`-ac 1`（单声道）、`-ar 16000`（16 kHz）、`-c:a libmp3lame -b:a 64k`（64k mp3）、`-f segment -segment_time 180`（每片 180 秒 = 3 分钟）、`-reset_timestamps 1`。
- 输出：`chunks/chunk_%03d.mp3`（零填充 3 位十进制）。e31 实测 28 片。
- 幂等性弱：脚本注释说"chunks 已在，重复运行会覆盖"，但未做 skip 判断——重复运行会重切并覆盖。

### 步骤 2 — 逐段 Stepfun ASR（带 skip-if-exists）

```bash
for mp3 in chunks/chunk_*.mp3; do
  base="${mp3%.mp3}"
  if [[ -s "${base}.txt" ]]; then
    echo "  [skip] $(basename "$base") already done"
    continue
  fi
  echo "  → $(basename "$mp3")"
  python3 "$TRANSCRIBE" "$mp3" "$base" 2>&1 | tail -3
done
```

- 调用：`python3 transcribe_stepfun.py <mp3> <base>` → 产出 `chunk_NNN.txt` + `chunk_NNN.srt`（见 [04-module-asr-engine.md](04-module-asr-engine.md)）。
- **幂等核心**：`if [[ -s "${base}.txt" ]]`——若同名 `.txt` 已存在且非空（`-s`），跳过该段。因此中断后可重跑续传。
- 串行执行（注释标注 "sequential, 30x RT estimated"）。

### 步骤 3 — 合并

```bash
python3 "$MERGE" --input-dir chunks --output asr_raw.txt
echo "✅ Done → $(pwd)/asr_raw.txt"
```

- ⚠️ **接口漂移警告**：此处以 `--input-dir` / `--output` **flag 形式**调用 `merge.py`，但当前引擎 `merge.py` 期望**位置参数** `<chunks_dir> <output_srt> <output_txt>`（见 [06-依赖与运行](06-dependencies-and-running.md#64-已知接口漂移)）。用当前 `merge.py` 直跑此命令会失败（把 `--input-dir` 当成目录路径）。e31 当时成功，说明运行期 `merge.py` 尚支持该 flag 接口，现已漂移。复现时需修正为位置参数或回退旧版。
- 正常行为应产出 `asr_raw.txt`（+ `asr_raw.srt` 由 merge 的 srt 输出分支生成）。

## 3.3 与本仓库其它文件的关系

- 产出 `asr_raw.txt` / `asr_raw.srt` → 被 **cleaned 阶段（LLM cleanup）** 消费，最终生成 `cleaned/<slug>.md`。
- 成功完成后，应在 `INDEX.md` 对应行把 `raw` / `cleaned` 标记 ✓。
- 不负责写作/发布（已删除）。
