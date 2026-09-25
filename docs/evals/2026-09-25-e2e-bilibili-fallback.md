# 2026-09-25 端到端：B 站导入兜底与网站图标

- 起因：用户在线上导入 `https://www.bilibili.com/video/BV1CXet6gE6X/` 失败，诊断号 `6f8d5ddd…`，错误 `platform_refused`
- 版本：`1658865` 加上本次改动

## 复现与定位（线上服务器）

| 请求 | 结果 |
|---|---|
| 容器内 yt-dlp 读取该链接 | `HTTP Error 412: Precondition Failed` |
| 带访客 cookie（buvid3）再试 | 仍 412 |
| 服务器 curl 视频网页 | 412 |
| 服务器 curl `x/web-interface/view` / `x/player/playurl` | 200，code 0 |
| 服务器下载音频流（带 Referer） | 200，3.3 MB，ffprobe 409.4 秒 |
| 本地 yt-dlp 读取同一链接 | 正常（「5 分钟学会写架构设计」，6:49） |

## 修复后验证（本地，用返回 412 的假 yt-dlp 模拟服务器被拦；B 站接口与 CDN 走真实网络）

| 输入 | 期望 | 实际 | 结论 |
|---|---|---|---|
| 界面粘贴 `BV1CXet6gE6X` 链接 | 导入成功，标题与时长正确 | 4 秒成功，「5 分钟学会写架构设计」，`00:06:49`；已删除 | 通过 |
| 同一音频按转录的 ffmpeg 参数切块 | 能切成 3 分钟段 | 3 段，180 + 180 + 49.4 秒 | 通过 |
| 本地 IP 被风控时直接调用 | 兜底可能失败 | 一次失败、下一次成功；原因被吞掉 → 已加日志 `bilibili_api_fallback`（如 `pagelist:412`） | 已修（可观测） |
| 本地 `x/web-interface/view` | — | 连续请求后 412，pagelist 与 playurl 仍 200 → 单 P 视频不再请求 view | 已修 |

线上真实导入要部署后验证。

## 网站图标

标签页原本是默认地球图标。加 `favicon.png`（64px）、`apple-touch-icon.png`（180px）、`icon-512.png`（原图），橙底白色宋体「誊」；另有 B（米底墨字）、C（墨底米字）两个候选待用户挑。
