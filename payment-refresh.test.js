const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cloudSource = fs.readFileSync(path.join(root, "firebase-cloud.js"), "utf8");

function extractFunction(name) {
  const asyncStart = appSource.indexOf(`async function ${name}(`);
  const plainStart = appSource.indexOf(`function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : plainStart;
  assert.notEqual(start, -1, `找不到函数 ${name}`);
  const bodyStart = appSource.indexOf("{", appSource.indexOf("(", start));
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 没有完整结束`);
}

const alerts = [];
const writes = [];
const context = {
  navigator: { onLine: true },
  window: {
    cloudPOS: {
      async loadSale() {
        return {
          id: "S1",
          branchId: "branch-1",
          status: "completed",
          paid: 180,
          externalReferences: {
            simplePayReference: "SP-1",
            simplePayStatus: "linked"
          }
        };
      }
    }
  },
  STORAGE_KEYS: { sales: "sales", pendingSales: "pendingSales" },
  sales: [{
    id: "S1",
    branchId: "branch-1",
    status: "payment-pending",
    paid: 0,
    externalReferences: { simplePayReference: "", simplePayStatus: "pending" }
  }],
  pendingSales: [],
  lastReceiptSale: null,
  els: {
    receiptDialog: { open: false },
    receiptPaymentStatus: {
      textContent: "",
      classList: { add() {}, remove() {} }
    }
  },
  isSalePaymentPending(sale) {
    return sale.status === "payment-pending";
  },
  hasCloud() {
    return true;
  },
  canManageBranch(branchId) {
    return branchId === "branch-1";
  },
  normalizeSaleExternalReferences(sale) {
    return sale;
  },
  saveStorageBatch(entries) {
    writes.push(entries);
    return true;
  },
  async syncSaleToCloud() {
    return { ok: true };
  },
  renderReceiptContent() {},
  renderAll() {
    context.rendered = true;
  },
  alert(message) {
    alerts.push(message);
  }
};

vm.createContext(context);
vm.runInContext(extractFunction("refreshSimplePayPayment"), context);

(async () => {
  const button = { textContent: "检查付款状态", disabled: false };
  const refreshed = await context.refreshSimplePayPayment("S1", button);
  assert.equal(refreshed, true);
  assert.equal(context.sales[0].status, "completed");
  assert.equal(context.sales[0].paid, 180);
  assert.equal(context.sales[0].externalReferences.simplePayReference, "SP-1");
  assert.equal(writes.length, 1);
  assert.equal(context.rendered, true);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "检查付款状态");

  context.sales[0].status = "payment-pending";
  context.window.cloudPOS.loadSale = async () => ({ ...context.sales[0] });
  const stillPending = await context.refreshSimplePayPayment("S1");
  assert.equal(stillPending, false);
  assert.match(alerts.at(-1), /尚未收到 SimplePay 付款确认/);

  context.navigator.onLine = false;
  const offline = await context.refreshSimplePayPayment("S1");
  assert.equal(offline, false);
  assert.match(alerts.at(-1), /当前无法读取云端付款状态/);

  assert.match(cloudSource, /async function loadSale\(saleId\)/);
  assert.match(cloudSource, /loadSale,/);
  assert.match(appSource, /data-check-payment/);
  assert.match(appSource, /receiptCheckPaymentBtn\.addEventListener/);

  console.log("payment-refresh.test.js: 15 项单订单付款刷新测试通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
