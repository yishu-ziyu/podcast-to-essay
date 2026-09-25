# 部署状态备忘（2026-09-05，2026-09-18 复核）

> 本地 dev 已关闭（vite :5173 + server :8788）。线上已恢复并验证可用，见 §2。

## 1. 代码状态：已入库

`main` 与 `origin/main` 同步，9 月 5 日新增 7 个提交（均已 push）：

| 提交 | 内容 |
|---|---|
| `af32b9f` | 游客可建期次 + 上传本地音频（扣导入额度、`owner.json` 隔离） |
| `5e06018` | 整理成文时顺带输出段落→秒区间映射（`paraMap`，失败则降级） |
| `088116e` | 游客可见本地上传 + slug 冲突重试 |
| `2962703` | 设计系统：accent 纪律、仪器轨、核对双栏等样式 |
| `1e0dec7` | 转录进度仪器 + 灰态未来步骤卡 |
| `cdf95dc` | toast 点击 120ms 渐隐 |
| `10c156f` | 阅读器双栏核对 + 完成闪烁 |

验证：`tsc` 干净，`npm test` 15/15。注意：老文章的 `article-meta.json` 无 `paraMap`，
核对页会提示降级，**重新整理一次**即生成映射。

## 2. 线上状态：已恢复并验证可用（2026-09-18 复核）

- 链路：`lcw.yishuziyu.cn`（Vercel 反代，解析 `216.198.79.65`）→ `http://121.89.90.68/lcw/`（阿里云 Docker `web-app-1` :8787，数据在 `web_data` 卷）。
- 2026-09-18 复核：
  - 云主机活着：阿里云北京，2 核 / 3.5G / 49G（已用 43%），2026-09-07 起连续运行。
  - 本机 `~/.ssh/id_ed25519` 可 root 免密登录（`~/.ssh/config` 是空的，不影响）。
  - 域名 DNS 于 2026-09-17 迁到 Cloudflare；`lcw` 仍是 CNAME → Vercel。
  - 修复：nginx `server_name 121.89.90.68` 块补 `location /lcw/`（`proxy_pass http://127.0.0.1:8787/`，剥前缀；`client_max_body_size 600m`）。此前 `/lcw/` 落到 `location /` → 8080，返回 404。备份：`/root/backups/red-herring-ip-api.conf.<时间戳>`。
  - 验证：从云主机走公网 `GET https://lcw.yishuziyu.cn/` → 200，标题「录成文」；`/assets/*` 200；`/api/health` 200；6MB POST 未被 Vercel 网关拦截。
- 更正 2026-09-05 的误判：当时 `lcw` 解析到 `198.18.0.51` 是本地代理造成的假象，云主机从未过期。

## 2.1 2026-09-25 部署（`cd9c8eb`）

- 内容：首页改为输入卡 + 最近文章、资料库改为顶栏浮层、产品名改为「誊清」、核对与更换音轨等修复。
- 服务目录：`/opt/podcast-to-essay`（compose 在 `web/`）。部署前该目录停在 `93e0ebe`，`0fa5020` 是手工拷文件上去的，
  工作区与 `0fa5020` 逐文件比对一致后才 `git reset --hard origin/main`；原目录备份在
  `/root/backups/podcast-to-essay-src-20260925-015450.tar.gz`。
- `web/ytdlp-assets/yt-dlp_linux` 不入库（`.gitignore`），但 Dockerfile 需要它；reset 不会删除它，不要 `git clean -x`。
- 前台跑 `docker compose build` 时 SSH 会断开且构建不会开始，改为 `nohup` 后台执行，日志写到 `/root/backups/deploy-*.log`。
- 验证：公网标题「誊清」，`/assets/*` 200，`/api/health` 200；游客模式横幅 36px、内容区占满（首次部署时横幅被拉高，`cd9c8eb` 修复后重部署）。
- 部署前确认 `/data/jobs` 里没有 queued / running / paused 任务，重启不会打断转录。

## 2.2 2026-09-25 部署（`665aeeb`）

