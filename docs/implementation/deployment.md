# 本地、Docker与HTTPS部署

## 本地开发

优先按根README的3终端命令启动。`npm run dev:postgres`是真实PostgreSQL，不是SQLite模拟。Windows中文目录通过独立ASCII缓存保存原生工具与PG数据，具体路径在`.booking-data/postgres-location.json`，随机口令保存在被Git忽略的`.booking-data/local-postgres.json`与`.env.booking`。这些私密文件不输出到日志、不打包、不入库。

如已有自己的PostgreSQL，复制`.env.booking.example`为`.env.booking`，填写正确DATABASE_URL（密码URL编码）；不要运行本地内置PG工具，以免误连其他库。新建独立数据库后执行迁移和非生产seed。生产业务账号不应有创建测试数据库的权限，集成测试使用专门本地测试服务器。

## Docker Compose

本机若没有Docker，下面的配置可以静态校验，但不能把它写成容器实测通过。需要目标机安装Docker Engine与Compose v2，项目默认Compose已改为新预约架构。旧Compose留在deploy/legacy，默认不会启动旧SQLite。

1. 复制`.env.compose.example`为`.env.compose`。
2. 将 `POSTGRES_PASSWORD` 和 `POSTGRES_APP_PASSWORD` 分别设置为不同的随机十六进制字符串，运行账号密码至少32个十六进制字符；初始迁移账号和运行账号不得相同。按实际机构设置 `PRIVACY_CONTROLLER_NAME`、`PRIVACY_CONTACT`、`PRIVACY_RETENTION`；不能使用示例占位符。
3. 依据网络选择不冲突的 `BOOKING_DOCKER_SUBNET`，并设置属于该子网、互不相同的 `BOOKING_WEB_IP` 和 `BOOKING_HTTPS_IP`。这两个地址用于限定可信代理，不能填公开来源或宽网段。
4. 检查环境变量文件不入库；使用系统权限限制文件读取。避免直接把带秘密的 `docker compose config` 输出保存到日志；检查可用 `config --quiet`。

```bash
docker compose --env-file .env.compose config --quiet
docker compose --env-file .env.compose build api
docker compose --env-file .env.compose build web
docker compose --env-file .env.compose up --no-build -d
```

启动顺序：PostgreSQL健康→使用迁移账号执行checksummed迁移→配置独立低权限运行角色→API→Nginx/Web。数据库只在Compose内部网络，没有宿主5432端口；API也不直接映射公网。员工界面通过127.0.0.1:8080的Nginx访问同源API。

迁移账号为 `POSTGRES_USER`，仅用于迁移、初始化和维护；API 使用 `POSTGRES_APP_USER`。`provision` 服务在迁移后建立或校验专用运行角色，赋予业务表读、增、改权限，仅允许删除会话和需要事务性重建的关联记录；不允许删除患者或预约记录、改写迁移记录和修改或删除审计记录。隐私同意记录仅允许新增以及更新撤回时间，不能删除或修改原同意内容。已有高权限、已有成员关系或拥有对象的同名角色会使授权失败。授权脚本会撤销当前专用数据库中 PUBLIC 的 CREATE/TEMP 权限，请勿直接指向共用数据库。每次新增迁移后须重新执行授权；修改运行账号密码也须更新 API 配置并验证连接。

阿里云 Ubuntu 24.04 的 2核2G 机器可先在非生产环境按上面顺序分别构建 API 与 Web，避免并发构建扩大内存占用。2G 能否稳定构建和运行取决于实际系统内存、镜像及数据规模，本机未在该规格上实测；若构建内存不足，可在可信的其他机器构建镜像后通过私有镜像仓库部署，或由管理员评估适当的交换空间。上线前记录内存、磁盘、构建和负载测试结果，不能仅凭配置推定满足容量要求。

课程合成数据仅可填入独立预览数据库，需显式组合预览覆盖文件执行；基础 `compose.yaml` 不含 seed 服务：

```bash
docker compose -p andrew-preview -f compose.yaml -f compose.preview.yaml --env-file .env.preview --profile preview run --rm seed
```

正常运行的 `api` 服务仍采用 production 配置并关闭模拟登录；一次性 seed 容器仅在明确组合预览覆盖文件时以 development 模式运行，使用 `SEED_PASSWORD` 登录合成账号。此命令只可指向独立预览数据库，绝不能对实际业务库运行。再次执行不会覆盖已存在的演示数据。

