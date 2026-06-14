# 一分钟联盟营销系统

这是一个 Firebase 版双界面联盟营销系统原型。

## 当前已经接入

- Firebase Authentication
- Google 账号登录
- Firestore 云端数据保存
- 用户界面
- 后台界面
- 本地 fallback：Firestore 没开权限时，数据会暂存在浏览器本地

## 用户界面

用户可以：

- 使用 Google 登录
- 绑定推荐码
- 申请充值配套
- 查看积分和配套状态
- 复制推荐链接
- 查看直接推荐朋友
- 查看首充奖励和下线复购奖励
- 申请奖励提现

## 后台界面

管理员可以：

- 设置充值配套
- 设置积分、推荐名额、有效期
- 设置首充奖励比例
- 设置下线复购奖励比例
- 查看用户和订单
- 冻结或解冻用户
- 修改积分
- 审核奖励
- 审核提现
- 导出数据

## Firebase Console 必做设置

1. 进入 Firebase Console。
2. 打开项目 `amsystem-faafb`。
3. 进入 Authentication。
4. 点击 Sign-in method。
5. 启用 Google 登录。
6. 进入 Firestore Database。
7. 创建数据库。
8. 测试阶段可以先使用测试规则。

测试规则示例：

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /affiliateSystems/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

注意：这个规则只适合测试。正式上线不能让所有登录用户都能写整个系统数据。

## Firebase Hosting 发布

如果你要直接用 Firebase 发布：

1. 安装 Firebase CLI。
2. 在项目目录运行 `firebase login`。
3. 运行 `firebase init hosting`。
4. Public directory 选择当前目录或放置网页文件的目录。
5. 运行 `firebase deploy`。

也可以继续用 GitHub Pages，但需要在 Firebase Authentication 的 Authorized domains 里加入你的 GitHub Pages 域名。

## 当前技术说明

当前版本为了快速演示，把系统数据保存到 Firestore：

```txt
affiliateSystems/main
```

正式上线建议下一步拆成独立集合：

- users
- plans
- orders
- rewards
- withdraws
- pointLogs

并且用 Cloud Functions 处理支付回调、奖励计算和提现审核，避免用户在前端篡改数据。
