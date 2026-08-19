#!/usr/bin/env bash
# transcribe.sh — E31 《为了给地球降温人类都在忙些什么》Stepfun ASR pipeline
#
# 1. 切块（已执行，28 段 × 3 分钟，源 44.1kHz 立体声 → 16kHz mono 64k mp3）
# 2. 逐段调 transcribe_stepfun.py → chunks/chunk_NNN.txt + .srt
# 3. 合并到 asr_raw.txt
#
# Run from: /Users/mahaoxuan/Desktop/AI产品经理/podcast-to-essay/raw/2026-06-24-e31-cooling-earth/
# Reqs: STEP_API_KEY env, ffmpeg, python3 + requests
# Pricing: stepaudio-2.5-asr @ 0.15 元/小时 → 1.5h ≈ 0.23 元
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL="/Users/mahaoxuan/.claude/skills/asr-transcript-refinement"
TRANSCRIBE="${SKILL}/scripts/transcribe_stepfun.py"
MERGE="${SKILL}/scripts/merge.py"

if [[ -z "${STEP_API_KEY:-}" ]]; then
  echo "❌ STEP_API_KEY not set. export STEP_API_KEY=sk-... first" >&2
  exit 1
fi

# --- 1. 切块（幂等：chunks 已在，重复运行会覆盖） ---
echo "=== [1/3] Splitting source.mp3 into 3-min chunks ==="
mkdir -p chunks asr_raw
ffmpeg -y -i source.mp3 -ac 1 -ar 16000 -c:a libmp3lame -b:a 64k \
  -f segment -segment_time 180 -reset_timestamps 1 \
  chunks/chunk_%03d.mp3 2>/dev/null

N=$(ls -1 chunks/chunk_*.mp3 | wc -l | tr -d ' ')
echo "  → $N chunks written to chunks/"

# --- 2. 逐段 Stepfun ASR ---
echo "=== [2/3] Stepfun ASR per chunk (sequential, 30x RT estimated) ==="
for mp3 in chunks/chunk_*.mp3; do
  base="${mp3%.mp3}"          # e.g. chunks/chunk_000
  if [[ -s "${base}.txt" ]]; then
    echo "  [skip] $(basename "$base") already done"
    continue
  fi
  echo "  → $(basename "$mp3")"
  python3 "$TRANSCRIBE" "$mp3" "$base" 2>&1 | tail -3
done

# --- 3. 合并 ---
echo "=== [3/3] Merging into asr_raw.txt ==="
python3 "$MERGE" chunks asr_raw.srt asr_raw.txt
echo "✅ Done → $(pwd)/asr_raw.txt"
