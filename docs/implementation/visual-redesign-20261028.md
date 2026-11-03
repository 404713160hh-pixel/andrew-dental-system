# Andrew Dental 界面重设计记录

## 参考与设计

参考 [Lucent Dental 首页](https://www.lucentdental.com.au/)、[关于](https://www.lucentdental.com.au/about)、[普通牙科](https://www.lucentdental.com.au/general-dentistry)、[美学牙科](https://www.lucentdental.com.au/cosmetic-dentistry)及[联系页](https://www.lucentdental.com.au/contact)的信息层级、摄影、留白与清晰入口；未复制其照片、标识或文案。参考页完成了桌面检查，移动端参考页未完整实测。

设计以纯白 `#FFFFFF` 为主，暖白 `#FCFBF9`、浅暖灰 `#F7F5F1` 辅助；正文 `#252522`，次级文字 `#77746F`，线条 `#EAE7E1`，少量暖金 `#B79A6B`，主要按钮 `#292D30`。页面采用中文衬线标题、本地无衬线正文回退、细线分隔及小幅交互动效。网站公共页样式在 `admin-web/src/public-site.css`，员工端主题在 `admin-web/src/visual-refresh.css`，小程序主题在 `miniprogram/src/app.wxss`。

## 页面与素材

### 2026-11-03 更新

公共首页改用暖灰色渐变、透明导航和诊室视频；视频来源及许可见 `admin-web/src/assets/clinic-motion-source.md`，画面是素材示意，并非真实门诊实拍。两家演示门诊展示不同的 AI 场景图，八位虚构医生使用一组各不相同的 AI 肖像；项目说明和医生简介取自共享 API。演示医生可以跨门诊排班。

数据库迁移 `007_clinic_public_details.sql` 增加可选的门诊简介和营业时间。员工端可维护这两项；旧客户端未提交时保留原值。下面的旧版素材和验证记录保留作为当时的工作记录，不代表本次更新后的完整状态。

新增网站首页、服务/医生/门诊列表及详情，公开目录调用同一个后端 API，员工登录和原有工作台路由保留。预约指引引导患者使用小程序；目前没有已配置的小程序码或正式跳转链接。联系表单没有后端支持，未伪造提交。

小程序首页、医生目录及详情、选时段、确认、预约详情、我的预约、个人中心与登录采用同一色彩体系。预约、改期和取消继续调用原接口。

实际修改范围：

- 网站：`admin-web/src/router.ts`、`main.ts`、`style.css`、`visual-refresh.css`、`public-site.css`、`views/LoginView.vue`、`views/PublicView.vue` 及 `assets/`。
- 小程序：`miniprogram/src/app.json`、`app.wxss`、`components/patient-form/index.wxss`、`utils/catalog.ts`；`pages/appointments/index.wxml`、`index.wxss`；`pages/booking/index.wxml`、`index.wxss`；`pages/confirm/index.wxml`、`index.wxss`；`pages/detail/index.wxss`；`pages/doctor-detail/index.wxml`、`index.wxss`；`pages/doctors/index.wxml`、`index.wxss`；`pages/home/index.wxml`、`index.wxss`；`pages/login/index.wxss`；`pages/prices/index.wxss`；`pages/profile/index.wxml`、`index.wxss`；以及 `assets/` 的新增图片。
- 构建和测试：`miniprogram/scripts/build.mjs` 增加图片复制及缺失引用校验；`scripts/booking-browser.mjs`、`scripts/booking-cross-client.mjs` 更新登录页定位；测试记录在 `miniprogram/qa/` 和 `docs/implementation/qa/`。

图片为 AI 生成的虚构示意素材，已在页面标注。网站素材位于 `admin-web/src/assets/`：`clinic-hero.jpg`、`reception.jpg`、`treatment-room.jpg`、`consultation.jpg`、`checkup.jpg`、`preventive-care.jpg`、`orthodontics.jpg`、`patient-experience.jpg`、`team.jpg` 和三张 `doctor-portrait*.jpg`。小程序对应素材位于 `miniprogram/src/assets/`。医生肖像仅用于带 `isDemo` 标记的虚构医生，不表示真实医师照片；两端对同名演示医生使用一致的展示选择。

## 验证及限制

- 类型检查及网站/小程序构建通过；网站单元测试 44 项、小程序模拟 wx 测试 37 项、预约 API 测试 62 项通过。
- 独立本机 PostgreSQL、真实浏览器 Vue 页面与编译后小程序模块的跨端回归 13 项通过，覆盖排班发布、预约、改期、取消及网站自动同步。小程序模块在此项测试中使用模拟 wx。
- 微信开发者工具使用实际模拟器和本机 API，已检查首页、医生、时段、确认、预约成功及预约列表，并用虚构患者创建后取消一笔预约。不是微信真机、正式 HTTPS 或线上验收。
- 网站公共首页及资料页面在 1440、1280、1024、768、390、360 像素检查了页面宽度；1440、390 像素复核图片加载和服务、医生详情跳转，390 像素复核移动菜单。截图位于本机忽略目录 `.booking-data/visual-qa/`。
- 对医生目录接口注入 503，验证服务列表与详情仍可用，医生目录显示错误提示，避免单个目录故障阻断其他资料。
- 真实门诊照片、医师授权照片和机构联系方式需要由实际运营方核实；当前不展示虚构疗效对比。网站尚无微信小程序直达码。构建仍提示员工端主 JS 包大于 500 KB。
- 本地演示使用隔离数据库，期间发现 PostgreSQL 演示目录丢失，补回运行目录后相关测试通过；应查明外部清理原因，不把该演示库当成正式数据。未将此轮视觉改动部署到云端。
