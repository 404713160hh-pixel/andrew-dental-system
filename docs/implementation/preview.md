# 私人预览环境

ICP 备案完成前，预览使用独立 PostgreSQL 数据卷和虚构资料，并通过 SSH 本地转发访问服务器回环地址。不要将预览网站、API 或数据库映射到公网，也不要把真实患者资料输入演示库。预览不能代替真实设备、HTTPS 和正式环境验收。

阿里云说明，使用中国内地服务器直接通过 IP 对外提供网站服务也需要备案；应在备案完成且接入及业务类目要求核验后再对公网开放。参考[常见网站的ICP备案场景及备案要求](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/icp-filing-requirements-for-a-regular-website)。

## 服务器准备

在确认是预期实例并核对 SSH 主机指纹后，使用单独目录及 `andrew-preview` Compose 项目。安装 Docker Engine 和 Compose 插件须遵循官方步骤；开始前检查磁盘、内存，以及该服务器上是否已有需要保留的其他服务。以下命令从预览目录中的项目根目录执行。

1. 复制 `.env.compose.example` 到 `.env.preview`，权限限制为当前管理员可读。`POSTGRES_PASSWORD` 与 `POSTGRES_APP_PASSWORD` 分别设置不同的随机十六进制字符串；`SEED_PASSWORD` 使用单独的强密码。不要把任何密码放进命令行历史、源码或仓库。
2. 设置 `ADMIN_PORT=18080`、`CORS_ORIGINS=http://127.0.0.1:18080`。隐私控制者、联系信息和保存期限字段填写明确的演示用途说明，不冒充真实医疗机构。若 Docker 默认子网冲突，指定独立的预览网络与固定代理 IP。
3. 顺序构建并启动。宿主监听仅为 `127.0.0.1:18080`；不要启用 HTTPS 公网端口配置。

```bash
docker compose -p andrew-preview -f compose.yaml --env-file .env.preview config --quiet
docker compose -p andrew-preview -f compose.yaml --env-file .env.preview build api
docker compose -p andrew-preview -f compose.yaml --env-file .env.preview build web
docker compose -p andrew-preview -f compose.yaml --env-file .env.preview up --no-build -d
docker compose -p andrew-preview -f compose.yaml -f compose.preview.yaml --env-file .env.preview --profile preview run --rm seed
docker compose -p andrew-preview -f compose.yaml -f compose.preview.yaml --env-file .env.preview --profile preview run --rm seed node booking-api/dist/booking-api/src/cli.js demo
```

默认 `compose.yaml` 不包含演示 seed 服务。只有在明确指定 `compose.preview.yaml` 并启用 `preview` profile 时，才可执行合成数据填充；该覆盖文件仅用于独立预览项目，绝不能对真实业务数据库使用。`-p andrew-preview` 为预览创建独立 Compose 资源和数据卷。运行前确认该项目名尚未被其他用途占用；容器健康、迁移和合成数据写入结果应逐项核验。2 核 2 GB 机器是否能稳定构建、运行，需在目标机实测。

## 本机访问

在可信本机中建立隧道，将本机回环地址转发到服务器回环地址。`SERVER_IP` 是实际服务器地址；输入凭据时使用终端提示，勿写入命令或聊天。若首次连接，先通过可信渠道核对 SSH 主机指纹，再决定是否信任。

```bash
ssh -N -L 127.0.0.1:18080:127.0.0.1:18080 root@SERVER_IP
```

保持隧道运行后，在本机浏览器访问 `http://127.0.0.1:18080`。预览中的总部、前台、医生和患者均是合成账号，密码由 `.env.preview` 设置；API 仍关闭无需密码的演示快捷登录。预览小程序可在同一台电脑的开发者工具中使用该本机地址，不视为手机真机、微信身份登录或合法域名验收。
