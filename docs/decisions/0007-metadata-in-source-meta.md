# 0007 标题与时长只存在 source-meta.json，删除 INDEX.md

- 日期：2026-09-25
- 状态：采用

## 背景
根目录 `INDEX.md` 原是手工维护的转录登记表，服务端又从里面读标题和时长，并且优先于应用内改的标题：登记过的条目改名后不生效。表里只登记了 3 条中的 1 条，线上根本没有这个文件。

## 决定
删除 `INDEX.md` 和服务端解析它的代码；标题、时长只读 `raw/<slug>/source-meta.json`。唯一登记过时长的条目 `2026-08-19-bv1darmbce4a` 把 `duration` 迁入其 `source-meta.json`。

## 放弃的选项
- 保留 INDEX.md 作登记表：资料库已经列出全部条目，手工表只会继续过时。

## 后果
新导入的条目目前没有时长（上传和链接导入都不写 `duration`），见 [backlog](../backlog.md)。

2026-09-25 补：上传、链接导入、更换音轨时，音频落盘后用 ffprobe 读时长写入 `duration`（`web/server/infrastructure/media-probe.mjs`）。此前导入的两条（`2026-09-02-link`、`2026-09-05-…`）仍没有时长。
