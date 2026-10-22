# 本地、Docker与HTTPS部署

## 本地开发

优先按根README的3终端命令启动。`npm run dev:postgres`是真实PostgreSQL，不是SQLite模拟。Windows中文目录通过独立ASCII缓存保存原生工具与PG数据，具体路径在`.booking-data/postgres-location.json`，随机口令保存在被Git忽略的`.booking-data/local-postgres.json`与`.env.booking`。这些私密文件不输出到日志、不打包、不入库。

如已有自己的PostgreSQL，复制`.env.booking.example`为`.env.booking`，填写正确DATABASE_URL（密码URL编码）；不要运行本地内置PG工具，以免误连其他库。新建独立数据库后执行迁移和非生产seed。生产业务账号不应有创建测试数据库的权限，集成测试使用专门本地测试服务器。

## Docker Compose

本机若没有Docker，下面的配置可以静态校验，但不能把它写成容器实测通过。需要目标机安装Docker Engine与Compose v2，项目默认Compose已改为新预约架构。旧Compose留在deploy/legacy，默认不会启动旧SQLite。

1. 复制`.env.compose.example`为`.env.compose`。
2. POSTGRES_PASSWORD使用随机十六进制字符串（便于构造连接URL）；SEED_PASSWORD使用另一个随机12位以上值，不使用模板占位符。
3. 检查环境变量文件不入库。避免直接把带秘密的`docker compose config`输出保存到日志；检查可用`config --quiet`。

```bash
docker compose --env-file .env.compose config --quiet
docker compose --env-file .env.compose up --build -d
```

启动顺序：PostgreSQL健康→一次性checksummed迁移成功→API→Nginx/Web。数据库只在Compose内部网络，没有宿主5432端口；API也不直接映射公网。员工界面通过127.0.0.1:8080的Nginx访问同源API。

课程合成数据需显式执行：

```bash
docker compose --env-file .env.compose --profile demo run --rm seed
```

API仍采用生产配置，关闭模拟登录，使用SEED_PASSWORD密码登录合成账号。seed不得对实际业务库运行。再次执行不会覆盖已存在的演示数据。

空生产库的首个总部账号：在当前shell用安全方式设置并export ADMIN_USERNAME、ADMIN_PASSWORD（不要把口令字面值写进命令历史），再执行：

```bash
docker compose --env-file .env.compose run --rm -e ADMIN_USERNAME -e ADMIN_PASSWORD api node booking-api/dist/booking-api/src/cli.js create-admin
```

执行后清理临时ADMIN_PASSWORD环境变量。该命令只创建新账号，不重置已有账号，不开放员工公共注册。

小程序改为`http://127.0.0.1:8080/api/v1`后重新构建，可在开发者工具中连接本地Compose。普通手机不能用手机自己的127.0.0.1访问电脑；真机局域网调试需要另行设置可达IP和仅限局域网的监听/防火墙规则，不开放数据库端口。

## Linux HTTPS

设置.env.compose中的SERVER_NAME为自己域名，CORS_ORIGINS为同一HTTPS来源，TLS_CERT_DIR为安全的证书目录，内含fullchain.pem和privkey.pem；证书、DNS、备案与微信合法域名需由使用者在真实环境配置。

```bash
docker compose --env-file .env.compose --profile https up --build -d
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
