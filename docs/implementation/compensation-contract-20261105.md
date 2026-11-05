# 员工薪酬与季度激励实现契约

原始案例第1页定义净利润及10%激励基金，第2页要求按季度跟踪每位牙医收入、医疗用品成本和运营费用。跨店医生使用同一个 `staff.id`。固定工资、税费和社保不属于原文给定制度。

## 季度激励

按已结束的自然季度核算。财务人员逐门诊、逐月登记已核对账证的医生收入净额、用品成本和运营费用，三类金额各附来源编号；零业务月份必须明确确认并填写依据。预约标价、预约数量均不进入收入计算。期间更正采用重开或后续调整；已被有效季度快照引用的月份保持锁定。

每位医生先跨店合并利润；全体医生含负数利润合计后取正部，按10%四舍五入至分形成基金。个人权重取跨店合并后的正净贡献，用最大余数法分配，余数相同时按员工编号、医生ID稳定排序，个人份额合计等于基金。股权比例不参与。

制表与复核人必须有有效员工档案，并且账号ID、员工ID均不同。月份由总部或本门诊店长制表和复核；季度由总部制表和复核。医生和其他员工只查看本人已批准份额及发放记录。金额、财务来源均不进入公开医生接口。

## 接口约定

全部接口使用 `/api/v1` 前缀、现有响应封装和服务端鉴权。金额字段为整数分；日期月份为 `YYYY-MM`，季度为 `YYYY-Q1` 至 `YYYY-Q4`。所有修改带 `expectedVersion`，创建除外。

- `GET /staff/profiles`：总部返回全部员工档案（含非医生）；`POST /staff/profiles`、`PUT /staff/profiles/:id`：总部维护非医生档案，字段含员工号、姓名、电话、出生日期、家庭住址、邮箱、专业/岗位说明、状态及关联的 `userId`。医生仍由医生资源入口维护。旧资料的未知私人字段保留 null；仅总部取得这些字段。账号管理关联此列表。
- `GET /compensation/context`：总部/店长可访问，返回有权门诊、医生、已关联员工身份和固定核算规则。
- `GET /compensation/months?quarter=&clinicId=`：总部或所属店长查询月份底稿；`POST /compensation/months` 新建；`PUT /compensation/months/:id` 保存本人草稿。
- 月份正文：`clinicId, month, reference, noActivity, rows[{doctorId,revenueCents,materialCostCents,operatingExpenseCents,revenueReference,materialReference,expenseReference}]`。无业务时 rows 为空且 reference 说明依据；有业务至少一行。负数调整需对应来源。数据库保留草稿行历史，不用删除已发生事实。
- `POST /compensation/months/:id/close`：独立人员复核关闭；检查门诊、医生、来源及该月已发布出诊医生覆盖。`POST .../reopen`：总部填写 `reason` 重开未被有效季度引用的月份。
- `GET /compensation/quarters?quarter=`、`POST /compensation/quarters {quarter,reference}`：总部查询或生成季度快照；全部门诊三个自然月必须关闭，零业务也需确认，不以缺失代零。生成时固化门诊和月份范围、医生门诊明细、跨店份额及规则版本。
- `GET /compensation/quarters/:id` 返回月份来源、按门诊医生展开、个人份额及发放记录；`POST .../submit` 草稿提交；`POST .../approve` 独立总部人员批准；`POST .../void {expectedVersion,reason}` 作废未批准快照后重新生成。快照不原地覆盖。
- `POST /compensation/allocations/:id/payments {expectedVersion,amountCents,reference}`：总部登记待确认发放，`expectedVersion` 为个人份额版本。此创建操作也须检查额度版本，占用可发额度，引用凭证全局唯一；`POST /compensation/payments/:id/resolve {expectedVersion,status:'succeeded'|'failed',reference}`：登记实际结果，此处版本为付款记录版本。成功及待确认金额合计不得超过批准份额；未知结果继续待确认，不自动当失败重发。相同发放凭证及金额重放返回原记录，相同终态及结果凭据重放返回原结果。
- `GET /compensation/me`：员工仅返回本人已批准的季度份额和支付记录；未关联档案时返回空列表并说明需要关联。

## 物理模型

新增 `incentive_months`、`doctor_financial_sources`、`incentive_pools`、`incentive_pool_sources`、`doctor_quarter_results`、`incentive_allocations`、`incentive_payments`。所有金额用 BIGINT/整数分，计算使用 BigInt；期间引用、唯一范围、状态和可发余额在事务及行锁内校验。业务服务写审计事件，不记录密码或完整敏感资料。

文档须同步用例规约、业务序列、边界—控制—实体内部序列、类关系、状态、ER及逐表字典。原有诊疗财务设计继续描述明细来源；季度模块的账证汇总输入是实际核算入口，字段与迁移保持相同。
