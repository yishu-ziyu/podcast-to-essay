# 誊清

把视频或播客整理成一篇可读、可核对的文章。

线上地址：<https://lcw.yishuziyu.cn>（未登录为游客，每天有导入 / 转录 / 整理额度；数据仅本人可见）

## 它做什么

1. **导入素材**：粘贴 B 站、抖音、YouTube、播客页面或媒体直链，或上传本地音视频文件。
2. **转成初稿**：按约 3 分钟分段做语音识别，得到逐字初稿和分段稿，可随时暂停、断点续转。
3. **整理成文**：用大模型把初稿整理成有标题和段落的文章；未通过结构校验的结果不会写入。

每一步都由用户手动开始。原音轨、初稿、分段稿和文章都保存在同一个条目下，阅读时可以「核对」——文章段落和分段稿互相定位。

## 本地运行

需要 Node ≥ 18、`ffmpeg`、`yt-dlp`（≥ 2026.07.04）。

```bash
# 仓库根目录建 .env.local，写入 StepFun 密钥（已被 Git 忽略）
echo 'STEP_API_KEY=...' > .env.local

cd web
npm install
npm run dev        # 前端 :5173 + 服务端 :8787；端口被占时见 AGENTS.md
```

本地不设 `ACCESS_PASSWORD` 时所有人都是所有者，数据写在仓库的 `raw/`、`cleaned/` 下。

其他命令：`npm test`（服务端与前端单测）、`npm run build`（构建前端）、`npm run electron:dev`（桌面壳，未在近期验证）。

## 文档

- [docs/README.md](docs/README.md) — 文档地图：架构、接口、数据格式、决策记录、问题清单、测试记录
- [deploy/REDEPLOY.md](deploy/REDEPLOY.md) — 线上部署与现状
- [AGENTS.md](AGENTS.md) — 给 AI 编码助手的工作规则

仓库：[yishu-ziyu/podcast-to-essay](https://github.com/yishu-ziyu/podcast-to-essay)。音轨、切块、`.env*` 不入库。
