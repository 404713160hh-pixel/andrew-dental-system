# 新预约架构与迁移说明

## 基线与工程决策

2026-10-22 的历史开发起点为 `c1e3779`，当时的开发分支为 `feat/postgres-booking-20261022`；这不是当前分支或当前 HEAD 的声明。开始时工作区干净，HEAD/status/diff与旧server/public/test/tools哈希保存于工作区外层 `tmp/booking-baseline-20261022`。原SQLite数据目录没有迁移、覆盖或删除。当前实现和证据见[设计与开发核对](design-implementation-status.md)。

需求为设计PDF中的UC-01～07及第7～9章，本次仅实现预约业务。设计原始案例和目标方案的关系不由旧程序反推；新旧差异见设计审查与legacy审查。

选择Fastify模块化单体：同一进程提供认证、目录、排班与预约API，利用成熟的HTTP生命周期、结构化日志与测试注入；无需分布式事务或微服务。输入使用Zod DTO验证，数据库访问使用`pg`参数化SQL，使范围查询、排斥约束和锁语义可直接审阅。Vue 3/TypeScript与原生微信TS只通过REST交互，不持有数据库连接。

## 调用与职责

`患者小程序 / 员工Vue → /api/v1 → DTO + 鉴权 → 业务Service → Repository/事务工具 → PostgreSQL`

- `src/app.ts`注册HTTP契约、范围保护、标准响应与读接口；没有浏览器数据伪造。
- `src/validation.ts`输入DTO与跨字段校验；`shared`是两客户端共享的wire类型。
- `src/auth.ts`会话、角色范围、密码散列和审计；随机Bearer令牌仅存SHA-256摘要，密码为随机盐scrypt。
- `services/booking.ts`占位/正式确认/取消改期/幂等；`services/resources.ts`资源维护与排班规则。
- `repositories/catalog.ts`、`repositories/booking.ts`批量条件查询与关联映射；`db.ts`连接池、事务重试及checksummed迁移。
- 所有动态值走绑定参数；仅内部白名单列名参与SQL构造。

## 物理模型与并发

本次不预建全部59张目标表。核心关系包括用户/患者/逐项过敏/员工岗位授权、门诊、专业资格及医生资格、服务及所需资格、门诊服务、牙椅/停用区间、医生班次/开放项目、预约占位、正式预约/事件、命令回执/审计/会话。

额外`resource_reservations`作为占位与预约统一占用账本。两个独立表各自有排斥约束不能拦住“占位与正式预约跨表竞争”，因此三类资源约束统一放在这张表：医生、牙椅、患者的 `tstzrange(starts_at,occupied_until,'[)')` 不得相交。医生班次另有跨店时间排斥约束；`btree_gist`组合UUID和时间范围。实际服务结束与含缓冲的占用结束分别保存。

到期不写成`WHERE expires_at>now()`索引条件。查询按服务器时钟排除过期hold；写事务先将过期占用标为expired。确认同事务撤销hold状态、将预留转为booked、写唯一预约/事件/回执。延迟约束检查占位、预约与占用归属一致，成功响应只在COMMIT后返回。

资源加锁顺序为患者→医生（UUID排序）→牙椅（UUID排序），目录和班次以共享锁复核。医生跨店班次发布锁医生，检查排斥与转场缓冲。资格按所需项目全部满足且覆盖完整服务占用区间。

改期先持有一个不与原约重叠的新占位；在单事务锁定新旧资源、版本检查、旧约转rescheduled和释放、新占位转正式、新旧关联。任何失败全部回滚，原约保留。当前不提供与原有效约重叠的目标号源；不存在先取消旧约再另发请求的窗口。

`command_receipts`以(user_id,command_key)唯一，事务级advisory lock序列化同键，规范化请求摘要拒绝同键异体。查询原键可恢复已提交结果；not_found不证明仍在途请求永远不会提交，因此客户端保留原键重试。

## 权限与数据边界

患者只可读写本人，预约详情越权返回404。员工身份由后端会话与岗位授权计算，总部全链，店长本院资源/排班，前台代约/变更，医生只读本人班次及预约。员工目录检索普通岗位必须输入完整姓名或电话，不能空查全链患者；首次就诊需要显式核对身份。

总部维护全局医生/资格/服务；店长可选择活动医生发布自己门诊班次，但不能编辑全局医生资料。前台和医生不能通过更换前端路由获取总部写权限。手机号没有唯一约束，不通过手机号认领患者。

预约状态只有confirmed/cancelled/rescheduled；attendance独立保留not_recorded，表示本次未实现到诊与诊疗流程。费用只是项目展示与快照，不表示已收款或支付集成。

## 旧版保护和发布

`server/ public/ test/ tools/`旧源码保留，54项legacy回归可继续运行。新的入口、端口、环境文件、PostgreSQL数据目录与Docker卷均独立。旧财务等不在本次迁移范围；没有SQLite→PostgreSQL双写或自动导入。

新增迁移一旦应用不可修改，通过后续编号迁移升级。模拟seed仅允许非生产环境，并且已有总部演示账号时不重置。实际业务数据若日后需要迁移，必须另做备份、字段映射、校验和演练，本次未提供未经核对的自动搬迁脚本。

公开技术依据：
- PostgreSQL时间范围与排斥约束：https://www.postgresql.org/docs/17/rangetypes.html
- Fastify TypeScript/验证：https://fastify.dev/docs/latest/Reference/TypeScript/
- Vue TypeScript：https://vuejs.org/guide/typescript/overview.html
- Docker服务就绪依赖：https://docs.docker.com/compose/how-tos/startup-order/
- 本地原生PG工具：https://github.com/leinelissen/embedded-postgres
