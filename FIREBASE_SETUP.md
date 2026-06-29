# Firebase 云端版设置指南

目标：把现在的本地 POS 升级成“联网优先、断网可用、多分行同步、管理员可授权员工”的云端系统。

## 第 1 步：建立 Firebase 项目

1. 打开 Firebase Console：

   ```text
   https://console.firebase.google.com/
   ```

2. 点击 `Add project` / `新增项目`。
3. 项目名称可以填：

   ```text
   simple-herbal-pos
   ```

4. Google Analytics 可以先关闭，之后需要再开也可以。
5. 创建完成后进入项目。

## 第 2 步：新增 Web App

1. 在 Firebase 项目首页，点击 Web 图标 `</>`。
2. App nickname 可以填：

   ```text
   simple-herbal-pos-web
   ```

3. 先不要勾选 Hosting 也可以，后面再设置。
4. Firebase 会给你一段 `firebaseConfig`，长得像这样：

   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

5. 把这段配置发给我，我会帮你接进系统。

注意：`firebaseConfig` 不是后台管理员密码，但最好也不要随便公开发到社交平台。

## 第 3 步：启用 Google 登录

1. 左侧菜单进入 `Build` -> `Authentication`。
2. 点击 `Get started`。
3. 进入 `Sign-in method`。
4. 找到 `Google`。
5. 点击启用。
6. Support email 选择你的管理员邮箱：

   ```text
   你的管理员邮箱
   ```

7. 点击 `Save`。

## 第 4 步：建立 Firestore 数据库

1. 左侧菜单进入 `Build` -> `Firestore Database`。
2. 点击 `Create database`。
3. 模式先选择 `Production mode`。
4. 地区建议选离你客户比较近的区域，例如亚洲区域。
5. 创建数据库。

## 第 5 步：我们要建立的数据表

之后我会帮你把系统改成使用这些集合：

```text
branches
- name
- active
- createdAt

users
- email
- name
- role: admin / cashier
- branchId
- active
- createdAt

products
- name
- barcode
- category
- price
- branchStock
- active

sales
- branchId
- branchName
- operator
- customer
- items
- subtotal
- discount
- total
- paid
- change
- service
- createdAt
- syncStatus
```

## 第 6 步：权限规则方向

后续要做到：

- 只有你设置的管理员邮箱是总管理员。
- 管理员可以查看全部分行和全部订单。
- 授权员工只能查看和收银自己所属分行。
- 未授权邮箱即使 Google 登录成功，也不能进入 POS。
- 授权员工只能同步库存和订单，不能修改商品名称、价格、分类和 SKU。

## 第 7 步：下一步你要发给我的资料

请你先完成 Firebase 第 1 到第 4 步，然后把 Web App 的 `firebaseConfig` 发给我。

收到配置后，我会继续帮你做：

- 接入 Firebase Google 登录
- 把本地授权用户改成 Firestore 授权用户
- 把销售记录保存到 Firestore
- 保留断网收银
- 恢复网络后同步离线订单
- 部署到 Firebase Hosting

## 当前已接入

你提供 Firebase 配置后，项目已经新增：

- `firebase-config.example.js`：可提交到 GitHub 的 Firebase 配置模板
- `firebase-config.local.js`：真实 Firebase 项目配置，只留在本机，不提交
- `firebase-cloud.js`：Google 登录和 Firestore 基础同步
- `firestore.rules`：建议使用的 Firestore 安全规则

页面现在有：

- Google 登录
- 云端连接状态
- 收款后尝试同步销售记录到 Firestore
- 断网收款会进入待同步队列
- 恢复网络后自动补传待同步订单
- 在线收款使用 Firestore transaction 同时写订单和扣库存
- 新增分行时尝试同步到 Firestore
- 授权用户时尝试同步到 Firestore
- 后台一键初始化云端数据

## 第 8 步：发布 Firestore Rules

进入 Firebase Console：

```text
Build -> Firestore Database -> Rules
```

把项目里的 `firestore.rules` 内容贴进去，然后点击 `Publish`。

注意：如果 Rules 没发布，Google 登录可能成功，但写入用户、分行、订单会失败。

## 第 9 步：本地测试 Google 登录

用本地 HTTP 打开：

```text
http://localhost:4173
```

不要直接双击 `index.html` 测试 Google 登录，因为浏览器 OAuth 和 PWA 功能通常需要 `localhost` 或 HTTPS。

打开后：

1. 点击 `Google 登录`。
2. 选择你的管理员邮箱。
3. 顶部应该显示云端已连接。
4. 管理员后台会自动打开。

## 第 10 步：初始化云端资料

Google 管理员登录成功后，在后台点击：

```text
初始化云端数据
```

这个按钮会把当前本地资料上传到 Firestore：

- 分行
- 授权 POS 用户
- 商品和各分行库存
- 业务设置

成功后，Firebase Console 的 Firestore 里应该能看到这些集合：

```text
branches
users
products
settings
stockAdjustments
auditLogs
```

之后你完成一笔收款，Firestore 里还会出现：

```text
sales
```

## 第 11 步：测试离线补传

1. 保持 Google 管理员或授权用户已登录。
2. 断开网络。
3. 完成一笔收款。
4. 顶部云端状态应该显示 `待同步 1`。
5. 恢复网络。
6. 系统会自动补传订单。
7. 到 Firestore 的 `sales` 集合确认订单是否出现。

## 第 12 步：部署到 Firebase Hosting

项目已经加入：

```text
firebase.json
.firebaserc
```

之后电脑安装 Firebase CLI 后，可以在项目文件夹运行：

```powershell
firebase deploy
```

部署成功后，网址通常是：

```text
https://simplepos-2900e.web.app
```

提醒：上线前要确保部署环境包含 `firebase-config.local.js`，或者把同等真实配置放进部署版本的 `firebase-config.js`，否则网页无法连接 Firebase。

## GitHub Secret Scanning 提醒

如果 GitHub 显示：

```text
Action needed: Secrets detected
Google API Key
```

这是因为 Firebase Web 配置里的 `apiKey` 被扫描到了。Firebase Web API Key 会出现在前端，但仍然应该避免直接提交到公开仓库，并且要在 Google Cloud 里限制这个 key。

项目现在已经调整为：

```text
firebase-config.example.js  可以提交
firebase-config.local.js    本机真实配置，不提交
```

请确认 `.gitignore` 里有：

```text
firebase-config.local.js
```

如果 GitHub 已经报警，建议你做两件事：

1. 到 Google Cloud Console 限制 API Key，只允许你的网站域名使用。
2. GitHub alert 里如果确认只是 Firebase Web API Key，可以在处理完限制后标记为 resolved / false positive。

正式上线时，部署环境仍然需要有 `firebase-config.local.js`，或者把同等真实配置放进部署版本的 `firebase-config.js`，否则网页无法连接 Firebase。
