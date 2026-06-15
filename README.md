# 一分钟联盟营销系统

Firebase 版双界面联盟营销系统原型。

## 已完成

- Google 登录
- 用户界面和后台界面
- 管理员邮箱权限
- Firestore 安全规则
- Firebase Storage 付款证明上传
- 后台确认付款后才发积分和奖励
- 后台操作日志
- 订单、奖励、提现、积分流水已拆成独立集合
- 后台订单、奖励、提现支持状态筛选和 CSV 导出
- Cloud Functions：已预留后端函数；当前可先用前端管理员确认付款 fallback

## 管理员邮箱

在 `app.js` 和 `firestore.rules`、`storage.rules` 里，把：

```txt
your-admin-email@gmail.com
```

改成你的管理员 Google 邮箱。

## Firestore 结构

```txt
amsystem/main
amsystemUsers/{用户ID}
amsystemOrders/{订单ID}
amsystemRewards/{奖励ID}
amsystemWithdraws/{提现ID}
amsystemPointLogs/{流水ID}
amsystemAdminLogs/{日志ID}
```

说明：

- `amsystem/main`：系统配套规则。
- `amsystemUsers`：用户资料。
- `amsystemOrders`：充值订单。
- `amsystemRewards`：奖励记录。
- `amsystemWithdraws`：提现申请。
- `amsystemPointLogs`：积分流水。
- `amsystemAdminLogs`：后台操作日志，只允许管理员读取。

## Firestore Rules

把 `firestore.rules` 的内容复制到 Firebase Console 的 Firestore Rules 并发布。

## Storage Rules

付款证明保存在：

```txt
paymentProofs/{用户ID}/{文件名}
```

把 `storage.rules` 的内容复制到 Firebase Console 的 Storage Rules 并发布。

## 充值订单流程

1. 用户填写付款方式、付款参考号和备注。
2. 用户上传付款证明，支持图片或 PDF，最大 5MB。
3. 用户点击申请充值配套。
4. 系统创建待处理订单。
5. 管理员进入后台订单管理，核对付款资料和凭证。
6. 管理员确认付款。
7. 系统发积分、更新配套有效期、生成推荐奖励。

## 下一步建议

1. 部署 Cloud Functions。
2. 增加真实支付网关回调。
3. 增加管理员操作日志导出。
4. 增加更多日期/用户筛选。
5. 增加手机端体验优化。

## Cloud Functions（可选，正式上线再启用）

已新增：

```txt
functions/index.js
functions/package.json
firebase.json
.firebaserc
```

当前云函数：

```txt
confirmOrder
```

作用：

- 只有管理员可以调用。
- 确认待处理订单。
- 发放积分。
- 更新用户配套有效期。
- 生成推荐奖励。
- 写入积分流水。
- 写入后台操作日志。

部署前，请把 `functions/index.js` 里的：

```txt
your-admin-email@gmail.com
```

改成你的管理员邮箱。

部署命令：

```bash
firebase deploy --only functions
```

如果你暂时不想升级 Blaze 方案，可以先不部署 Cloud Functions。

当前系统会这样处理：

1. 优先尝试调用 `confirmOrder` 云函数。
2. 如果云函数未部署或不可用，管理员前端会 fallback 完成确认付款。
3. 操作日志会标记为 `前端管理员确认`。

这个 fallback 适合测试和内测。正式上线涉及真钱、积分和奖励时，建议再启用 Cloud Functions。
