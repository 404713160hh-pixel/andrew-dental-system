# 官网第5至8部分与全站联调

## 设计依据与参考学习

采用《网站评价分析》最新的诊所环境、医生团队、预约指引、深色Footer及全站联调方向。延续暖白、深灰、浅金和衬线标题，四个模块分别采用空间画廊、人物专题、步骤时间线与四栏页脚，避免重复堆卡片。

- [Lucent Dental](https://www.lucentdental.com.au/)：实际浏览官网，学习环境摄影、诊疗与团队信息的组织、后续咨询入口。浏览器访问及滚动截图存于证据目录 `reference-lucent-*`。
- [Harbour Dental / North Studio](https://northstudio.london/work/harbour-dental)：实际浏览设计概念案例，参考编辑式字体、留白、克制动效与响应式组织；这是概念案例。访问截图为 `reference-harbour-*`。
- [Aesop](https://www.aesop.com/)：阅读公开页面，参考底部导航分组、门店信息和品牌说明的层级。

## 完成内容

### 第5部分：诊所环境

接续服务区末尾的“空间与照护”细线与提示，环境区收小顶部间距，采用大幅空间摄影、三张不同空间图片的缩略目录和图片说明。支持选择、放大、背景点击关闭、Escape关闭及焦点恢复。图片裁切与轻微视差在局部图层完成，章节保留正常文档流。

### 第6部分：医生团队

采用肖像与个人介绍双栏专题，支持上一位、下一位、直接选择医生。姓名、方向、介绍、关注领域、出诊门诊和详情目标读取原有API；虚构医生保留姓名及资质说明、AI肖像标识。没有添加资历、好评数或患者数量。无公开照片的记录使用姓名首字占位。

### 第7部分：预约指引

整合旧有重复的步骤区和预约说明，形成三步时间线：打开患者端、选择门诊与时间、确认并管理预约。支持点击步骤和前后切换详细说明。官网继续承担介绍和引导，预约操作在患者小程序完成。

### 第8部分：Footer

深炭灰背景、柔和弧线、有限时长的背景过渡、品牌区、真实导航目标、API门诊地址/电话/营业时间和小程序指引。复用原有ICP备号组件及部署配置；没有创建虚假隐私政策或使用条款页面。预约区与页脚共用 `MiniProgramEntry.vue`。

## 技术与业务保护

共享入场逻辑只观察本模块，使用有限动画和可见时的被动滚动监听；图片位移限制在12px以内，减少动态效果与无观察器时直接显示内容。隐藏页面停止帧调度，卸载清理观察器、DOM变化观察器、媒体查询与事件监听。

动态插入的医生资料在延迟加载和重试成功后也能注册入场观察。移除了PublicView中已没有使用位置的旧入场指令及1800ms定时兜底。

单个模块重试只重新请求对应的医生、服务或门诊目录，保留其他区域的数据和布局，避免全页重载导致位置跳动。

本轮未改数据库、后端、员工后台、登录会话或预约业务规则。保留Hero、导航、品牌故事和服务区已完成的交互。章节编号延续现有首页的实际序列：03空间、04团队、05预约。

## 验证结果

- `npm run build -w @andrew/admin-web`：通过，包含TypeScript检查；原有主包大于500KB的Vite提示仍存在。
- `npm run test -w @andrew/admin-web`：83/83通过。
- `git diff --check`：通过。
- 环境模块首轮：12项通过，覆盖桌面与手机选择、放大关闭、滚动恢复和溢出。
- 全模块合成数据回归：55项通过，覆盖医生切换、肖像、详情链接、步骤控制、真实锚点、待配置码标识、连续滚动到底部、减少动态效果、无观察器与空状态。
- 尺寸检查：1440、1280、1024、430、390、375px，均无页面横向溢出。
- 延迟与重试：7项通过，包括2.8秒延迟后资料可读、失败后重试、只重复目标请求、保留其他目录及离开官网后的动效监听器清理。
- 实际公开API预览：桌面与手机7项通过，使用既有服务/医生/门诊匿名GET接口，无页面异常。

合成数据测试在浏览器层注入显式演示资料；正常流程console错误和应用写请求尝试均为0。实际资料预览仅允许GET，不创建预约或更改服务端资料。

## 修改文件

- `admin-web/src/views/PublicView.vue`：接入四个模块，替换旧环境/沟通宣传/重复预约区域和页脚，清理闲置指令。
- `admin-web/src/components/ClinicEnvironment.vue`
- `admin-web/src/components/DoctorShowcase.vue`
- `admin-web/src/components/BookingGuide.vue`
- `admin-web/src/components/PublicFooter.vue`
- `admin-web/src/components/MiniProgramEntry.vue`
- `admin-web/src/composables/usePublicReveal.ts`
- `admin-web/src/public-tail.css`

## 页面证据与预览

本地预览：`http://127.0.0.1:5173/`。当前本地Vite临时通过 `BOOKING_API_URL=https://andrewdental.top` 连接现有公开API，网页改动尚未部署服务器。默认项目API配置没有修改；重启预览可在PowerShell设置该环境变量后运行 `npm run dev -w @andrew/admin-web`。

所有截图、录屏与JSON结果位于Git忽略目录 `.booking-data/tail-20261110/`：

- `live-full-1440.png`、`live-full-390.png`：读取现有公开API的全站长图。
- `live-environment-*`、`live-team-*`、`live-booking-*`、`live-footer-*`：实际资料下各模块视口截图。
- `live-continuous-1440.webm`、`live-continuous-390.webm`：从Hero到Footer的连续滚动及模块回看。
- `full-interaction-*`、`environment-*`：合成数据下交互回归录屏。
- `phase5.json`、`final-results.json`、`late-results.json`、`live-results.json`：逐项结果与数据来源。

## 待补素材

项目没有找到正式小程序码。预约区与页脚均保留明确的“待配置”位置，没有生成假码；扫码验收需补充正式资源后完成。
