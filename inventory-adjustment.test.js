const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

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

const syncProducts = [];
const syncAdjustments = [];
const audits = [];
const alerts = [];
const context = {
  products: [{
    id: "P1",
    name: "Product",
    barcode: "SKU1",
    stock: 5,
    branchStock: { "branch-1": 5 }
  }],
  stockAdjustments: [],
  STORAGE_KEYS: {
    products: "products",
    stockAdjustments: "stockAdjustments"
  },
  storageSucceeds: true,
  requireOperations() {
    return true;
  },
  resolveBranchId(value) {
    return value;
  },
  canManageBranch(value) {
    return value === "branch-1";
  },
  getBranchStock(product, branchId) {
    return Number(product.branchStock[branchId] || 0);
  },
  getBranchName() {
    return "Branch 1";
  },
  normalizeProductBranches(product) {
    return product;
  },
  setBranchStock(product, branchId, value) {
    return {
      ...product,
      stock: value,
      branchStock: { ...product.branchStock, [branchId]: value }
    };
  },
  getCurrentActor() {
    return { email: "cashier@example.com", name: "Cashier" };
  },
  saveStorageBatch(entries) {
    context.savedEntries = entries;
    return context.storageSucceeds;
  },
  syncProductToCloud(product) {
    syncProducts.push(product);
  },
  syncStockAdjustmentToCloud(adjustment) {
    syncAdjustments.push(adjustment);
  },
  writeAuditLog(action, detail) {
    audits.push({ action, detail });
  },
  renderAll() {
    context.renderCount = (context.renderCount || 0) + 1;
  },
  alert(message) {
    alerts.push(message);
  }
};

vm.createContext(context);
vm.runInContext(extractFunction("adjustInventoryStock"), context);

const input = {
  validityMessage: "",
  focused: false,
  setCustomValidity(message) {
    this.validityMessage = message;
  },
  reportValidity() {},
  focus() {
    this.focused = true;
  }
};

context.adjustInventoryStock("P1", "branch-1", "8", input);
assert.equal(context.products[0].branchStock["branch-1"], 8);
assert.equal(context.stockAdjustments.length, 1);
assert.equal(context.stockAdjustments[0].delta, 3);
assert.equal(context.stockAdjustments[0].reason, "库存页调整");
assert.equal(context.stockAdjustments[0].operator.email, "cashier@example.com");
assert.equal(syncProducts.length, 1);
assert.equal(syncAdjustments.length, 1);
assert.equal(audits[0].action, "inventory.adjust");
assert.equal(context.savedEntries.length, 2, "商品和库存流水必须批量保存");

context.adjustInventoryStock("P1", "branch-1", "-1", input);
assert.match(input.validityMessage, /0 或以上的整数/);
assert.equal(input.focused, true);
assert.equal(context.products[0].branchStock["branch-1"], 8);

context.storageSucceeds = false;
context.adjustInventoryStock("P1", "branch-1", "10", input);
assert.equal(context.products[0].branchStock["branch-1"], 8, "写入失败不能改变内存库存");
assert.equal(context.stockAdjustments.length, 1, "写入失败不能增加流水");

const adjustSource = extractFunction("adjustInventoryStock");
assert.doesNotMatch(adjustSource, /prompt\(/);
assert.match(source, /class="inventory-adjust-control"/);
assert.match(source, /type="number" min="0" step="1"/);

console.log("inventory-adjustment.test.js: 17 项行内库存与原子保存测试通过");
