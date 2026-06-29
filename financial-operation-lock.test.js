const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(htmlSource, /id="cashMovementSubmitBtn"/, "现金流水保存按钮应有稳定的 DOM 标识");
assert.match(appSource, /let checkoutInProgress = false;/, "收款应有执行锁");
assert.match(appSource, /if \(checkoutInProgress\) return;/, "重复收款点击应被忽略");
assert.match(appSource, /els\.confirmPaymentBtn\.disabled = true;/, "保存订单时应禁用确认收款按钮");
assert.match(appSource, /finally \{[\s\S]*checkoutInProgress = false;[\s\S]*els\.confirmPaymentBtn\.disabled = false;/, "收款结束后应恢复按钮");

const cashStart = appSource.indexOf("function recordCashMovement(event)");
const cashEnd = appSource.indexOf("\nfunction reverseCashMovement", cashStart);
const cashSource = appSource.slice(cashStart, cashEnd);
assert.match(cashSource, /if \(cashMovementInProgress\) return;/, "重复现金流水提交应被忽略");
assert.match(cashSource, /const nextShift = structuredClone\(currentShift\);/, "现金流水保存前不应直接改变当前班次");
assert.match(cashSource, /if \(!save\(STORAGE_KEYS\.currentShift, nextShift\)\)/, "应先确认现金流水已经写入本机");
assert.ok(
  cashSource.indexOf("currentShift = nextShift;") > cashSource.indexOf("if (!save(STORAGE_KEYS.currentShift, nextShift))"),
  "只有保存成功后才可替换当前班次"
);
assert.match(cashSource, /finally \{[\s\S]*cashMovementInProgress = false;[\s\S]*cashMovementSubmitBtn\.disabled = false;/, "现金流水完成后应恢复按钮");

const shiftStart = appSource.indexOf("function ensureCurrentShift(");
const shiftEnd = appSource.indexOf("\nfunction getShiftAllSales", shiftStart);
const shiftSource = appSource.slice(shiftStart, shiftEnd);
assert.match(shiftSource, /const nextShift = \{/);
assert.match(shiftSource, /if \(!save\(STORAGE_KEYS\.currentShift, nextShift\)\)/);
assert.ok(
  shiftSource.indexOf("currentShift = nextShift;") > shiftSource.indexOf("if (!save(STORAGE_KEYS.currentShift, nextShift))"),
  "开班必须在保存成功后才替换当前班次"
);

const reversalStart = appSource.indexOf("function reverseCashMovement(");
const reversalEnd = appSource.indexOf("\nfunction updateSettlementDifference", reversalStart);
const reversalSource = appSource.slice(reversalStart, reversalEnd);
assert.match(reversalSource, /const nextShift = structuredClone\(currentShift\);/);
assert.match(reversalSource, /if \(!save\(STORAGE_KEYS\.currentShift, nextShift\)\)/);

const settlementStart = appSource.indexOf("function confirmShiftSettlement(");
const settlementEnd = appSource.indexOf("\nfunction buildShiftSettlementRows", settlementStart);
const settlementSource = appSource.slice(settlementStart, settlementEnd);
assert.match(settlementSource, /const settlementSaved = saveStorageBatch\(\[/);
assert.match(settlementSource, /\[STORAGE_KEYS\.shifts, nextShifts\]/);
assert.match(settlementSource, /\[STORAGE_KEYS\.currentShift, null\]/);
assert.ok(
  settlementSource.indexOf("currentShift = null;") > settlementSource.indexOf("if (!settlementSaved)"),
  "交班必须在班次与历史记录整批保存成功后才清空当前班次"
);

console.log("financial operation lock tests passed");
