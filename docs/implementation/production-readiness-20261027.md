# 预约系统上线前检查

检查日期：2026-10-27。范围为患者小程序、Vue 员工工作台、共享预约 API、PostgreSQL 和现有部署配置。结论基于源码及现有本地验收记录；没有在目标服务器或真实手机上部署，也没有开展完整的安全渗透测试。

## 接入真实患者前需要完成

| 项目 | 当前情况与需要处理的内容 | 代码依据 |
| --- | --- | --- |
| 患者检索范围 | 前台和店长输入完整姓名或电话后，可在连锁患者中精确检索；返回包含联系方式及过敏信息，查询未按门诊或患者授权过滤。需要明确跨店核验规则，在服务端限制可见范围、返回最少字段并记录查询审计。 | `booking-api/src/app.ts` 的 `GET /staff/patients`；`booking-api/src/repositories/catalog.ts` 的 `patientSelect` |
| 医生公开信息 | 匿名医生目录返回员工编号和电话，即使页面没有显示，接口调用者仍可读取。应拆分公开资料与员工管理资料，公开接口只返回批准展示的字段，并补充匿名和角色访问测试。 | `booking-api/src/app.ts` 的 `GET /doctors`；`booking-api/src/repositories/catalog.ts` 的 `doctorSelect` |
| 患者隐私与监护 | 注册收集出生日期、联系方式、地址、紧急联系人及过敏信息；尚未找到完整的隐私告知、敏感信息单独同意、撤回/删除及未满14岁监护流程。应由实际运营主体核实每项信息的必要性，补齐对应流程和访问控制。医疗健康信息的处理要求见[《个人信息保护法》第二十八至三十一条](https://www.miit.gov.cn/jgsj/zfs/fl/art/2022/art_515a4b20c12f430eab54bb4f56d89f56.html)。 | `miniprogram/src/pages/login/`、`booking-api/src/validation.ts` |
| 员工账号与权限生命周期 | 现有 CLI 可初始化总部账号，医生档案维护不等于创建可登录账号；尚缺员工账号创建、门诊与岗位授权调整、停用及密码恢复的管理流程。上线前应补齐并审计，覆盖离职、撤权和会话失效。 | `booking-api/src/cli.ts`；`booking-api/src/app.ts`；`booking-api/src/auth.ts` |
| 患者档案衔接 | 前台建档与患者自行注册分别创建档案，目前缺少可靠的身份核验、绑定和疑似重复处理流程；同一患者可能出现多份档案。应增加人工核验及可追溯绑定，不能凭同名或手机号自动合并。 | `booking-api/src/app.ts` 的 `POST /auth/register` 和 `POST /staff/patients` |
| 真实资料与价格 | 当前示例医生和患者为合成资料，价格参考来自用户提供且未独立核验的资料。空生产库应由机构录入真实门诊、人员、资格、服务和排班；医生简介、擅长方向及参考价格缺少完整的正式维护入口，需补充维护渠道或暂时隐藏相关展示。 | `booking-api/src/validation.ts`、`booking-api/src/services/resources.ts`、`booking-api/src/app.ts` |
| 数据库账户 | Compose 示例中 API 和迁移使用同一个 PostgreSQL 用户；应为运行时创建最小权限账号，迁移使用独立授权账号，再测试权限与升级流程。 | `compose.yaml` |
| 代理与限流 | API 当前 `trustProxy: false`，限流按请求 IP；两层 Nginx 下可能将不同访客识别为同一代理地址。应在目标网络验证 IP 和限流行为，只信任明确的代理范围。 | `booking-api/src/app.ts`；`deploy/booking/` |

## 测试环境部署与验收

1. 先确定实际运营主体、小程序账号、服务器及域名，按业务核实小程序服务类目、资质、备案和 HTTPS 证书。
2. 在隔离测试环境部署 PostgreSQL、迁移、API 和 Vue 网站；检查服务健康、TLS、日志、密钥、数据库重启，以及备份恢复。现有 Compose 检查仅为静态验证。
3. 将 `miniprogram/src/config.ts` 的本机 HTTP 地址改为目标 HTTPS API，配置小程序 request 合法域名，构建体验版并用真实手机验证。
4. 在同一 PostgreSQL 上完成端到端验收：网站发布号源 → 小程序预约 → 网站查看同一记录 → 小程序取消或改期 → 网站同步显示；复测冲突、失败恢复、权限和多账号场景。
5. 用经授权的真实机构资料替换演示资料，完成账号与隐私流程、安全测试和运维交接，再提交审核与安排正式上线。

当前患者端可使用系统账号登录。`POST /auth/wechat` 固定返回 501；若产品需要微信身份登录，需单独实现并验证，不应只配置 AppID 就视为已完成。是否采用微信登录是产品方案，不是本检查对小程序发布提出的普遍强制条件。

既有模拟器、浏览器和 PostgreSQL 联动记录见 [验收记录](acceptance.md)；它们不代替真机、正式域名或目标服务器的验收。
