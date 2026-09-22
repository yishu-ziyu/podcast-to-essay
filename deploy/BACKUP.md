# 数据备份与恢复

持久数据仍在 Docker named volume 里，挂载为容器内的 `/data`。这一步只做本机只读打包，不上传，不删除源文件。

## 备份

在阿里云上，先确认 volume 挂载点（不要执行 `docker compose down -v`）：

```bash
docker inspect web-app-1 --format '{{range .Mounts}}{{.Name}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

`Destination` 为 `/data` 的 `Source` 就是宿主机上的 volume 目录。然后：

```bash
sh deploy/backup-data.sh <volume 的 Source 目录> /root/backups
```

包里包含 `raw/`、`cleaned/`、`jobs/`、`quota.json`（存在才打）。`.ingests` 是下载临时目录，不进包。

## 恢复

停应用之前先再打一份当前包。恢复时不要删 volume：

```bash
# 先停容器，避免边写边解。不要加 -v。
cd web && docker compose stop
tar -C <volume 的 Source 目录> -xzf /root/backups/p2e-data-<时间>.tar.gz
docker compose up -d
```

已有同名期次会被包内文件盖住。解包前保留刚才那份新备份。

## 以后接到阿里云 OSS

位置就在这份 tar 生成之后、离开这台机器之前。不要把密钥写进仓库或镜像。在服务器上单独配置 `ossutil` 后，把 `/root/backups/p2e-data-*.tar.gz` 拷到 bucket 里的 `podcast-to-essay/backups/`。恢复时先从 OSS 拉回 tar，再按上面的解包步骤写回同一个 volume。当前没有这项凭据，脚本到打出 tar 为止。
