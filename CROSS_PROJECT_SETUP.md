# 跨项目整合部署清单

当前状态：代码与本机测试已完成，尚未部署云函数，也尚未启用跨项目 IAM。

## 本地部署预检

部署前先在简单POS目录运行：

```powershell
node scripts/integration-preflight.js
```

预检会只读检查三个项目编号、Functions来源与导出、Rules文件、Hosting公开范围、
跨项目目标和服务账号私钥。`0 errors` 才可进入部署步骤。

SimplePay安全资金开关保持关闭，以及跨项目IAM尚未云端验证，会显示为提醒而不是错误；
IAM必须在部署后使用POS后台的“检查三系统连接”确认。

查看完整部署计划（不会连接Firebase或修改云端）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-three-systems.ps1
```

真实部署脚本具有三层保护：`-Execute`、费用确认和固定确认文字。只有项目拥有者明确确认部署后，
才可使用执行模式。不要在预检有错误时绕过脚本直接部署。

## 项目边界

| 系统 | Firebase 项目 | 保存的主要资料 |
| --- | --- | --- |
| 简单POS | `simplepos-2900e` | 分行、商品、销售、整合任务 |
| SimplePay | `oneminpay` | 钱包、商家、付款、退款 |
| 简单联盟 | `amsystem-faafb` | 配套、联盟订单、奖励、撤销案件 |

三个系统继续使用三个 Firebase 项目。整合只交换订单编号、金额、状态及必要的顾客识别资料，不复制完整数据库。

## 安全原则

1. 不建立或保存 service-account JSON 私钥。
2. 云函数使用 Google 自动提供的服务账号与 Application Default Credentials。
3. POS 只能建立付款意图，不能直接更改钱包余额。
4. 顾客必须登录 SimplePay 并确认付款。
5. POS 退款先由对应商家接受，再走 SimplePay 管理员审批。
6. 联盟配套以联盟系统当前价格为准；金额不一致时拒绝建立订单。
7. 所有跨系统文件以 POS integration job ID 作为幂等键，重复执行不会重复扣款或重复发放奖励。

## 部署前设置

先在 Google Cloud 控制台查出三个项目各自用于第 2 代 Cloud Functions 的运行服务账号。通常是项目编号对应的 Compute Engine 默认服务账号，但应以函数部署页面显示的账号为准。

为 POS 函数运行服务账号授予：

- 在 `oneminpay` 项目：`Cloud Datastore User`
- 在 `amsystem-faafb` 项目：`Cloud Datastore User`

为 SimplePay 与联盟函数运行服务账号授予：

- 在 `simplepos-2900e` 项目：`Cloud Datastore User`

这些权限允许受信任云函数读写目标 Firestore。前端用户仍受各项目 Firestore Rules 限制。

## 部署顺序

1. 部署 SimplePay Functions，但暂时保持 `secureMoneyFunctionsEnabled: false`。
2. 部署联盟 Functions。
3. 部署简单POS Functions。
4. 在简单POS后台，为每个分行填写对应的 SimplePay 商家 ID。
5. 用测试顾客完成一笔 RM 1 或测试配套付款。
6. 核对 SimplePay 付款、POS `integrationJobs`、联盟外部订单三边编号一致。
7. 退款测试完成后，再评估是否启用 SimplePay 安全云函数开关。

## 当前需人工完成

- 云函数部署会产生实际云端资源，执行前需再次确认。
- IAM 授权需由项目拥有者在 Google Cloud 控制台完成。
- 部署后需用测试顾客扫描 POS 收据上的 SimplePay 二维码，完成首笔端到端验收。
