# 3.0接口约定

同源JSON API；时间存ISO时间，页面按Asia/Shanghai显示；金额均为整数分。角色只有customer、front、clinical、manager。

## HTTP接口

| 方法/路径 | 内容 |
|---|---|
| GET /api/health | 服务存活及数据库连接检查 |
| GET /api/portal-config | 是否显示合成数据演示入口 |
| POST /api/login | username/password/portal；身份必须与入口一致，返回user/csrfToken及HttpOnly会话Cookie |
| POST /api/register | portal=customer、username/password/name/phone；已有电话档案拒绝重复创建，转机构核验绑定 |
| GET /api/session | 当前身份与CSRF |
| GET /api/workspace | 按页面、范围、过滤及分页读取 |
| GET /api/state | 兼容验证快照，日常前端不用此接口刷新 |
| POST /api/command | type/payload；会话、CSRF、岗位与对象范围校验后事务执行 |
| POST /api/logout | 撤销当前会话 |
| POST /api/password-recovery/request | username/portal；portal为customer、front、clinical或manager，无论是否存在账号均给统一结果，机构随后核验 |
| POST /api/password-recovery/consume | token/newPassword；10分钟单次凭证，成功撤销全部旧会话，不自动登录 |
| GET /api/backup | 店长业务JSON导出，包含账簿/附记/别名，不包含账号口令/会话/恢复凭证；不能用于完整恢复 |

POST写入要求application/json。已登录修改要求X-CSRF-Token。错误为error/code，服务器错误附requestId；不回传SQL、文件路径或堆栈。

## 按页查询

`page` 为home/profile/booking/appointments/history/patients/visits/settlements/resources/performance/audit/settings/accounts/finance。后端独立限制各岗位可读页面。

通用limit默认25，最大100，offset为非负整数。q为患者/账号搜索；clinicId/dentistId/status/date/from/to为相关页面筛选；date按北京时间自然日，from含、to不含。resource指定clinics/dentists/qualifications/treatments/schedules；quarter为YYYY-Q1到YYYY-Q4。booking.patientId仅取已授权患者。accounts.accountRef用于精确定位核验对象。

返回user/now/settings及当前页面需要的数组、关联lookup、pagination:{entity,total,limit,offset}。home.stats及metrics由SQL聚合，不用当前页样本推算全量统计。settlements.pendingOffset/pendingPagination独立分页未开单就诊；finance.reconciliationOffset/reconciliationsPagination独立分页营业日核对。

## 核心业务指令

患者：patient.lookup、patient.save。资源：clinic.save、dentist.save、qualification.save、schedule.save、treatment.save。预约：appointment.book、appointment.cancel、appointment.reschedule、appointment.status。诊疗：visit.save、visit.complete。开单：settlement.create。季度：cost.save、cost.review、quarter.compute、quarter.approve。规则：settings.save。

对象更新提交id及expected version（字段名version），冲突409。数据对象仍采用与页面一致的camelCase；存储层使用关系型列和子表，不要求客户端知道SQL结构。

## 补齐的业务指令

| type | payload与规则 |
|---|---|
| payment.record | settlementId,amount,method(cash/bank/pos),reference,reason,idempotencyKey；人工核对后登记，不超过欠款 |
| payment.refund | paymentId,amount,reference,reason,idempotencyKey；仅店长，不超过原款剩余可退金额 |
| settlement.void | id,version,reason；仅店长，先完整退款，追加冲销而保留原单 |
| reconciliation.preview | clinicId,businessDate；读取北京时间当日渠道净额 |
| reconciliation.record | clinicId,businessDate,observedCash/Bank/Pos,reference,reason；有差额需原因，修订追加，来源变更标记stale |
| visit.addendum | id,version,reason,content；完成后的本人接诊或店长，追加作者/时间/原版本，不覆盖原记录 |
| patient.merge | sourceId,targetId,sourceVersion,targetVersion,reason,identityEvidence；店长核验，保留别名并迁移引用，有身份或账号冲突拒绝 |
| account.bindCustomer | patientId,version,username,password,identityEvidence,reason；机构核验已有患者后绑定，不允许公开认领 |
| account.create | username,name,role,clinicIds(front)或dentistId(clinical),password；店长分配员工 |
| account.assign | id,version,clinicIds或dentistId,reason；调整归属，撤销会话 |
| account.status | id,version,status(active/disabled/departed),reason；自停与最后店长保护，离职账号不重新启用 |
| password.change | currentPassword,newPassword；验证原密码，撤销全部会话，重新登录 |
| account.issueRecovery | id,version,identityEvidence,reason；店长核验后签发，只显示一次token，由机构交付 |

财务流水、附记、归并及核对记录不可覆盖或删除。季度收入保留有效开单口径，冲销使报告来源失效；实际收退款在独立账簿核算。

## 幂等与安全

同一逻辑业务命令携带16至128位Idempotency-Key；同一用户相同key及相同内容重放原结果，不同内容409。财务payload.idempotencyKey另有独立保护命名空间，前端沿用同一逻辑UUID。响应不明时只用原始请求标识重试。

恢复码响应不进入幂等结果缓存，再次请求同一签发key返回409并要求重新核验签发；该409本身不会撤销已签发凭证，新的签发成功后旧凭证才失效。密码、token、csrf、secret不进入业务审计。账号停用、离职、改密、恢复及归属调整撤销相应会话。
