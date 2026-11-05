# 六个演示账号的统一密码

2026-11-05

用户指定六个虚构演示账号使用统一密码 `admin123`。员工登录页在四个角色下方、小程序在患者账号选择下方显示“演示密码：admin123”。选择角色或患者仍只填入账号，密码由使用者输入。

| 角色 | 账号 | 目标演示密码 | 入口 |
| --- | --- | --- | --- |
| 总部管理员 | `hq` | `admin123` | 员工网站 |
| 店长 | `manager.a` | `admin123` | 员工网站 |
| 前台 | `front.a` | `admin123` | 员工网站 |
| 医生 | `doctor.a` | `admin123` | 员工网站 |
| 患者 A | `patient.a` | `admin123` | 小程序 |
| 患者 B | `patient.b` | `admin123` | 小程序 |

## 一次性维护

`booking-api/src/demo-passwords.ts` 集中实现维护逻辑，`scripts/set-demo-passwords.mjs` 是编译后入口。它不提供 HTTP 接口，普通账号的注册、重置及修改密码规则保持不变。

执行需明确启用，并使用 development 或 test 配置连接 `andrew_booking_preview` 或随机测试数据库。维护会核对实际数据库名称、六个原始账号、同批种子来源、虚构门诊、医生及患者档案关联和原始岗位集合；任一核对失败都不会修改账号。六人的密码分别生成独立 scrypt 哈希，更新账号版本、清除强制改密标记、撤销旧会话并记录不含密码的审计事件。全部更改在同一事务中提交。

服务器首先备份数据库到 `/opt/andrew-backups/before-demo-passwords-20261105.dump`，构建独立镜像 `andrew-demo-password-maintenance:20261105`。维护 Compose 覆盖文件只为临时 migrate 容器指定该镜像，不替换运行中的 API 或数据库。

准备完成后，由服务器操作者在 root Workbench 终端执行：

```sh
bash /opt/andrew-demo-login-20261105/deploy/booking/apply-demo-passwords.sh --apply
```

脚本要求备份和维护镜像已存在。成功后更新服务器私有账号清单，并输出 `DEMO_PASSWORDS_APPLIED`。此命令会使六个演示账号原来的登录会话失效。

## 验证记录

- 员工端 47 项、小程序 50 项模块测试通过；两端类型检查及生产构建通过。
- 真实 PostgreSQL 集成测试 6 项通过，覆盖六人新密码登录、旧密码拒绝、旧会话撤销、普通账号及其会话保留、来源或关联异常拒绝，以及中途审计失败时整批回滚。
- 本地浏览器在 1440px、390px 核对提示和账号选择，无横向溢出。
- 小程序生产构建继续使用 `https://andrewdental.top/api/v1`，同步时保留 AppID 和合法域名校验。

线上密码修改与修改后两端实际登录验证，需在服务器操作者执行上述维护命令后记录。
