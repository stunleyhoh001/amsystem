# 一分钟联盟营销系统

这是一个 Firebase 版双界面联盟营销系统原型。

## 当前进度

- Firebase Authentication：Google 登录
- Firestore：云端保存数据
- 用户端：充值配套、推荐、奖励、提现
- 后台端：配套、用户、订单、奖励、提现管理
- 用户数据：已拆到 `amsystemUsers/{用户ID}`
- 后台权限：只有配置的管理员邮箱可以进入后台
- 充值流程：用户提交配套申请，后台确认付款后才发积分和奖励
- 操作日志：后台关键操作会记录管理员、时间、动作和详情

## 管理员邮箱设置

打开 `app.js`，找到：

```js
const ADMIN_EMAILS = [
  "your-admin-email@gmail.com",
];
```

把里面的邮箱改成你的 Google 登录邮箱，例如：

```js
const ADMIN_EMAILS = [
  "yourname@gmail.com",
];
```

如果有多个管理员：

```js
const ADMIN_EMAILS = [
  "admin1@gmail.com",
  "admin2@gmail.com",
];
```

## Firestore 数据位置

```txt
amsystem/main
amsystemUsers/{用户ID}
```

`amsystem/main` 保存系统配套规则。  
`amsystem/main` 也保存后台操作日志。  
`amsystemUsers/{用户ID}` 保存用户自己的资料、订单、奖励、提现、积分流水。

## 安全版 Firestore Rules

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return signedIn()
        && request.auth.token.email in [
          "your-admin-email@gmail.com"
        ];
    }

    match /amsystem/{docId} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }

    match /amsystemUsers/{userId} {
      allow read, write: if isAdmin() || (signedIn() && request.auth.uid == userId);
    }
  }
}
```

把里面的 `your-admin-email@gmail.com` 改成你的管理员 Google 邮箱。  
同样也要在 `app.js` 的 `ADMIN_EMAILS` 改成同一个邮箱。

这个规则会做到：

- 普通登录用户可以读取系统配套规则。
- 普通登录用户只能读写自己的 `amsystemUsers/{uid}`。
- 管理员可以管理所有用户数据和系统配套规则。

## 下一步优先级

1. 把 Firestore Rules 改成真正的管理员 / 用户隔离规则。
2. 把订单、奖励、提现拆成独立集合。
3. 把奖励计算移到 Cloud Functions。
4. 把“模拟支付成功”改成“待支付订单 + 后台确认付款”。
5. 增加管理员操作日志。

## 后台操作日志

系统会记录这些管理员动作：

- 新增配套
- 调整积分
- 确认付款
- 取消订单
- 冻结 / 解冻用户
- 确认 / 取消 / 冻结奖励
- 审核提现

日志保存在：

```txt
amsystem/main.adminLogs
```

## 充值订单流程

当前流程已经改成：

1. 用户填写付款方式、付款参考号和备注。
2. 用户点击申请充值配套。
3. 系统创建 `待处理` 订单。
4. 后台管理员进入订单管理，核对付款资料。
5. 管理员点击 `确认付款`。
6. 系统才发放积分、更新配套有效期、生成推荐奖励。

管理员也可以对待处理订单点击 `取消订单`。
