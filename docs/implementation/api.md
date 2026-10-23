# 预约API契约（/api/v1）

正式wire类型位于 `shared/src/index.ts`。输入由 `booking-api/src/validation.ts` 校验；业务值不能靠TypeScript类型绕过后端检查。时间为带时区ISO8601，数据库timestamptz，营业日期按Asia/Shanghai解释。资源占用区间左闭右开，包括项目时长及准备缓冲。

## 通用约定

- `Authorization: Bearer <后端签发token>`。患者/员工登录入口由portal区分，不接受前端传角色或任意用户ID当认证。
- 成功：`{ "data": ..., "requestId": "UUID" }`。
- 错误：`{ "error": { "code": "VERSION_CONFLICT", "message": "...", "details": [...] }, "requestId": "UUID" }`。
- 分页：`{items,total,page,pageSize}`，page从1开始，pageSize默认20、最多100。
- 确认/取消/改期必须 `Idempotency-Key`（8～128位字母/数字/横线/下划线，推荐UUID），同主体同键同体返回第一次已提交的结果，同键异体返回409 `REQUEST_KEY_REUSED`。
- `expectedVersion` / `holdVersion` 为正整数；不接受只靠前端判断的“已占用/已取消”标志。
- 写请求只接受契约字段，`id`/`rowVersion`不是资料保存字段；更新传`expectedVersion`。

## 身份与本人资料

| 方法与路径 | 认证 | 输入/结果 |
| --- | --- | --- |
| GET /health | 公开 | 实际查询PG连通性，`{status:'ok',database:'postgresql'}` |
| GET /auth/config | 公开 | 开发模拟登录开关、动态演示账号、微信登录是否启用 |
| POST /auth/login | 公开 | `{username,password,portal:'patient'|'staff'}` → `LoginResult` |
| POST /auth/demo | 仅显式开发配置 | `{username,portal}`，只允许后端内置合成账号，真实建立会话 |
| POST /auth/register | 公开 | `{username,password,profile:PatientInput}` → 患者会话；用户名3～80合法字符、密码至少12位 |
| POST /auth/wechat | 尚未配置 | 明确501 `WECHAT_NOT_CONFIGURED`，不伪造授权成功 |
| GET /me | 必须 | `Principal`，含真实patientId/staffId/roles/assignments |
| POST /auth/logout | 必须 | 撤销当前会话 |
| GET /patients/me | 患者 | `Patient` |
| PUT /patients/me | 患者 | `PatientInput`平铺字段 + expectedVersion → 新版Patient |

PatientInput：name、birthDate(YYYY-MM-DD)、phone、email(可null/空)、billingAddress、emergencyName、emergencyPhone、allergyStatus、allergies。`unknown`与`none_reported`必须无明细；`known`必须至少一个不同的非空过敏项。手机号没有唯一性要求。不提供凭手机号绑定或任意患者ID认领接口。

`Patient.isDemo` 是服务端只读标记，不属于 PatientInput。资料更新和注册不能提交该字段；客户端须从返回对象中剥除 `id`、`rowVersion`、`isDemo` 后构造可编辑资料。普通档案不会因为名称相似而自动成为演示档案。

## 目录与排班

公开数组接口：`GET /clinics`、`GET /services?clinicId`、`GET /doctors?clinicId&serviceId`、`GET /qualifications`、`GET /chairs?clinicId`。默认仅活动资源；`includeInactive=true`要求员工会话并按授权管理范围处理。目录不等于可预约承诺，最终号源接口检查资格有效期和全部资源。

医生只读展示扩展为 `isDemo`、`bio`、`focusAreas`、`clinicIds`。`clinicIds` 来自已发布班次涉及的活动门诊。演示资格不是实际执照核验。原有医生维护输入保持原契约，不接受通过普通资料更新改写演示来源。

`GET /treatment-references` 公开返回 `TreatmentReference[]`：`id`、`category`、`name`、`priceMinCents`、`priceMaxCents`、`unit`、`referenceYear`、`sourceLabel`、`description`、`bookingServiceId`。价格为非负整数分、上限不小于下限；年份与来源随资料保存，本轮来源明确为用户提供且未独立核验。`bookingServiceId` 可以为空，非空时只是关联评估/咨询的导航，不赋予额外诊疗能力；是否可约仍由号源与资格校验决定。资料价格不写入 Service.priceCents、hold 或预约费用。

`GET /shifts?clinicId&date`为员工接口，返回Shift数组。医生仅本人，前台/店长仅授权门诊，总部全链。GET只读，时间查询不创建hold。

