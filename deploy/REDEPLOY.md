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

## 3. 重新部署步骤

```bash
# 1. 先确认能连上
ssh root@121.89.90.68 'echo OK'

# 2. 到服务目录，拉代码（工作区应干净；不干净先比对再处理，见 §2.1）
cd /opt/podcast-to-essay
git pull origin main

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
