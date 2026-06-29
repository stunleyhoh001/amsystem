const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const simplePayFunctions = fs.readFileSync(
  "C:\\Users\\PC19\\Documents\\1分钟支付\\functions\\index.js",
  "utf8"
);

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到函数 ${name}`);
  const bodyStart = source.indexOf("{", source.indexOf("(", start));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 没有完整结束`);
}

const context = {};
vm.createContext(context);
for (const name of [
  "isSaleVoided",
  "isSalePaymentPending",
  "getSaleStatusText",
  "getActiveSales",
  "getNonVoidedSales"
]) {
  vm.runInContext(extractFunction(name), context);
}

const legacySale = { id: "old", total: 10 };
const completedSale = { id: "paid", status: "completed", total: 20 };
const pendingSale = { id: "pending", status: "payment-pending", total: 30 };
const voidedSale = { id: "voided", status: "voided", total: 40 };
const all = [legacySale, completedSale, pendingSale, voidedSale];

assert.equal(context.isSalePaymentPending(pendingSale), true);
assert.equal(context.isSalePaymentPending(completedSale), false);
assert.match(context.getSaleStatusText(pendingSale), /等待 SimplePay 付款/);
assert.match(context.getSaleStatusText(pendingSale), /库存已预留/);
assert.deepEqual(
  Array.from(context.getActiveSales(all), (sale) => sale.id),
  ["old", "paid"],
  "待付款和作废订单都不能进入收入"
);
assert.deepEqual(
  Array.from(context.getNonVoidedSales(all), (sale) => sale.id),
  ["old", "paid", "pending"],
  "待付款订单仍需进入关联与风险核对"
);
assert.match(source, /status: simplePayPending \? "payment-pending" : "completed"/);
assert.match(source, /pendingPaymentSales\.length[\s\S]*?不计入收入/);
assert.match(source, /const completedSelectedSales = getActiveSales\(selectedSales\)/);
assert.match(source, /row\.classList\.toggle\("payment-pending"/);
assert.match(source, /取消待付款并释放库存/);
assert.match(source, /sale\.payment-pending\.cancel/);
assert.doesNotMatch(
  extractFunction("voidSale"),
  /prompt\(/,
  "取消或退款不应要求输入确认文字"
);
assert.match(simplePayFunctions, /status: "completed",[\s\S]*?"externalReferences\.simplePayStatus": "linked"/);

console.log("payment-pending.test.js: 15 项待付款与收入隔离测试通过");
