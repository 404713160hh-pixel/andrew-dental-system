# 本次预约系统验收

记录日期：2026-10-23（Asia/Shanghai）。范围为课程演示预约闭环及本轮人物/参考价扩展；43项后端测试、原生模块测试与浏览器验证均针对新PostgreSQL架构。真实微信授权、真机与公网医疗运营不在已验收结论内。

## 阶段成果

| 阶段 | 已完成 | 真实验证 |
| --- | --- | --- |
| 1 源码及设计审查 | 正确300页PDF/哈希、UC01–07/第7–9章、旧模块差异、独立分支、保留legacy | 旧版54项隔离测试通过；91份旧源码文件哈希未变 |
| 2 PG与后端核心 | 版本迁移、合成seed、DTO、后端身份/权限、目录、占位/确认/取消/改期、回执/审计 | PostgreSQL17.10 + Node24.15，43/43真实数据库/API测试通过（含13项演示扩展） |
| 3 Vue员工端 | 真实登录、机构/医生/资格/服务/牙椅、排班、患者核对建档、代约及预约管理 | 真实Chrome浏览器端到端，详见browser-acceptance.md与qa/browser.json |
| 4 微信原生端 | 十个原生页面、医生浏览、24项参考价、虚构标识、资料/过敏、占位预约/取消/改期、未知写入恢复 | strict构建；17项客户端逻辑、20项生成原生模块经真实HTTP调用通过 |
| 5 联调与交付 | 两端同源、并发/幂等/回滚/撤权、运行与部署文档 | 真实PG停止/重启+API重启后数据哈希相同；Compose官方schema静态校验通过 |

## 用户要求的12项验收对应

| 项目 | 结论与证据 |
| --- | --- |
| 1 患者登录仅本人 | API会话、本人profile、他人详情/写入拒绝；后端集成测试 |
| 2 Vue新增排班→号源 | 浏览器UI真实发布，后端号源返回同一班次；原生模块也验证共享数据 |
| 3 预约落PostgreSQL | 预约confirmed、统一占用booked、事件及回执在事务内持久化 |
| 4 Vue可见同笔 | 前台浏览器查询展示患者API新建的同一预约编号 |
| 5 两患者竞争最多一人 | 真实并发同slot只成功一份占位/预约，SQL排斥约束另测医生/牙椅/患者 |
| 6 重复请求一笔 | 十次同键并发一条预约；异体同键409；响应丢失后两端客户端原键恢复 |
| 7 取消后资源可用 | API与浏览器取消保留历史、原因、事件并重新查询到原时段 |
| 8 改期失败不丢旧约 | 失效目标拒绝；旧资源已释放后的数据库故障也整体回滚，无半写事件/审计/回执 |
| 9 患者不可访问他人 | API越权404；客户端跨账号pending、缓存和迟到回包隔离 |
| 10 医生跨店冲突拒绝 | 班次数据库排斥、医生行锁与跨店转场检查，原班次保留 |
| 11 PG和服务重启持久 | qa/persistence.json记录不同postmaster启动时间，数据哈希/数量和同笔API结果一致 |
| 12 匿名/越权受保护接口拒绝 | 401/403/404契约、角色及门诊范围；撤权后旧回执和恢复接口也拒绝 |

## 可复现的命令

先启动独立本地PG（根README），再执行：

```powershell
npm run check:booking
npm run build:booking
npm run test:booking
npm run test -w @andrew/admin-web
npm run test -w @andrew/miniprogram
npm test
npm run check:deploy
```

浏览器E2E在API3310与Vite5173运行时执行 `npm run test:booking-browser`；需要本机Chrome，脚本创建明确前缀的合成夹具，最后按精确ID收尾，不修改已有业务对象。浏览器页面、请求和数据库不是静态Mock。

原生客户端HTTP验证（在演示API上显式允许创建合成夹具）：

```powershell
$env:MINIPROGRAM_SMOKE_ALLOW_CREATE='1'
$env:MINIPROGRAM_SMOKE_EXPECT_DEMO_CATALOG='1'
npm run test:mini-api
Remove-Item Env:MINIPROGRAM_SMOKE_ALLOW_CREATE
Remove-Item Env:MINIPROGRAM_SMOKE_EXPECT_DEMO_CATALOG
```

本轮目录检查要求先运行db:demo。此过程使用生成的原生CommonJS模块和wx.request→fetch适配器，不运行微信渲染器，不能称为微信开发者工具或真机测试。小程序README提供完整人工步骤。

持久性复现请在其他测试停下时执行before，实际重启PG和API，再after；不要和正在跑的随机测试库进程并行重启数据库：

```powershell
npm run test:persistence:before
# Windows本地工具：node scripts/local-postgres.mjs --restart
# 再停止并重新启动新API；Linux/Compose使用对应实际服务重启命令
npm run test:persistence:after
```

## 证据与限制

- `qa/api-integration.json`：43项真实PG/API，包含旧种子升级、幂等增量、权限、深度回滚及锁等待验证。
- `qa/browser.json`：真实Chrome操作、请求关联和夹具收尾；截图在Git忽略的screenshots/booking目录。
- `qa/persistence.json`：实际PG/API重启，非仅关闭一条连接。
- `qa/compose-validation.json`：官方JSON schema和数据库无宿主端口等静态断言，**未执行Docker容器或TLS**。
- `qa/legacy-protection.json`：旧代码91份哈希未变与54项隔离回归。
- `miniprogram/qa/client-unit.json`、`native-api-smoke.json`：当前原生产物哈希及17/20项结果。
- `qa/demo-data-preservation.json`：开发库本轮增量及联调后，原20笔预约、40条事件未变；普通同名资料另由隔离集成测试验证。
- `qa/wechat-devtools.json`：官方CLI实际尝试受工具服务端口设置阻断，未计为原生编译通过。

本机已安装微信开发者工具2.02.2609231；CLI初始化提示“服务端口已关闭”，没有完成工具内编译、渲染或真机。尚未运行Docker容器镜像、Nginx/TLS、真实wx.login或正式域名。交付了对应配置和[下一步操作](DEMO-NEXT-STEPS.md)，未把这些环节记为通过。GitHub CI配置已提供，本地测试不等于远程CI已执行。

未做线上支付、诊疗、财务、消息服务、容量或恢复SLA验收。旧SQLite资料和业务代码没有被新系统覆盖，未做真实患者数据自动搬迁。课程演示使用合成资料。
