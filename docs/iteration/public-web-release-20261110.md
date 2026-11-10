# 官网发布包 2026-11-10

发布标识：`andrew-public-20261110-r1`。发布分支：`codex/deploy-public-site-20261110`。以此前已部署的 `76cdd4d` 为基线，仅加入官网视觉更新、公开路由滚动处理和必要测试适配。原工作区的小程序、设计PDF、员工端待提交修改没有混入本发布包。

包含Hero、导航、品牌故事、服务图文联动、诊所环境、医生团队、预约指引与深色页脚。本轮网页仍使用既有API；没有数据库迁移、账号修改或财务逻辑调整。

## 发布前验证

- 独立工作目录执行 `npm ci --ignore-scripts` 和前端生产构建，TypeScript检查通过。
- 独立发布目录83项现有前端测试通过，包括新增的公开锚点导航回归；补齐员工路由测试夹具对Vue导入的模拟，员工权限逻辑未变。
- `git diff --check`、`bash -n deploy/booking/deploy-public-web.sh` 通过。
- 桌面与手机浏览器的官网模块测试、公开API只读预览和结果见本目录其余官网迭代记录。

## 部署方式

运行 `bash deploy/booking/deploy-public-web.sh FULL_COMMIT_SHA`。

脚本使用既有 `/opt/andrew-preview` 仓库及私有配置 `/opt/andrew-config/.env.public`。先核对精确Git提交与干净检出、当前容器及公网健康，再备份旧网站镜像标签和Compose配置路径，生成独立回滚脚本。

只构建并替换Web服务，不运行迁移或演示数据填充。应用切换后检查Nginx、公网 `site-release.json`、API健康，并确认API/PostgreSQL/HTTPS容器ID保持一致。切换后的检查失败会自动尝试回滚Web。

回滚脚本保存在 `/opt/andrew-backups/public-web-<UTC时间>/rollback.sh`，脚本运行日志会打印实际路径。备份期间不输出环境文件内容。

该文件记录发布包和验证方式。是否已部署需以实际服务器输出和公网检查为准。

## 尚缺素材

没有正式小程序码资源，网页保留明确待配置提示；本发布不宣称扫码入口可用。
