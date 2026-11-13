# 安德鲁牙科微信小程序

患者可以查看门诊、医生、服务和科普内容，也可以注册、维护个人资料、预约、取消和改期。

1. 按[根目录说明](../README.md)启动 PostgreSQL 和 API。
2. 在仓库根目录运行 `npm run build -w @andrew/miniprogram`。
3. 在微信开发者工具导入本目录并填写有权限的 AppID。工具会从 `dist/` 读取构建产物。
4. 改动源码后重新构建。要同步到另一个微信工程，可以设置 `WECHAT_PROJECT_PATH`，再运行 `npm run sync:wechat`。

构建默认连接本机 API。真机调试时，用 `ANDREW_MINI_API_URL` 指定手机可访问的 API。发布时设置以下变量再执行构建，并在微信后台配置对应的 request 合法域名。

```sh
ANDREW_MINI_BUILD=production ANDREW_MINI_API_URL=https://andrewdental.top/api/v1 npm run build -w @andrew/miniprogram
```
