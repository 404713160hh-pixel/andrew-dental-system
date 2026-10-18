# 独立部署、升级与恢复

本目录是完整应用根目录，与课程根旧Clearbrook项目无依赖。部署实例必须是单个Node服务，数据库采用本机持久化SQLite文件。以下是已提供的部署配置；实际域名、证书及云环境仍需目标环境验收。

## 发布前

执行npm ci、npm run build、npm run check、npm test、npm run test:maintenance、npm run test:browser及npm run release:manifest。只上传本目录中的源码、构建资源、文档及清单；不要上传数据库、升级快照、备份、环境秘密和测试产物。CI文件位于.github/workflows/ci.yml；本地通过不代表远端CI已执行。

## 环境配置

| 变量 | 配置 |
|---|---|
| NODE_ENV | 正式环境production |
| HOST/PORT | 本机反代用127.0.0.1/3210；容器监听0.0.0.0 |
| PUBLIC_ORIGIN | 准确HTTPS origin，多值逗号分隔，不能带路径 |
| COOKIE_SECURE | 正式环境1 |
| DENTAL_DB_PATH | 持久化且可写的数据目录，不放临时层 |
| DENTAL_SEED_DEMO | 正式新库0，关闭示例与演示按钮 |
| DENTAL_PUBLIC_DEMO | 仅公开合成数据演示时显式1，不得混入真实资料 |
| DENTAL_TRUSTED_PROXIES | 需要真实代理IP限流时填写确切可信代理地址，不信任任意来源的转发头 |

源码不会自动读取.env。可由进程管理器注入；或显式node --env-file=.env.local server/index.js。Compose从部署者的环境读取PUBLIC_ORIGIN；.env.example不含密钥。正式环境配置不完整会在打开数据库之前拒绝启动。

## 初始店长

先设置DENTAL_SEED_DEMO=0及DENTAL_DB_PATH。通过临时DENTAL_ACCOUNT_PASSWORD环境变量输入机构选择的强密码，再运行：

```text
node tools/accounts.mjs create-staff owner manager
```

完成后删除该密码环境变量。CLI不生成示例数据。店长登录后录入诊所、资格、医生、治疗和排班，再分配员工。顾客已有档案时走机构核验绑定；不能以知道电话为由直接认领。

## Docker与HTTPS

Dockerfile固定Node 24.15.0，非root用户运行。compose.yaml提供app与backup服务、数据与备份卷、健康检查、日志轮转和优雅停止。部署者设置PUBLIC_ORIGIN后执行docker compose up -d --build；容器端口只绑定宿主回环地址。

宿主使用deploy/nginx.conf的模板，替换域名及证书路径后核验nginx配置。代理保留Host并覆盖转发头。证书签发和域名解析属于部署环境步骤，配置文件存在不代表公网已成功。

## 升级

1. 保存代码版本和当前完整SQLite快照。
2. 停止旧Node服务。PID锁会拒绝运行中升级；容器操作应明确停止app，而不是依赖不同容器间的PID检查。
3. 启动新代码。旧JSON库自动生成pre-migration快照，在同一事务内转换表与子表并检查外键。
4. 失败会回滚；不要编辑已应用迁移来跳过checksum。后续结构变化应追加新版本。
5. 完成登录、权限、业务流程和重启持久化检查，再开放入口。

## 备份与恢复

```text
node tools/database.mjs backup <新的快照文件>
node tools/database.mjs restore <快照文件> --offline
```

恢复先校验必要结构，再在临时副本上迁移并检查外键，成功后保留旧库并替换。旧版16表快照可在副本升级为38表；新版缺表快照拒绝。恢复撤销会话与恢复凭证，避免旧Cookie恢复生效。

backup侧车默认每6小时使用VACUUM INTO生成一致快照，只在成功后按规则保留最新28份，不删除手工命名备份。工具可用--once验证一次。数据库与备份在不同卷，但仍需机构另行配置异地存储及灾难恢复；同机卷不等于异地灾备。

## 验收边界

本轮本地验证见REFACTOR-ACCEPTANCE.md。本机没有Docker引擎，因此没有实际执行镜像构建、Compose启动、Nginx或证书联调；也未执行GitHub推送和远端Actions。人工收退款记账不代表外部支付接口，机构恢复凭证不代表短信送达。正式上线需目标平台和实际使用人员验收。
