# 安德鲁牙科就诊与运营系统

当前版本 **3.1.0**。五个独立岗位门户，共享关系型 SQLite 数据库及 Node.js 后端；总部统筹连锁，店长管理机构分配的授权门诊。

课程设计成果：[安德鲁牙科系统设计文档.pdf](docs/design/安德鲁牙科系统设计文档.pdf)（2026-10-22 修订版，300 页）。文档围绕安德鲁牙科连锁案例，包含业务用例与详细流程、系统分析与设计、数据库模型及实施边界。2026-10-20 版 PDF 与其交付清单保留为历史材料；当前版本说明见[设计文档交付说明](docs/design/README.md)。

`docs/design/source/` 保留上一版可编辑源材料和图稿，尚未同步到本次 PDF 的内容模型，不能据此重建本修订版。设计文档描述目标方案；应用现状与真实环境验收状态以本仓库代码和对应验收记录为准。

- 顾客：`/customer/login`
- 前台：`/frontdesk/login`
- 医生：`/doctor/login`
- 店长：`/manager/login`（授权门诊）
- 总部：`/hq/login`（全部门诊）

## 本地启动

需要 Node.js **24.15.0** 或经过完整回归的兼容版本。

```powershell
cd andrew-system
npm ci
npm run build
npm start
```

访问 `http://127.0.0.1:3210/customer/login`。默认本机演示首次创建合成患者与五个演示账号 `chen`、`front`、`doctor`、`manager`、`hq`，密码均为 `Dental2026!`。员工入口没有公开注册。已有数据库不会重置；旧版结构自动迁移前会保存完整快照，运行中的旧服务会阻止升级。

正式新库设 `DENTAL_SEED_DEMO=0`，关闭演示数据与演示入口。该开关不会删除已有演示账号，正式数据必须使用独立数据库。首个总部账号通过 `tools/accounts.mjs create-staff owner hq` 初始化；总部登录后创建门诊，再为店长分配明确的门诊范围。

## 已实现的业务

- 患者资料、结构化过敏申报与工作人员核实；身份核验后查询、绑定顾客账号、版本受控归并与历史别名。
- 排班、预约、改期、取消、到诊、爽约更正；跨门诊牙医冲突与患者时间冲突检查；失败改期回滚。
- 治疗明细与价格快照、就诊完成冻结、带作者/时间/原因的不可覆盖附记。
- 费用开单、人工核对收款、欠款余额、原款限额退款、保留原单的冲销、按北京时间核对营业日资金与差额、来源变化失效提示。
- 成本录入审核、季度报告及基金测算；收入明确采用有效开单口径，另有收款账簿，不将两者混用。
- 员工创建、归属调整、启停与离职；撤销旧会话、保留有效总部账号、本人改密、机构核验后的限时单次恢复凭证。

现金/银行/POS 均为工作人员核验凭证后的人工记账，代码不执行银行转账或线上支付；恢复凭证由机构核验后交付，未接入短信。尚未提供完整牙位病历、影像、处方、知情同意、医保及正式票据，也未经真实临床或公网容量验收。

## 代码结构

```text
public/app.js                 浏览器入口
public/js/core/               API、状态、门户、格式、事件
public/js/components/         外壳、表单、弹窗、分页
public/js/pages/              患者、预约、诊疗、结算、财务、账号等页面
public/css/                   九个可维护样式源文件
public/styles.css             构建生成的CSS，修改源文件后重新构建
server/index.js               HTTP入口与路由
server/http/                  会话、限流、请求幂等、部署配置校验
server/policies/              五岗位权限
server/services/              独立业务服务与按页查询
server/repositories/          明确字段映射、批量关联、条件查询
server/migrations/            带版本及checksum的事务迁移
server/schema.sql             初始关系型结构，不可修改已应用迁移
server/data/                  默认数据库及升级快照，Git忽略
```

当前38张表。十二类核心业务对象采用明确类型列，过敏、资格、治疗行、结算行、报告行等采用关系子表。`users.data` 保留身份对象兼容格式，同时以同步列和索引提供查询；审计及请求重放结果使用JSON快照。

日常前端使用 `/api/workspace` 按页面、筛选及分页读取，主区更新保留导航外壳。`/api/state` 保留给兼容验证；不用于日常整包刷新。写入检查权限、范围与版本，并支持同一逻辑操作幂等重放。

## 验证与维护

```powershell
npm run check
npm test
npm run test:maintenance
npm run test:browser
npm run test:load
npm run release:manifest
```

首次使用自动浏览器测试可运行 `npx playwright install chromium`。Windows已有Edge时可设置 `$env:DENTAL_BROWSER_CHANNEL='msedge'`。浏览器测试使用独立临时数据库和3227端口，结束后清理临时库；容量测试使用内存合成数据。

```powershell
node tools/database.mjs backup
node tools/database.mjs restore <快照路径> --offline
```

恢复必须停服，先检查完整结构与外键，再在临时副本上迁移，成功后替换；保留旧库并撤销会话和恢复凭证。完整恢复使用SQLite快照；网页业务JSON导出包含财务和附记等业务资料，不含账号口令及恢复凭证，不是灾备恢复文件。

员工初始化、改密码时用临时环境变量传入密码，完成后删除环境变量，不提交到Git。CLI不会自动填充演示数据。

## 文档与发布

- [架构说明](ARCHITECTURE.md)
- [接口约定](API-CONTRACT.md)
- [部署和恢复](DEPLOYMENT.md)
- [本轮验收](REFACTOR-ACCEPTANCE.md)
- [课程设计 PDF](docs/design/1602240215.pdf)

`npm run build:docs` 生成仓库内 `docs/site/index.html`，通过 `/docs/index.html` 访问，不依赖课程根目录的旧项目或PDF文件。Docker、Compose、反向代理示例及GitHub Actions均位于本目录。可以将本目录作为独立仓库根目录，不包含工作区旧Clearbrook项目。

`RELEASE-MANIFEST.json` 是当前源码发布哈希清单；较早 `SHA256.json` 仅保留在本地，`ACCEPTANCE` 和设计自查文件按原日期保留为历史证据，不代表当前版本。数据库、快照、环境秘密、依赖目录和测试产物均排除发布。