空生产库的首个总部账号：在当前shell用安全方式设置并export ADMIN_USERNAME、ADMIN_PASSWORD（不要把口令字面值写进命令历史），再执行：

```bash
docker compose --env-file .env.compose run --rm -e ADMIN_USERNAME -e ADMIN_PASSWORD api node booking-api/dist/booking-api/src/cli.js create-admin
```

执行后清理临时ADMIN_PASSWORD环境变量。该命令只创建新账号，不重置已有账号，不开放员工公共注册。

小程序构建时设置 `ANDREW_MINI_API_URL=http://127.0.0.1:8080/api/v1` 可在开发者工具中连接本地 Compose。普通手机不能用手机自己的127.0.0.1访问电脑；真机局域网调试需要另行设置可达IP和仅限局域网的监听/防火墙规则，不开放数据库端口。

## Linux HTTPS

小程序默认开发地址为 `http://127.0.0.1:3310/api/v1`，正式构建须指定实际可达的 HTTPS 域名，重新构建并上传；手机上的 127.0.0.1 指向手机自身。微信公众平台需配置 request 合法域名，按实际主体核实域名备案、证书、业务类目和资质，恢复域名及证书检查，再在体验版真机验证。当前 `POST /auth/wechat` 固定返回 501；提供 AppID 或密钥不会自动实现微信身份登录，现有登录为后端账号会话。

独立运行 API 默认不信任代理转发头；Compose 中 API 只信任固定 `BOOKING_WEB_IP`。HTTPS 边缘将客户端提供的 `X-Forwarded-For` 覆盖为实际连接来源，内部 Web 仅信任固定 `BOOKING_HTTPS_IP`，再向 API 传递核验后的来源地址。如果额外接入负载均衡或 CDN，必须重新审视边界并实测，不能直接信任任意转发头。Nginx/TLS 和多个公网客户端的实际限流还须在目标环境验收。

真实患者上线前，应依据实际医疗机构主体和经营范围核实微信服务类目及所需资质，并完善隐私告知、授权、访问控制、账户恢复和运维制度。患者健康及过敏信息属于敏感个人信息，应依[《个人信息保护法》](https://www.miit.gov.cn/jgsj/zfs/fl/art/2022/art_515a4b20c12f430eab54bb4f56d89f56.html)及实际业务核对处理目的、必要性、单独同意、未成年人保护和安全措施。合成医生、患者、参考价格与演示账号不能作为真实业务资料直接上线。

设置.env.compose中的SERVER_NAME为自己域名，CORS_ORIGINS为同一HTTPS来源，TLS_CERT_DIR为安全的证书目录，内含fullchain.pem和privkey.pem；证书、DNS、备案与微信合法域名需由使用者在真实环境配置。

```bash
docker compose --env-file .env.compose --profile https up --no-build -d
```

额外HTTPS边缘Nginx只发布80/443，80跳转HTTPS；443代理Web再转发API。模板仅替换SERVER_NAME，保留Nginx的$host等原生变量。私钥只读挂载，不能提交到Git。小程序配置有效HTTPS request合法域名，恢复证书和域名检查。未提供域名或AppID时不声称这一步已联调。

## 备份、升级和恢复

PG数据保存在命名卷booking-postgres。停止/重启容器不会清空卷；不要使用`down -v`删除业务数据。

Linux主机示例：先在容器内生成custom格式备份，再复制出容器，避免PowerShell旧版对二进制重定向转码：

```bash
mkdir -p backups
docker compose --env-file .env.compose exec postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/andrew-booking.dump'
docker compose --env-file .env.compose cp postgres:/tmp/andrew-booking.dump ./backups/andrew-booking.dump
```

升级前保存备份，添加新编号SQL迁移，不改已经应用的文件。迁移在事务和advisory lock中执行，checksum变化将停止启动。恢复先在独立新库用pg_restore演练，核对数据、外键、排斥约束及预约数量，再规划停服切换；本次不执行覆盖式生产恢复。

真实上线前需要在目标机分别验证：镜像构建、Compose健康、数据库重启、Nginx `nginx -t`、TLS链/域名、微信工具及真机请求、备份恢复、访问控制和日志。当前课程闭环的功能测试不代替这些部署验证。
