const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cloudSource = fs.readFileSync(path.join(root, "firebase-cloud.js"), "utf8");
const rulesSource = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

function extractFunction(name) {
  const plainStart = appSource.indexOf(`function ${name}(`);
  const asyncStart = appSource.indexOf(`async function ${name}(`);
  const start = plainStart === -1 ? asyncStart : (asyncStart === -1 ? plainStart : Math.min(plainStart, asyncStart));
  assert.notEqual(start, -1, `找不到函数 ${name}`);
  const parametersStart = appSource.indexOf("(", start);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = parametersStart; index < appSource.length; index += 1) {
    if (appSource[index] === "(") parameterDepth += 1;
    if (appSource[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      bodyStart = appSource.indexOf("{", index);
      break;
    }
  }
  let bodyDepth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") bodyDepth += 1;
    if (appSource[index] === "}") bodyDepth -= 1;
    if (bodyDepth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 没有完整结束`);
}

const saved = {};
const context = {
  STORAGE_KEYS: { sales: "sales" },
  sales: [{
    id: "VOID-1",
    status: "voided",
    syncStatus: "pending-update"
  }],
  pendingSaleUpdates: [{
    id: "VOID-1",
    status: "voided"
  }],
  savePendingSaleUpdates() {
    saved.pendingSaleUpdates = structuredClone(context.pendingSaleUpdates);
  },
  save(key, value) {
    saved[key] = structuredClone(value);
  },
  updateCloudStatus(text, ok) {
    context.cloudStatus = { text, ok };
  },
  structuredClone,
  Object
};

vm.createContext(context);
vm.runInContext(extractFunction("markSaleUpdateSynced"), context);
vm.runInContext(extractFunction("applyVoidSyncResult"), context);

const inventoryReview = {
  status: "required",
  type: "void-restock",
  conflicts: [{
    productId: "P1",
    productName: "Missing Product",
    requestedQty: 1,
    cloudStock: null
  }]
};
assert.equal(context.applyVoidSyncResult("VOID-1", {
  status: "voided",
  stockStatus: "review-required",
  inventoryReview
}), true);
assert.equal(context.pendingSaleUpdates.length, 0);
assert.equal(context.sales[0].syncStatus, "review-required");
assert.equal(context.sales[0].inventoryReview.type, "void-restock");
assert.match(context.cloudStatus.text, /退款库存待复核/);
assert.equal(context.cloudStatus.ok, false);

context.pendingSaleUpdates = [{ id: "VOID-1", status: "voided" }];
context.sales[0].syncStatus = "pending-update";
assert.equal(context.applyVoidSyncResult("VOID-1", {
  status: "voided",
  stockStatus: "restored",
  inventoryReview: null
}), false);
assert.equal(context.sales[0].syncStatus, "synced");
assert.equal(context.pendingSaleUpdates.length, 0);
assert.match(context.cloudStatus.text, /退款与库存已同步/);

const saveVoidStart = cloudSource.indexOf("async function saveVoid(sale)");
const alreadyVoidedCheck = cloudSource.indexOf('existingSale.status === "voided"', saveVoidStart);
const productRead = cloudSource.indexOf("transaction.get(doc(db, \"products\"", saveVoidStart);
const missingCheck = cloudSource.indexOf("if (hadInventoryConflict)", productRead);
const productWrite = cloudSource.indexOf("transaction.update(snapshot.ref", missingCheck);
const saleWrite = cloudSource.indexOf("transaction.update(saleRef", productWrite);
assert.ok(saveVoidStart > -1, "必须提供云端退款事务");
assert.ok(alreadyVoidedCheck > saveVoidStart, "事务必须先检查订单是否已经作废");
assert.ok(productRead > alreadyVoidedCheck, "只有未作废订单才读取商品");
assert.ok(missingCheck > productRead && productWrite > missingCheck, "必须先检查全部商品，再统一回补");
assert.ok(saleWrite > productWrite, "库存和订单作废必须处于同一事务");
assert.match(cloudSource, /"already-processed"/);
assert.match(cloudSource, /type: "void-restock"/);
assert.match(cloudSource, /saveCheckout,\s*\n\s*saveVoid/);
assert.match(rulesSource, /"inventoryReview"/);

const voidFunctionStart = appSource.indexOf("function voidSale(saleId)");
const batchSave = appSource.indexOf("const voidSaved = saveStorageBatch", voidFunctionStart);
const assignProducts = appSource.indexOf("products = nextProducts", batchSave);
const syncVoid = appSource.indexOf("syncVoidToCloud(updatedSale)", assignProducts);
assert.ok(batchSave > voidFunctionStart && assignProducts > batchSave && syncVoid > assignProducts, "本机退款必须先整批保存，再同步云端事务");
const voidBatchSource = appSource.slice(batchSave, assignProducts);
assert.match(voidBatchSource, /STORAGE_KEYS\.stockAdjustments/);
assert.match(voidBatchSource, /STORAGE_KEYS\.pendingStockAdjustments/);
assert.doesNotMatch(
  appSource.slice(voidFunctionStart, appSource.indexOf("function renderFollowUps", voidFunctionStart)),
  /syncProductToCloud/,
  "退款不能再用整份商品覆盖云端库存"
);

console.log("refund-transaction.test.js: 22 项幂等退款与库存事务测试通过");
