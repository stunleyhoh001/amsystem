# 简单POS三系统低成本融合方案

## 当前阶段

三个 Firebase 项目继续独立：

- 简单POS：订单、分行、库存、收银和收据。
- 1分钟支付：钱包、商家收款、退款和结算。
- 一分钟联盟营销系统：推荐关系、配套、奖励和提现。

当前采用按订单触发的云函数整合，不建立跨项目前端实时监听。三个项目的数据库仍然独立。

## 自动融合基础（v0.78）

POS 现在会为新订单建立确定性的 integration outbox 任务，并随订单云端事务一起保存到
`integrationJobs`。相同订单重复同步会使用相同任务编号，避免重复扣款或重复发放奖励。

- SimplePay：`simplepay.payment`、`simplepay.refund`
- 联盟系统：`affiliate.fulfill`、`affiliate.reverse`
- 每个任务都有 `idempotencyKey`、`schemaVersion`、`posOrderId`、分行、金额和处理状态
- SimplePay 未有付款参考号时只建立付款意图，并标记需要顾客授权，不会由 POS 擅自扣款
- 联盟任务可以通过 `blockedBy` 等待 SimplePay 付款或退款先完成
- 断网订单恢复联网并写入云端时，才会同时生成这些任务
- 联盟任务只由带 `affiliatePlanId` 的商品产生；当前预设商品为 `plan_rm180` / RM180
- 旧 RM150 草本演示商品已经删除，不再恢复或同步
- POS Cloud Function 会按需访问 SimplePay 与联盟项目，不保存 service-account 私钥
- 每个分行可独立设置 SimplePay 商家 ID
- SimplePay 未有参考号时，POS 收据显示付款二维码；顾客登录 SimplePay 扫码确认后才扣钱包
- SimplePay 付款完成后会回写 POS 参考号、实收金额及任务状态
- 退款先建立商家待接受请求，再由 SimplePay 管理员审批；批准后才释放联盟撤销任务
- 联盟 Cloud Function 消费 POS 命令，并把联盟订单或撤销结果回写 POS

## 统一订单关联

每张新 POS 订单包含：

- `externalReferences.posOrderId`
- `externalReferences.simplePayReference`
- `externalReferences.simplePayStatus`
- `externalReferences.affiliateReferralCode`
- `externalReferences.affiliateOrderId`
- `externalReferences.affiliateStatus`

旧订单会在本机自动补齐这些字段，不会改变原订单金额、库存或付款状态。

## 状态定义

- `not-used`：该订单没有使用对应系统。
- `pending`：已经取得推荐码或选择 SimplePay，但尚未完成外部确认。
- `linked`：已经人工核对并填写外部订单或付款参考号。
- `failed`：资料不一致，需要人工复核。
- `refunded`：SimplePay 退款已经完成。
- `reversed`：联盟权益已经撤销。
- `review-required`：联盟撤销涉及已释放奖励或积分不足，需要人工复核。
- `refund-failed`：SimplePay 退款被拒绝，需要管理员处理。
- `canceled`：付款或整合任务已取消。

## 当前操作流程

1. Google 管理员在需要时点击“同步联盟价格”，POS 按需读取联盟有效配套，不建立持续监听。
2. 在简单POS下单；联盟配套必须填写客户电话，推荐码选填。
3. 付款方式选择 SimplePay 且没有现成参考号时，POS 建立待付款订单并显示二维码。
4. 顾客登录 SimplePay 后扫码，核对固定金额并确认付款。
5. SimplePay 完成扣款后自动回写 POS；关联的联盟配套随后自动派发。
6. 到“设置 > 三系统融合准备”查看待确认、待关联和异常数量。
7. Google 管理员可按需检查最近 50 条云端整合任务。
8. 只有 `retry` 或 `needs-attention` 可请求安全重试，服务器会再次核对订单状态。
7. 仍可在“关联资料”手动处理旧订单或外部付款参考号。

## 成本控制

- 现金及其他付款不等待 SimplePay 或联盟系统。
- SimplePay 只在实际付款、退款或状态回写时产生目标项目读写。
- 不建立跨项目全局实时监听。
- 只有实际订单发生或人工更新关联资料时，才写入 POS 项目。
- SimplePay 和联盟项目暂不因 POS 页面刷新而产生读取。
- 外部系统故障时，POS 仍可现金收款、离线保存和打印小票。

## POS 权限保护

- 员工只能更新自己授权分行的销售订单。
- 员工不能通过订单更新修改金额、商品、收银员或分行。
- 员工库存更新只能改变 `branchStock` 中自己授权分行的键。
- 总店员工更新总店库存时，才允许同步旧版 `stock` 字段。
- 管理员仍保留全局维护权限。

## 联盟配套识别

- POS 检测到联盟配套商品时，必须填写客户电话，供联盟系统匹配唯一账号。
- 推荐码继续选填；有推荐码时，联盟系统会核对是否符合该账号已经固定的推荐关系。
- 即使没有推荐码，只要客户电话能匹配唯一联盟账号，仍会建立联盟订单任务。
- 无法匹配、重复电话或配套价格不一致时，任务进入需处理状态，不会静默建立错误订单。

## 取消与重试保护

- 已取消、已完成、处理中或等待顾客授权的任务不能被管理员重试接口重新启动。
- 只有 `retry` 和 `needs-attention` 状态可以人工重试。
- 收款任务只能对应未作废订单；退款及联盟撤销任务只能对应已作废订单。
- POS 取消任务时会同时取消仍在等待处理的 SimplePay 付款意图及联盟命令。

## 上线前阻挡项

1. 三个项目的云函数尚未部署。
2. 跨项目运行服务账号尚未授予最小 Firestore IAM 权限。
3. SimplePay 的 `secureMoneyFunctionsEnabled` 仍保持关闭，部署与测试完成后才评估切换。
4. 需要完成付款、退款、联盟配套及联盟撤销四条端到端测试。

本地静态部署预检已经自动化，可运行 `node scripts/integration-preflight.js`。当前预检应只有
SimplePay安全资金开关和云端IAM两项提醒，不应出现错误。

详细步骤见 `CROSS_PROJECT_SETUP.md`。
