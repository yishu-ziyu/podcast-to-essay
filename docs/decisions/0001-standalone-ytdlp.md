# 0001 镜像内使用独立的 yt-dlp 二进制

- 日期：2026-09-22（提交 `0fa5020`）
- 状态：采用

## 背景
yt-dlp 发布页里名为 `yt-dlp` 的资产是 Python zipapp，在不带 python3 的镜像里运行直接报错；用 pip 装又会让构建依赖网络和 Python 版本。

## 决定
按架构取 `yt-dlp_linux` / `yt-dlp_linux_aarch64` 独立二进制，放在 `web/ytdlp-assets/`（不入库），构建时拷进镜像。

## 放弃的选项
- 镜像里装 python3 + pip：体积大、构建慢、版本漂移。

## 后果
- 部署前服务器上必须有 `web/ytdlp-assets/yt-dlp_linux`；`git reset` 不会删它，但 `git clean -x` 会。
- 升级 yt-dlp 需要手动替换这个文件后重建镜像。
