# 0011 B 站被拒时改走公开接口下载音频

- 日期：2026-09-25
- 状态：采用

## 背景
线上第一次导入 B 站链接就失败：阿里云服务器访问 `www.bilibili.com/video/…` 网页返回 HTTP 412（风控），yt-dlp 先抓这个网页，所以整次导入失败。带上访客 cookie（buvid3）仍是 412。同一台服务器请求 B 站公开接口（`x/player/pagelist`、`x/player/playurl`）正常，音频 CDN 带 Referer 也能下载。本地测试时发现 `x/web-interface/view` 的风控最严：家用 IP 连续请求几次后也会 412，而 pagelist 和 playurl 照常返回。

## 决定
B 站链接仍先用 yt-dlp；它被拒绝（`platform_refused`）时：pagelist 取第一 P 的 cid 和标题 → playurl 取音频流（优先 132 kbps）→ 带 Referer 下载 → ffmpeg 不重新编码转封装成 `source.m4a`。只有多 P 视频才请求一次 view 拿总标题，失败就用分 P 标题。兜底也失败时仍显示原来的「B 站拒绝」提示，并记一条 `bilibili_api_fallback` 日志，写明哪一步、什么状态码。

## 放弃的选项
- 配 B 站登录 cookie：要用户账号凭据，且会过期。
- 走代理或住宅 IP：要额外服务和费用。
- 只用接口、不用 yt-dlp：yt-dlp 在能访问网页的环境里更完整（分 P、清晰度），维护也跟得上 B 站改版。

## 后果
只取第一 P，与 yt-dlp `--no-playlist` 一致。接口本身也有风控，偶尔仍会被拒，用户点「重试」通常能过；日志能看出被拦在哪一步。若线上被拒变多，再考虑登录 cookie。
