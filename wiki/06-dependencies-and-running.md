# 06 · 依赖关系与运行方式

## 6.1 依赖关系图

```
podcast-to-essay (本仓库)
├── 运行时依赖
│   ├── ffmpeg            (切块: transcribe.sh 步骤1)
│   ├── python3 + requests (运行 transcribe_stepfun.py)
│   ├── STEP_API_KEY       (Stepfun 密钥, 启动前置校验)
│   └── 外部 ASR 引擎脚本 (硬编码绝对路径)
│         ~/.claude/skills/asr-transcript-refinement/scripts/
│         ├── transcribe_stepfun.py   ← transcribe.sh 直接调用
│         └── merge.py                 ← transcribe.sh 直接调用
└── 外部引擎自身依赖 (仅 stepfun 分支相关, 供理解)
    ├── Stepfun 云端 API (stepaudio-2.5-asr, SSE)
    ├── split.sh (引擎内, 本仓库未用)
    ├── GGUF 二进制 + 模型 (nano 默认分支, 本仓库未走)
    │     ~/Downloads/项目与数据/agent_audio_funasr/
    │       ├── llama-funasr-nano        (可执行二进制, Apple Metal)
    │       ├── transcribe_funasr.py     (nano 驱动)
    │       └── nano-gguf/*.gguf         (~1.2G 权重)
    └── verify.sh / cleanup.sh / setup.sh / ingest-prompt.md
```

## 6.2 环境前置

| 依赖 | 用途 | 安装 |
|------|------|------|
| `ffmpeg` | 音频切块 | `brew install ffmpeg` |
| `python3` + `requests` | 运行 ASR 脚本 | `python3 -m pip install requests` |
| `STEP_API_KEY` | Stepfun 云端 ASR 鉴权 | `export STEP_API_KEY=sk-...`（平台 https://platform.stepfun.com 获取） |
| 外部 skill 脚本 | 实际识别/合并实现 | 已安装于 `~/.claude/skills/asr-transcript-refinement/scripts/`（仓库假定其存在） |

> 本仓库**永远走 Stepfun 云端**（transcribe.sh 硬编码调 `transcribe_stepfun.py`），因此 GGUF 二进制 / 模型 / nano 分支在本仓库路径下**不参与**。但理解引擎整体设计时需知道 nano 是引擎默认后端。

## 6.3 新一期运行步骤（复现 / 加新集）

1. **建目录 + 放音频**
   ```bash
   cd /Users/mahaoxuan/Desktop/AI产品经理/podcast-to-essay
   mkdir -p raw/<slug>
   cp /path/to/source.mp3 raw/<slug>/source.mp3
   ```
   slug 格式：`YYYY-MM-DD-节目名-主题`。

2. **准备 transcribe.sh**：复制 `raw/2026-06-24-e31-cooling-earth/transcribe.sh` 到 `raw/<slug>/`，按需改 `source.mp3` 文件名（若不同）。

3. **设密钥**
   ```bash
   export STEP_API_KEY=sk-...
   ```

4. **运行**（在期目录内）
   ```bash
   cd raw/<slug>
   bash transcribe.sh
   ```
   产出 `chunks/`、`asr_raw.txt`、`asr_raw.srt`。

5. **LLM cleanup（主线程，非脚本）**：读 `asr_raw.*`，按 [转录标准](07-conventions.md) 清洗 → 写 `cleaned/<slug>.md`（无时间戳 / 段落呈现 / 说话人替换）。

6. **登记**：在 `INDEX.md` 对应行把 `raw` / `cleaned` 标 ✓，补标题、时长、备注。

> ⚠️ 步骤 4 的 `merge.py` 调用存在接口漂移（见 §6.4），复现前需先修正。

## 6.4 已知接口漂移（重要）

`transcribe.sh` 第 47 行：
```bash
python3 "$MERGE" --input-dir chunks --output asr_raw.txt
```
但当前引擎 `merge.py` 的 `main()` 期望**位置参数**：
```python
chunks_dir = Path(sys.argv[1])   # 期望目录路径
out_srt    = Path(sys.argv[2])   # 期望 .srt 输出
out_txt    = Path(sys.argv[3])   # 期望 .txt 输出
# if len(sys.argv) < 4: exit(1)
```
用当前 `merge.py` 直跑 `--input-dir chunks --output asr_raw.txt` 时，`sys.argv[1]` 会是字符串 `"--input-dir"`，`Path("--input-dir").glob("chunk_*.srt")` 找不到文件 → 打印 `❌ No chunk_*.srt files` 并 `exit 1`。

**含义**：e31 当时成功，说明运行期 `merge.py` 曾支持该 flag 接口；现引擎 `merge.py` 已改为纯位置参数。复现 e31 或加新集前，需二选一：
- 把 `transcribe.sh` 改为位置参数调用：
  ```bash
  python3 "$MERGE" chunks asr_raw.srt asr_raw.txt
  ```
- 或锁定 `merge.py` 到支持 flag 的旧版本。

建议在 Wiki / 代码注释中标注此漂移，避免复现失败。

## 6.5 资产复用（README 摘录）

- **ASR**：`asr-transcript-refinement` skill（v4.1+）。
- **Stepfun 默认**（用户偏好）：`stepaudio-2.5-asr`，0.15 元/小时，~30x RT。
- **本地 fallback**：`Fun-ASR-Nano GGUF`，~9x RT，0 成本（引擎默认分支，本仓库未用）。
