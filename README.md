# 安德鲁牙科

这是一个连锁牙科诊所的演示项目。官网介绍门诊、医生和服务，引导顾客扫码进入微信小程序。顾客在小程序里预约、取消或改期，员工在工作台处理预约、排班和患者档案。总部和店长还可以按权限查看业绩与激励。小程序和工作台使用同一套 API 和数据库。

[打开官网](https://andrewdental.top/) · [查看设计文档 PDF](docs/design/1602240215.pdf)

## 目录

| 文件夹 | 里面是什么 |
| --- | --- |
| `admin-web/` | 官网、员工登录页和员工工作台，用 Vue 写。 |
| `miniprogram/` | 患者端微信小程序，包含门诊、医生、预约和个人资料。 |
| `booking-api/` | Fastify 后端，处理登录、排班、预约和业绩核算。 |
| `shared/` | 前后端共用的数据类型。 |
| `database/` | PostgreSQL 建表和升级脚本。 |
| `scripts/` | 本地数据库启动、演示账号管理和微信工程同步工具。 |
| `deploy/` | Docker 镜像、Nginx 和服务器部署脚本。 |
| `docs/` | 最新设计文档、可编辑 TeX 源稿和配图。 |
| `.github/` | GitHub 上的自动构建配置。 |

## 本地运行

安装 Node.js 24 和 npm 11，在仓库根目录运行 `npm ci`。

1. 开一个终端运行 `npm run dev:postgres`，让本地 PostgreSQL 保持运行。
2. 开第二个终端，依次运行 `npm run db:migrate`、`npm run db:seed` 和 `npm run db:demo`，然后运行 `npm run dev:api`。
3. 开第三个终端运行 `npm run dev:admin`，浏览器打开 `http://127.0.0.1:5173`。
4. 运行 `npm run build -w @andrew/miniprogram`，再用微信开发者工具导入 `miniprogram/`。[小程序运行说明](miniprogram/README.md)

本地演示账号的密码在首次启动数据库时生成，见本机 `.env.booking` 的 `SEED_PASSWORD`。一次构建后端、网站和小程序可以运行 `npm run build:booking`。服务器部署从根目录的 `compose.yaml` 和 `.env.compose.example` 开始。
