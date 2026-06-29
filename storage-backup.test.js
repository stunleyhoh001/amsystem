const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

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

const store = new Map([
  ["products", JSON.stringify([{ id: "OLD-P" }])],
  ["sales", JSON.stringify([{ id: "OLD-S" }])],
  ["pendingSales", JSON.stringify([])]
]);
let failKey = "";
let failedOnce = false;
const storageErrors = [];
const context = {
  protectedCorruptStorageKeys: new Set(),
  localStorage: {
    get length() {
      return store.size;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (key === failKey && !failedOnce) {
        failedOnce = true;
        throw new Error("QuotaExceededError");
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  },
  reportStorageError(error) {
    storageErrors.push(error.message);
  },
  defaultAuthorizedUsers: [],
  defaultSettings: {
    businessName: "Default",
    serviceDays: 21
  },
  preferredPaymentMethod: "现金",
  normalizeSaleExternalReferences(sale) {
    return { ...sale, normalized: true };
  },
  normalizePendingManagement(value = {}) {
    return {
      branches: Array.isArray(value.branches) ? value.branches : [],
      users: Array.isArray(value.users) ? value.users : [],
      settings: value.settings || null
    };
  },
  structuredClone
};

vm.createContext(context);
for (const name of ["saveStorageBatch", "validateBackupData", "buildRestoredState"]) {
  vm.runInContext(extractFunction(name), context);
}

failKey = "sales";
const failedBatch = context.saveStorageBatch([
  ["products", [{ id: "NEW-P" }]],
  ["sales", [{ id: "NEW-S" }]],
  ["pendingSales", [{ id: "NEW-S" }]]
]);
assert.equal(failedBatch, false);
assert.equal(store.get("products"), JSON.stringify([{ id: "OLD-P" }]), "失败后商品必须回滚");
assert.equal(store.get("sales"), JSON.stringify([{ id: "OLD-S" }]), "失败后订单必须回滚");
assert.equal(store.get("pendingSales"), JSON.stringify([]), "失败后待同步队列必须回滚");
assert.match(storageErrors[0], /QuotaExceededError/);

failKey = "";
failedOnce = false;
assert.equal(context.saveStorageBatch([
  ["products", [{ id: "NEW-P" }]],
  ["sales", [{ id: "NEW-S" }]],
  ["pendingSales", [{ id: "NEW-S" }]]
]), true);
assert.equal(JSON.parse(store.get("sales"))[0].id, "NEW-S");

context.protectedCorruptStorageKeys.add("sales");
assert.equal(context.saveStorageBatch([["sales", []]]), false, "默认不能覆盖未备份的损坏原始资料");
assert.equal(context.saveStorageBatch([["sales", []]], { allowProtected: true }), true, "明确恢复备份时可以覆盖损坏键");
assert.equal(context.protectedCorruptStorageKeys.has("sales"), false);

const validBackup = {
  schemaVersion: 2,
  exportedAt: "2026-06-28T00:00:00.000Z",
  branches: [{ id: "hq", name: "总店" }],
  authorizedUsers: [{ id: "U1", email: "cashier@example.com", branchId: "hq", active: true }],
  products: [{
    id: "P1",
    name: "Plan",
    price: 150,
    branchStock: { hq: 5 }
  }],
  sales: [{
    id: "S1",
    branchId: "hq",
    createdAt: "2026-06-28T01:00:00.000Z",
    items: [{ id: "P1", name: "Plan", qty: 1, price: 150 }],
    total: 150
  }],
  pendingSales: [],
  pendingSaleUpdates: [],
  pendingProducts: [],
  pendingStockAdjustments: [],
  pendingAuditLogs: [],
  pendingManagement: { branches: [], users: [], settings: null },
  shifts: [],
  settings: { businessName: "Simple POS" },
  preferences: { paymentMethod: "现金" }
};

const validation = context.validateBackupData(validBackup);
assert.equal(validation.ok, true);
assert.equal(validation.summary.branches, 1);
assert.equal(validation.summary.products, 1);
assert.equal(validation.summary.sales, 1);
assert.equal(validation.summary.pendingCount, 0);

const duplicateBackup = structuredClone(validBackup);
duplicateBackup.branches.push({ id: "hq", name: "Duplicate" });
const duplicateValidation = context.validateBackupData(duplicateBackup);
assert.equal(duplicateValidation.ok, false);
assert.match(duplicateValidation.issues.join(" "), /分行 ID 重复/);

const invalidSaleBackup = structuredClone(validBackup);
invalidSaleBackup.sales[0].branchId = "missing";
invalidSaleBackup.sales[0].items[0].qty = 0;
const invalidSaleValidation = context.validateBackupData(invalidSaleBackup);
assert.equal(invalidSaleValidation.ok, false);
assert.match(invalidSaleValidation.issues.join(" "), /分行不存在/);
assert.match(invalidSaleValidation.issues.join(" "), /无效商品明细/);

const restored = context.buildRestoredState(validBackup);
assert.equal(restored.sales[0].normalized, true);
assert.equal(restored.appSettings.serviceDays, 21, "旧备份缺少设置时必须保留默认值");
assert.equal(restored.paymentMethod, "现金");

const batchCall = appSource.indexOf("const checkoutSaved = saveStorageBatch");
const assignProducts = appSource.indexOf("products = nextProducts", batchCall);
const failureGuard = appSource.indexOf("if (!checkoutSaved)", batchCall);
assert.ok(batchCall > -1 && failureGuard > batchCall && assignProducts > failureGuard, "结账必须先整批保存成功再修改内存");
assert.match(appSource, /schemaVersion: 2/);
assert.match(appSource, /file\.size > 25 \* 1024 \* 1024/);

console.log("storage-backup.test.js: 25 项储存回滚与备份验证测试通过");