- 内容：核对段落定位修复、转录每段网络错误重试 2 次、网络错误中文提示、重试成功后不再显示「转录失败」、抖音失效分享链接提示、素材页日期按本地时区、去掉 INDEX.md 依赖。
- 部署前服务目录停在 `53552db`，工作区干净；`/data/jobs` 3 个任务都是 succeeded。这次服务器能直接 `git pull --ff-only origin main`。
- 后台构建日志 `/root/backups/deploy-20260925-1013.log`，以 `DEPLOY_DONE` 结束。
- 验证：公网 `/api/health` 200、标题「誊清」、新资源 `index-8Rfq7EQI.js`；游客模式下失效抖音口令和 `example.com` 的提示正确，没有生成条目。见 [端到端记录](../docs/evals/2026-09-25-e2e-duration-map.md)。
- 容器内有 `ffprobe`（5.1.9），后续时长功能可直接用。

## 2.3 2026-09-25 部署（`ee49264`）

- 内容：条目时长写入 `source-meta.json`、整理输出上限 100k、按行拆段、段落映射改标逐字稿段号、转录可重试判断统一。只改服务端，前端资源名不变（`index-8Rfq7EQI.js`）。
- 部署前 `/data/jobs` 无进行中任务（1 条 failed 是上一轮验证时的失效抖音链接）。服务器直接 `git pull --ff-only origin main`。日志 `/root/backups/deploy-20260925-1115.log`。
- 验证：`/api/health` 200；容器内对线上一条音频只读跑 `probeDuration`，得到 `00:03:01`；公网游客模式失效抖音口令、`example.com` 提示正确，没有生成条目。没有在线上做游客上传（游客删不掉测试条目）。

## 2.4 2026-09-25 部署（`218ca8d`）

- 内容：首次进入 3 步巡览、第一次读文章时的核对提示（决策 0010）。只改前端，新资源 `index-VP84QHXI.js`。
- 部署前 `/data/jobs` 无进行中任务（2 条 failed 是验证失效抖音链接时留下的）。日志 `/root/backups/deploy-20260925-1156.log`。
- 验证：公网 `/api/health` 200；全新游客上下文走完巡览，桌面 1440×900 和手机 390×844 聚光框与目标重合，刷新不再出现，重看、跳过、Esc 正常；没有创建条目。

## 2.5 2026-09-25 部署（`baccfdf`）

- 内容：B 站被拒时改走公开接口下载音频（决策 0011）、网站图标。
- 起因：线上导入 B 站链接失败，容器内 yt-dlp 复现为 HTTP 412（云服务器 IP 被 B 站网页风控）。
- 部署前没有进行中的任务。日志 `/root/backups/deploy-20260925-1220.log`。
- 验证：容器内对用户那条链接 `BV1CXet6gE6X` 直接跑导入代码，成功（3.7 MB，409 秒，标题正确），写在临时目录、未建条目；公网 `favicon.png` 200。兜底失败时看 `docker logs web-app-1 | grep bilibili_api_fallback`。

## 3. 重新部署步骤

```bash
# 1. 先确认能连上
ssh root@121.89.90.68 'echo OK'

# 2. 到服务目录，拉代码（工作区应干净；不干净先比对再处理，见 §2.1）
cd /opt/podcast-to-essay
git pull origin main

#    云主机连 GitHub 经常超时。拉不下来时在本机打包缺的提交再传上去（提交与 origin/main 完全一致）：
#    本机： git bundle create /tmp/p2e.bundle <服务器当前提交>..main
#          scp /tmp/p2e.bundle root@121.89.90.68:/root/backups/p2e.bundle
#    云主机：git pull --ff-only /root/backups/p2e.bundle main

# 3. 重建并重启（data 卷保留期次数据；内存中的转录任务会中断，可断点续转）
#    后台执行，避免 SSH 断开打断构建
cd web
nohup sh -c "docker compose build && docker compose up -d && echo DEPLOY_DONE" > /root/backups/deploy-$(date +%Y%m%d-%H%M).log 2>&1 &

# 4. 验证（注意带正确 Host，裸 IP 可能被阿里云入口拦截）
curl -H "Host: lcw.yishuziyu.cn" http://127.0.0.1:8787/api/health
# 期望：{"ok":true,...,"owner":...} 且 200

# 5. 线上确认
# https://lcw.yishuziyu.cn 打开：游客可见本地上传；登录 owner 后无额度限制
```

环境变量在云主机 `web/.env`（`ACCESS_PASSWORD`、`STEP_API_KEY` 等，不入库）；
转录/整理额度、游客配额走该文件。

## 4. 本地开发重启

```bash
cd web
API_PORT=8788 npm run dev   # 前端 :5173，后端 :8788；注意 8787 常被其他服务占用
```

本地无 `ACCESS_PASSWORD` 时所有人都是 owner，直接可用。
