# 上线前检查清单

## Firebase Console

- 已开启 Billing，并设置预算提醒。
- 已启用 Authentication 的 Google 登录。
- 已创建 Firestore Database。
- 已发布 `firestore.rules`。
- `v0.68` 起规则已允许订单保存 `inventoryReview`；升级后必须重新发布规则。
- 已在 Google Cloud 限制 Firebase Web API Key 的 HTTP referrers。

## 本地文件

- 运行 `node scripts/integration-preflight.js`，结果为 `0 errors`。
- `firebase-config.local.js` 存在，并且内容是当前 Firebase 项目的真实配置。
- `firebase-config.local.js` 不提交到 GitHub。
- `firebase-config.example.js` 可以提交，用作模板。
- `firestore.rules` 已经是最新规则。
- `firebase.json` 和 `.firebaserc` 存在。
- Firebase Hosting 只发布POS运行资源，不公开 `functions`、`tests`、说明文档、规则文件或本机日志。
- `functions/node_modules` 和 `.pnpm-store` 不提交到 GitHub。
- `firebase-config.local.js` 使用 `no-store` 响应头，并且不会进入 Service Worker 离线缓存。

## 功能测试

- Google 管理员登录成功。
- 点击 `初始化云端数据` 后，Firestore 出现：
  - `branches`
  - `users`
  - `products`
  - `settings`
- 完成一笔收款后，Firestore 出现 `sales`。
- 管理员新增商品或调整库存后，Firestore 出现 `stockAdjustments`。
- 管理员执行新增分行、授权用户或保存设置后，Firestore 出现 `auditLogs`。
- 断网收款后，顶部显示待同步数量。
- 恢复网络后，待同步订单自动补传。
- `刷新云端资料` 可以读取云端资料。
- CSV 导出能打开，并包含分行、收银员、同步状态和服务周期。
- 销售记录包含付款方式和付款参考号。
- 付款方式汇总可以按日期范围查看和导出。
- 后台日期范围切换为今天、本月、全部后，全局订单和分行汇总会跟着变化。
- 热销商品和每日销售趋势会跟随后台日期范围变化。
- 商品排行 CSV 和库存总表 CSV 可以下载。
- 客户名单 CSV 可以下载，并包含计划到期和跟进状态。
- 今日销售搜索可按客户、电话或订单号过滤。
- 转账记录里作废订单后，订单显示已作废，库存回补，报表不再统计该订单。
- 业务设置里的低库存提醒阈值会影响低库存列表。
- 客户跟进可标记 `已联系` 和 `已完成`，完成后不会继续显示在待跟进列表。
- 销售 CSV 包含客户跟进状态和跟进更新时间。
- 审计日志 CSV 可以下载，并包含动作、操作者和详情。
- 库存流水 CSV 可以下载，并包含调整前、调整后、变化和原因。
- 完整 JSON 备份能下载。
- 从 JSON 备份恢复能成功载入本机资料。

## 部署

部署命令：

```powershell
firebase deploy
```

部署后访问：

```text
https://simplepos-2900e.web.app
```

如果线上页面显示云端未连接，优先检查：

- `firebase-config.local.js` 是否被部署。
- API Key 的 HTTP referrers 是否包含线上域名。
- Firestore Rules 是否已发布。
- Google 登录的 Authorized domains 是否包含线上域名。

注意：`firebase-config.local.js` 被 `.gitignore` 忽略，是为了避免 GitHub 再次提示 secret。部署 Firebase Hosting 时，本机文件仍可以被部署；提交到 GitHub 时不要提交它。

Firebase Web 配置会由浏览器读取，因此不能当作服务器密钥使用。API Key 必须限制为实际使用的 HTTPS 域名；服务账号私钥和跨项目凭证不得放入任何前端文件。
