# 验收契约：公网媒体导入可靠性

日期：2026-09-22
目标环境：`https://lcw.yishuziyu.cn` → Vercel → 阿里云 `121.89.90.68` nginx `/lcw/` → `web-app-1:8787` → Docker volume `/data`

## Change

用户在公网页面粘贴一条具体视频链接后，能依次看到「服务器已接收」和真实阶段；服务端把任务先写入 `/data/jobs`，再用容器内可独立运行的 yt-dlp 和 ffmpeg 得到音频，原子写入该期次的 `source.*` 与 `source-meta.json`。刷新后素材还在。

用户粘贴 `douyin.com/user/self`、普通用户主页、搜索页或首页时，请求在调用 yt-dlp 之前结束，页面显示：「这是抖音主页，不是具体视频。请打开要导入的视频，复制该视频的分享链接。」

服务或容器重启后，原先 `running` 的任务不再显示为进行中，改为 `interrupted`（若 source 或逐字稿已经落盘，则标成已完成）。已完成的分块文本、音频和文章仍在。再次继续时，已有 `chunk_*.txt` 不会重新请求转录。

`GET /api/health/ready` 在 yt-dlp、ffmpeg、`/data` 或 Job Store 不可用时返回失败，且响应里没有密钥、密码、cookie 或 HOME 绝对路径。

## Not this

- 只交架构说明、模块图或未接入的空接口。
- 用 mock、假进度或跳过 yt-dlp 的结果充当公网导入成功。
- 只改前端文案，容器里的 yt-dlp 仍然依赖不存在的 `python3`。
- 把 SSE 连接当成任务本身：断开、刷新或重启后任务状态丢失，或仍显示 `running`。
- 抖音失败却提示成 B 站；主页失败仍显示「未获取到可转录的音频」。
- 引入 Kubernetes、Redis、消息队列、第二台机器或新的数据库服务。
- 重做页面视觉，或换掉现有产品流程。
- 改动、删除用户已有的 `raw/`、`cleaned/`、`/data`，或执行 `docker compose down -v`。
- 覆盖这台机器上其他项目的 nginx `server` 块，或改动无关的 `/api/`、`/r/`、`8080` 路由。
- 把 API Key、cookie、密码写进仓库、镜像或日志。

## Evaluator

- 机器检查：本仓库测试、前端构建、最终 runtime 镜像里的 `yt-dlp --version` / `ffmpeg -version`、Node 能 spawn 这两个命令、readiness、本地夹具导入。
- 公网检查：在 `https://lcw.yishuziyu.cn` 上走「真实用户路径」。页面文案、阶段是否好懂，由用户最终验收。
- 通过标准是用户路径上的可观察结果。测试全绿但不能在公网复现，视为未完成。

## 真实用户路径

1. 反例。打开公网首页，粘贴 `https://www.douyin.com/user/self?...`。不出现下载进度。提示是抖音主页而不是具体视频。服务器日志里这次请求没有启动 yt-dlp。
2. 正例。粘贴一条无需登录即可访问的具体抖音视频或分享短链。先看到「服务器已接收」，再看到检查链接、读取视频信息、下载媒体、提取音频、已保存素材、等待转录中的实际阶段。只有 yt-dlp 打出真实百分比时才出现百分号。刷新后资料库里仍有该素材，`/data/raw/<slug>/source.*` 与 `source-meta.json` 存在，对应 Job 为 `succeeded`。
3. 若抖音因登录、地域或风控拒绝：yt-dlp 本身已能执行；错误是 `login_required` 或 `platform_refused`，文案指向抖音而不是 B 站，也不是「下载组件损坏」。然后用一条 B 站公开视频或合法直链走完同一条导入闭环。
4. 重启。导入或转录进行中重启 Node 或该容器。刷新后不再一直显示进行中。Job 为 `interrupted`，或 source / 逐字稿已经完整落盘时为已完成。已有分块、音频、文章还在。点继续后，已完成的分块不会重新转录。

