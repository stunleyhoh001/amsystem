const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  const asyncStart = appSource.indexOf(`async function ${name}(`);
  const functionStart = start === -1 ? asyncStart : (asyncStart === -1 ? start : Math.min(start, asyncStart));
  assert.notEqual(functionStart, -1, `找不到函数 ${name}`);
  const parametersStart = appSource.indexOf("(", functionStart);
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
    if (bodyDepth === 0) return appSource.slice(functionStart, index + 1);
  }
  throw new Error(`函数 ${name} 没有完整结束`);
}

const callCounts = {
  products: 0,
  management: 0,
  adjustments: 0,
  audits: 0,
  sales: 0,
  updates: 0
};
const context = {
  products: [{
    id: "P1",
    name: "Product 1",
    stock: 7,
    branchStock: { hq: 7, "branch-1": 4, "branch-2": 18 }
  }, {
    id: "P2",
    name: "Pending Product",
    stock: 3,
    branchStock: { hq: 3, "branch-1": 2, "branch-2": 1 }
  }, {
    id: "P3",
    name: "New Pending Product",
    stock: 5,
    branchStock: { hq: 5, "branch-1": 0, "branch-2": 0 }
  }],
  pendingProducts: [],
  pendingSales: [],
  pendingManagement: { branches: [], users: [], settings: null },
  pendingSyncPromise: null,
  savePendingManagement() {
    context.savedPendingManagement = structuredClone(context.pendingManagement);
  },
  updateCloudStatus(text) {
    context.cloudStatus = text;
  },
  async syncPendingProducts() {
    callCounts.products += 1;
    await Promise.resolve();
  },
  async syncPendingManagementChanges() {
    callCounts.management += 1;
  },
  normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  },
  async syncPendingStockAdjustments() {
    callCounts.adjustments += 1;
  },
  async syncPendingAuditLogs() {
    callCounts.audits += 1;
  },
  async syncPendingSales() {
    callCounts.sales += 1;
  },
  async syncPendingSaleUpdates() {
    callCounts.updates += 1;
  },
  normalizeProductBranches(product) {
    return {
      ...product,
      branchStock: { ...(product.branchStock || {}) }
    };
  },
  getBranchStock(product, branchId) {
    return Number(product.branchStock?.[branchId] || 0);
  },
  setBranchStock(product, branchId, stock) {
    return {
      ...product,
      stock: branchId === "hq" ? stock : product.stock,
      branchStock: {
        ...(product.branchStock || {}),
        [branchId]: stock
      }
    };
  }
};

vm.createContext(context);
vm.runInContext(extractFunction("getPendingManagementCount"), context);
vm.runInContext(extractFunction("queuePendingManagement"), context);
vm.runInContext(extractFunction("markManagementSynced"), context);
vm.runInContext(extractFunction("mergeCloudBranchesWithPending"), context);
vm.runInContext(extractFunction("mergeCloudUsersWithPending"), context);
vm.runInContext(extractFunction("mergeCloudProductsWithPending"), context);
vm.runInContext(extractFunction("syncPendingChanges"), context);

context.queuePendingManagement("branch", { id: "branch-3", name: "Local New Branch" });
context.queuePendingManagement("branch", { id: "branch-3", name: "Updated Local Branch" });
context.queuePendingManagement("user", { email: "cashier@example.com", branchId: "branch-3", active: true });
context.queuePendingManagement("settings", { businessName: "Local Settings" });
assert.equal(context.getPendingManagementCount(), 3, "同一后台资料必须去重排队");
assert.equal(context.pendingManagement.branches[0].name, "Updated Local Branch");
context.markManagementSynced("branch", "branch-3");
context.markManagementSynced("user", "cashier@example.com");
context.markManagementSynced("settings");
assert.equal(context.getPendingManagementCount(), 0, "同步成功后必须逐项清除管理队列");

context.pendingProducts = [
  structuredClone(context.products[1]),
  structuredClone(context.products[2])
];
context.pendingSales = [{
  id: "SALE-1",
  branchId: "branch-1",
  items: [{ id: "P1", qty: 2 }]
}];
context.pendingManagement = {
  branches: [{ id: "branch-3", name: "Local New Branch" }],
  users: [{ id: "U1", email: "cashier@example.com", branchId: "branch-3", active: false }],
  settings: { businessName: "Local Settings" }
};

const cloudProducts = [{
  id: "P1",
  name: "Product 1",
  stock: 10,
  branchStock: { hq: 10, "branch-1": 9, "branch-2": 20 }
}, {
  id: "P2",
  name: "Old Cloud Product",
  stock: 99,
  branchStock: { hq: 99, "branch-1": 99, "branch-2": 99 }
}];

const merged = context.mergeCloudProductsWithPending(cloudProducts);
const product1 = merged.find((product) => product.id === "P1");
const product2 = merged.find((product) => product.id === "P2");
const product3 = merged.find((product) => product.id === "P3");
assert.equal(product1.branchStock["branch-1"], 4, "待同步订单分行库存必须保留本机值");
assert.equal(product1.branchStock["branch-2"], 20, "不相关分行必须采用云端最新值");
assert.equal(product1.stock, 10, "总店不相关时采用云端最新值");
assert.equal(product2.name, "Pending Product", "待同步商品必须完整保留本机版本");
assert.equal(product2.branchStock.hq, 3);
assert.ok(product3, "云端尚不存在的待同步新商品不能丢失");

const mergedBranches = context.mergeCloudBranchesWithPending([
  { id: "hq", name: "HQ" },
  { id: "branch-3", name: "Old Cloud Branch" }
]);
assert.equal(mergedBranches.find((branch) => branch.id === "branch-3").name, "Local New Branch");

const mergedUsers = context.mergeCloudUsersWithPending([
  { id: "U1", email: "cashier@example.com", branchId: "branch-1", active: true }
]);
assert.equal(mergedUsers[0].branchId, "branch-3");
assert.equal(mergedUsers[0].active, false, "待同步停用操作不能被旧云端启用状态覆盖");

Promise.all([
  context.syncPendingChanges(),
  context.syncPendingChanges(),
  context.syncPendingChanges()
]).then(() => {
  assert.deepEqual(callCounts, {
    products: 1,
    management: 1,
    adjustments: 1,
    audits: 1,
    sales: 1,
    updates: 1
  }, "并发补传必须合并为同一轮");
  assert.equal(context.pendingSyncPromise, null, "补传完成后必须释放锁");

  const applyStart = appSource.indexOf("async function applyCloudUser");
  const syncPosition = appSource.indexOf("await syncPendingChanges()", applyStart);
  const loadPosition = appSource.indexOf("await loadCloudData()", syncPosition);
  assert.ok(syncPosition > applyStart && loadPosition > syncPosition, "登录后必须先补传再读取云端");
  assert.match(appSource, /els\.refreshCloudBtn\.addEventListener\("click", syncThenLoadCloudData\)/);

  assert.match(appSource, /pendingManagement,\s*\n\s*stockAdjustments/);
  assert.match(appSource, /normalizePendingManagement\(backup\.pendingManagement\)/);

  console.log("sync-consistency.test.js: 24 项同步顺序与本机资料保护测试通过");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