| 写接口 | 权限 | 字段 |
| --- | --- | --- |
| POST /staff/clinics；PUT /staff/clinics/{id} | 创建总部；编辑总部/本院店长 | name,address,phone,email,timezone,active；编辑加expectedVersion |
| POST/PUT /staff/doctors[/{id}] | 总部 | employeeNo,name,phone,specialty,active,qualifications数组 |
| POST/PUT /staff/qualifications[/{id}] | 总部 | name,active；编辑版本 |
| POST/PUT /staff/services[/{id}] | 总部 | name,description,durationMinutes,bufferMinutes,priceCents,unit,active,clinicIds,qualificationIds |
| POST/PUT /staff/chairs[/{id}] | 总部/所属门诊店长 | clinicId,name,active；编辑版本 |
| POST /staff/shifts | 总部/所属门诊店长 | clinicId,doctorId,startsAt,endsAt,serviceIds |
| POST /staff/shifts/{id}/cancel | 总部/所属门诊店长 | expectedVersion |
| POST /staff/chair-blocks | 总部/所属门诊店长 | chairId,startsAt,endsAt,reason；当前API有停用区间，工作台仅基础启停 |

qualifications项为 `{qualificationId,validFrom,validUntil:null|ISO时间}`；必须覆盖完整班次/服务适用区间。服务多资格要求按全部满足。已发布排班显式列出开放项目；医生跨店重叠或转场不足拒绝。预约占用中的核心资源/资格调整、班次撤销与牙椅停用会被拒绝，需要先处理有效预约或等待占位到期。

患者员工侧：`GET /staff/patients?q&page&pageSize` → Page。总部支持条件列表；普通前台/店长必须完整姓名或完整电话精确核对，不允许空查询枚举全链。`POST /staff/patients`用PatientInput建立未绑定患者档案，前台/店长/总部可用。员工录入不会自动给患者创建登录账号，也不会凭手机号绑定现有账号。

## 查询、占位与确认

`GET /booking-policy`返回holdSeconds、cancellationNoticeMinutes、transferBufferMinutes、slotStepMinutes、timezone。

`GET /booking-slots?clinicId=UUID&serviceId=UUID&date=YYYY-MM-DD&doctorId=UUID` → BookingSlot数组；doctorId可选，日期为未来90天范围。包括实际服务结束endsAt、含缓冲occupiedUntil、服务时长及参考价格。没有其他患者ID、姓名或预约详情。

`POST /booking-holds`：

```json
{"clinicId":"UUID","serviceId":"UUID","doctorId":"UUID","chairId":"UUID","shiftId":"UUID","startsAt":"2026-11-01T09:00:00+08:00"}
```

患者只为本人，员工代约另带patientId。服务端重新计算选择是否有效，返回 `{id,expiresAt,rowVersion,slot,policy}`。这只是短时占位，不生成正式预约编号；服务器时间决定是否有效。占位失败或过期没有永久占用，下一次写事务会持久化expired。

`POST /appointments/confirm`（Idempotency-Key）：

```json
{"holdId":"UUID","holdVersion":1,"patientConfirmed":true,"rulesAccepted":true}
```

员工可同时传patientId核对。必须是当前操作者拥有的有效hold，匹配真实就诊人；再次验证目录/资格/班次/牙椅、事务提交后才返回Appointment。预约编号由后端唯一生成；不返回支付成功或到诊完成。

## 查询、取消、改期和恢复

- `GET /appointments?status&page&pageSize` → 本人Page。
- `GET /staff/appointments?clinicId&date&status&page&pageSize` → 授权员工Page，显式跨门诊越权403。
- `GET /appointments/{id}` → 授权详情和事件；其他患者404。
- `POST /appointments/{id}/changes`，Idempotency-Key：

```json
{"intent":"cancel","expectedVersion":1,"reason":"计划有变"}
```

```json
{"intent":"reschedule","expectedVersion":1,"reason":"调整时间","holdId":"新hold UUID","holdVersion":1}
```

取消和改期执行预约已接受的提前规则；保留原预约、事件及原因。改期成功返回新预约，supersedesAppointmentId指向旧约，旧约replacementAppointmentId指向新约。新hold或版本失效等错误均不丢失旧约。目标hold不能与仍有效的原约占用区间重叠，查询不会把这些区间显示为空闲。

- `GET /commands/{key}` → `{status:'completed',result:Appointment}` 或 `{status:'not_found'}`，只查当前账号的回执。
- 网络中断时客户端必须保留原key及完整请求，显示“结果待确认”，核对或同键重试。not_found不是自动新建占位/新key的依据。

## 常见错误

401：UNAUTHENTICATED、SESSION_EXPIRED、INVALID_CREDENTIALS；403：FORBIDDEN、CLINIC_SCOPE_DENIED、DEMO_LOGIN_DISABLED、WRONG_PORTAL；404：NOT_FOUND、HOLD_NOT_FOUND；409：RESOURCE_CONFLICT、SLOT_UNAVAILABLE、HOLD_EXPIRED、VERSION_CONFLICT、REQUEST_KEY_REUSED、FUTURE_BOOKINGS_EXIST、SHIFT_CONFLICT、CANCELLATION_WINDOW_CLOSED。输入错误400，未配置微信501，内部错误500只给通用消息及requestId。数据库异常不会被吞掉或转成成功。

本次没有微信支付、资金、病历、到诊登记或治疗完成接口。接口测试不证明微信授权、生产TLS或医疗运营能力已验收。
