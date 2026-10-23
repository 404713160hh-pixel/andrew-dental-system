# 安德鲁牙科预约系统

本次交付是 **微信原生小程序 + Vue 3 工作台 + TypeScript/Fastify API + PostgreSQL 17** 的预约闭环。两端使用同一 `/api/v1` 后端和 PostgreSQL，不读取旧 SQLite。

设计依据为 [300页设计文档](docs/design/安德鲁牙科系统设计文档.pdf)，SHA-256 `22483aee6c2ca681937bb667868e25c85f97f85dbc8e11f5dd6da3d6ce2ee3eb`。本次实现 UC-01～07 的预约核心，不声称已实现全部24个用例。完整设计目标与本次交付范围见[设计审查](docs/implementation/design-review.md)。

## 本地运行

需要 Node.js 24、npm 11。先在此仓库执行 `npm ci`。以下终端均在仓库根目录：

```powershell
# 终端1：独立、持久的真实 PostgreSQL，只监听127.0.0.1:55432
npm run dev:postgres
```

首次运行生成未入库的 `.env.booking`，含随机数据库及演示密码；已有数据与凭据保留。Windows中文路径的原生PG二进制和数据放入ASCII缓存目录，具体位置记录于 `.booking-data/postgres-location.json`。可用环境变量 `ANDREW_PG_HOME` 指定ASCII目录。**保持该终端运行**，Ctrl+C安全停库，重新执行后数据仍在。该工具只供本地开发，不用于公网部署。

```powershell
# 终端2：迁移、合成演示数据和新API
npm run db:migrate
npm run db:seed
npm run dev:api
```

```powershell
# 终端3：员工工作台
npm run dev:admin
```

访问 **http://127.0.0.1:5173**。API健康检查：`http://127.0.0.1:3310/api/v1/health`。工作台开发快捷登录选总部、前台、店长或医生；账号由后端动态给出，非前端绕过鉴权。脚本生成的开发配置允许演示登录，生产配置默认关闭且禁止开启。密码登录使用本地 `.env.booking` 中的 `SEED_PASSWORD`，不要公开该值。

```powershell
# 微信原生小程序：构建后，微信开发者工具导入 miniprogram 目录
npm run build -w @andrew/miniprogram
```

AppID/API地址、游客模式、开发合法域名设置、真机局域网连接及正式HTTPS域名见[小程序说明](miniprogram/README.md)。小程序端真实登录由后端处理；没有真实AppID/AppSecret时，使用开发演示账号或密码注册登录，不宣称完成微信授权。

### 演示数据

内置两家合成门诊、两位医生、检查/咨询两类项目、每店两把牙椅，以及从初始化日期后第2天起连续7天的班次。首页当天没有可预约时段属于正常情况，请在日期选择器选择这些未来日期，或由工作台发布新班次。Seed幂等，不覆盖已有库；长期演示可继续发布未来班次。

账号：患者 `patient.a`、`patient.b`；员工 `hq`、`front.a`、`manager.a`、`doctor.a`。这些是合成账号标识，口令从环境配置获得。无账号情况下可在患者端注册完整资料，手机号仅用于联系，不承担患者唯一身份。

## 已实现范围

- 患者后端注册/登录/退出、本人资料、联系方式、三态过敏与逐项明细、版本冲突检查。
- 门诊、服务、资格、医生、牙椅维护；医生资格有效期、班次开放服务、跨店时间与转场缓冲校验。
- 后端按门诊/服务/日期/医生计算号源，计入服务时长、缓冲、牙椅停用、正式预约与有效占位。
- 服务器短时占位、带幂等键的正式确认、本人查询、带原因取消、原子改期与前后记录追溯。
- 前台核对患者后代约/取消/改期；总部共享资源权限，店长本院管理，医生仅本人班次和预约。
- SQL事务、固定顺序资源锁、三类时间排斥约束、跨表一致性约束、审计及操作回执。
- 网络写入结果未知时保留原请求和原键，核对或重试同一操作，不能生成假成功记录。

默认保留300秒、取消/改期提前120分钟、跨店转场30分钟；它们是可配置的演示规则，不是调研得出的统一行业规定。取消规则随预约保存快照。过敏未知不自动拒绝预约，不能被解释为“明确无过敏”。同一账号当前只管理本人，家庭成员共享账号、微信授权、正式通知等未实现。

**本次未迁移**：诊疗病历、支付/退款、发票、药品/耗材库存、日结、跨店财务、季度业绩与基金。旧版这些代码仍属legacy，不是新架构已实现能力。

## 验证

```powershell
npm run check:booking
npm run build:booking
npm run test:booking
npm run test -w @andrew/admin-web
npm run test -w @andrew/miniprogram
npm test
```

预约集成测试创建独立随机 `andrew_test_*` PostgreSQL数据库，结束只清理自己新建的测试库，绝不清空开发库。需要本地测试服务器创建数据库权限；没有PostgreSQL时明确失败，不回退成Mock。新建开发库、迁移与测试均不接触原SQLite。

[验收记录](docs/implementation/acceptance.md)区分真实PG/API验证、浏览器验证、原生模块HTTP验证，以及尚需人工完成的微信开发者工具/真机/Docker/TLS测试。[测试设计](docs/implementation/test-design.md)列出并发、幂等、回滚和权限断言。

## 目录与接口

```text
miniprogram/           微信原生TS/WXML/WXSS（导入本目录，构建到dist）
admin-web/             Vue3 + Router + Pinia + Vite + Element Plus
booking-api/src/       DTO验证、路由、Service、Repository与事务
shared/src/index.ts   两端和API共享的传输类型
database/migrations/   版本化PostgreSQL迁移（带checksum，已应用文件不可改）
scripts/               本地PG工具与可复现验证
deploy/booking/        API/Web镜像、Nginx HTTP/HTTPS
docs/implementation/   审查、API、架构、运行和验收记录
server/ public/ test/  原SQLite/Web实现与回归参照，完整保留
```

新入口放在 `booking-api`，以免迁移前移动或覆盖 `server`。新架构只运行PostgreSQL，两套数据库之间不做双写，也不默认迁移业务数据。详见[API契约](docs/implementation/api.md)、[架构与迁移边界](docs/implementation/architecture.md)。

## Docker、HTTPS与Linux迁移

见[部署步骤](docs/implementation/deployment.md)。默认 `compose.yaml` 现指向新PostgreSQL/API/Web，数据库没有宿主端口映射。生产不自动Seed，不自动开启测试登录。旧Compose备份在 `deploy/legacy/compose.yaml`，旧运行说明在[legacy README](docs/legacy/README-3.1.md)；旧代码仍可用 `npm start` 在3210端口运行，但与新客户端无业务连接。

首次部署生产空库可用环境变量 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 运行后端 `cli.js create-admin` 初始化总部账号；不存在公开员工注册接口。不要使用合成演示库承载实际患者数据。
