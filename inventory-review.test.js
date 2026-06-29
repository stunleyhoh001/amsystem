const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cloudSource = fs.readFileSync(path.join(root, "firebase-cloud.js"), "utf8");
const rulesSource = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
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
  assert.notEqual(bodyStart, -1, `找不到函数主体 ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 没有完整结束`);
}

const saved = {};
const auditLogs = [];
const context = {
  sales: [{
    id: "SALE-1",
    branchId: "branch-1",
    syncStatus: "pending"
  }],
  pendingSales: [{ id: "SALE-1" }],
  pendingSaleUpdates: [],
  save(key, value) {
    saved[key] = structuredClone(value);
  },
  savePendingSales() {
    saved.pendingSales = structuredClone(context.pendingSales);
  },
  writeAuditLog(action, detail) {
    auditLogs.push({ action, detail });
  },
  updateCloudStatus(text) {
    context.cloudStatus = text;
  },
  STORAGE_KEYS: { sales: "sales" },
  normalizeSaleExternalReferences(sale) {
    return {
      ...sale,
      externalReferences: sale.externalReferences || {
        simplePayStatus: "not-used",
        affiliateStatus: "not-used"
      }
    };
  },
  structuredClone
};

vm.createContext(context);
for (const name of [
  "getInventoryReviewStatus",
  "requiresInventoryReview",
  "getInventoryConflictSummary",
  "markSaleSynced",
  "applyCheckoutSyncResult",
  "matchesIntegrationFilter"
]) {
  vm.runInContext(extractFunction(name), context);
}

const inventoryReview = {
  status: "required",
  branchId: "branch-1",
  detectedAt: "2026-06-28T00:00:00.000Z",
  conflicts: [{
    productId: "P1",
    productName: "简单草本减脂计划第一阶段",
    requestedQty: 2,
    cloudStock: 1,
    reason: "云端库存不足"
  }]
};

assert.equal(
  context.applyCheckoutSyncResult("SALE-1", { status: "inventory-review", inventoryReview }),
  true,
  "库存冲突必须进入复核状态"
);
assert.equal(context.pendingSales.length, 0, "冲突订单已保存云端后不能无限重试");
assert.equal(context.sales[0].syncStatus, "review-required");
assert.equal(context.requiresInventoryReview(context.sales[0]), true);
assert.equal(context.matchesIntegrationFilter(context.sales[0], "inventory-review"), true);
assert.match(context.getInventoryConflictSummary(context.sales[0]), /需 2，云端 1/);
assert.equal(auditLogs[0].action, "inventory.conflict.detected");

context.sales[0].inventoryReview.status = "resolved";
assert.equal(context.matchesIntegrationFilter(context.sales[0], "inventory-resolved"), true);
assert.equal(context.requiresInventoryReview(context.sales[0]), false);

const conflictBranch = cloudSource.indexOf("if (conflicts.length)");
const stockUpdateBranch = cloudSource.indexOf("snapshots.forEach((snapshot, index) => {", conflictBranch);
assert.ok(conflictBranch > -1 && stockUpdateBranch > conflictBranch, "云端必须先判断全部冲突，再统一扣库存");
assert.match(cloudSource, /syncStatus: "review-required"/);
assert.match(rulesSource, /"inventoryReview"/, "Firestore 规则必须允许同步库存复核状态");

console.log("inventory-review.test.js: 11 项库存冲突与复核测试通过");