## 机器验证

在 `web/` 执行 `sh scripts/predeploy.sh`，至少包含：

- `npm test`（含下面列出的新增测试，以及原有上传、删除、配额、文章、转录测试）
- `npm run build`
- Docker image build
- 最终 runtime 镜像中 `yt-dlp --version` 退出码 0
- 最终 runtime 镜像中 `ffmpeg -version` 退出码 0
- Node `spawn` 这两个命令退出码 0
- readiness：依赖缺失时 `ok: false`；检查项含 `data`、`disk`、`ytdlp`、`ffmpeg`、`stepfun`、`jobStore`
- 本地夹具：音频字节经与线上相同的原子发布写入临时 DATA_ROOT，重启恢复不会删掉它
- `git diff --check`

新增测试对应的失败模式：

1. 最终镜像安装的是官方自包含 Linux 可执行文件，不是依赖 `python3` 的 `yt-dlp` zipapp。
2. 抖音具体视频、短链、主页、`/user/self`、首页的分类。
3. 错误 code 到用户文案，且抖音不说成 B 站。
4. Job Store 临时文件加 rename；半截 `.tmp` 不会被当成任务。
5. 启动时 `running` / `paused` → `interrupted`；source 已落盘则标成功。
6. 取消订阅（SSE 断开）后任务仍完成。
7. 同一 `requestId` 或同一期次的活动任务不重复执行。
8. ingest / transcription / article 各自并发不超过 1，多余的排队。
9. yt-dlp 路径不存在时 readiness 失败，且响应不含密钥和绝对 HOME。

## 未验证项

- 2026-09-22 只读复核（没有改容器、数据卷或 nginx）：线上 `web-app-1` 的 `yt-dlp --version` 仍是 `/usr/bin/env: 'python3': No such file or directory`；`ffmpeg -version` 退出码 0；`web_data` 挂在 `/data`；`location /lcw/` 仍反代 `127.0.0.1:8787`；`nginx -t` 通过，没有 reload。本机 Docker Desktop 没有起来，最终镜像没有构建，因此没有部署，公网页面仍是旧服务。
- 在阿里云容器和公网页面上的真实视频闭环：要等本地测试、最终镜像和部署前检查都通过之后才做。未做之前不得标成已验证。
- 抖音若返回登录或风控，短链重定向后的真实视频页可能无法在本次网络环境下走完。此时必须改用 B 站公开链接或合法直链补同一条闭环，并单独记录抖音被拒绝的 code。
- 不调用付费 StepFun 接口做 readiness。转录和整理的真实供应商调用不在本契约的自动检查里。
- 不把备份上传到 OSS。备份脚本只在本机或服务器上打 tar。
- 其他项目的 nginx 站点不在本次修改范围内，因此也不验证它们的业务功能；只验证本项目没有改到那些 `server` 块。

## 回滚方式

代码尚未提交时：用 `git checkout -- <本轮跟踪文件>` 丢弃改动，未跟踪的 `raw/`、`cleaned/`、`miniprogram/`、`.omo/` 不要动。不要 `git reset --hard`，不要 `git clean`。

已经部署时：

1. 不要执行 `docker compose down -v`，不要删除 named volume，不要清理 `/data`。
2. 若 nginx 被动过：用部署前备份恢复，`nginx -t` 通过后再 reload。本轮默认不改共享 nginx。
3. 应用回滚：把 `web-app-1` 换回部署前的镜像标签后 `docker compose up -d`（不带 `-v`）。`/data/jobs` 里多出来的任务文件可以留下，旧版本会忽略不认识的目录。
4. 数据恢复：用 `deploy/backup-data.sh` 生成的 tar（含 `raw/`、`cleaned/`、`jobs/`、`quota.json`，不含 `.ingests`）解回 volume。见 `deploy/BACKUP.md`。
