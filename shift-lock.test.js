const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到函数 ${name}`);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 没有完整结束`);
}

const alerts = [];
const context = {
  activeOperator: null,
  admin: false,
  currentBranchId: "bukit-indah",
  currentShift: null,
  els: { shiftOpeningCashInput: { value: "20.00" } },
  alerts,
  alert(message) {
    alerts.push(message);
  },
  getActiveCashier() {
    return context.activeOperator;
  },
  getBranchName(branchId) {
    return branchId === "bukit-indah" ? "Bukit Indah" : "Nusa Bestari";
  },
  isAdmin() {
    return context.admin;
  },
  normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  },
  savedShift: null,
  sales: [],
  STORAGE_KEYS: { currentShift: "currentShift" },
  save(key, value) {
    context.savedShift = structuredClone(value);
    return true;
  },
  saveCurrentShift() {
    context.savedShift = structuredClone(context.currentShift);
  },
  structuredClone
};

vm.createContext(context);
for (const name of [
  "hasOpenShift",
  "isShiftIdentity",
  "isCurrentShiftOwner",
  "canManageCurrentShift",
  "getCurrentShiftLabel",
  "ensureCurrentShift",
  "getShiftAllSales"
]) {
  vm.runInContext(extractFunction(name), context);
}

assert.equal(context.ensureCurrentShift(), false, "未登录时不能开班");

context.activeOperator = {
  name: "Cashier A",
  email: "cashier-a@example.com",
  branchId: "bukit-indah"
};
assert.equal(context.ensureCurrentShift(), true, "员工应能首次开班");
assert.equal(context.currentShift.operatorEmail, "cashier-a@example.com");
assert.equal(context.currentShift.branchId, "bukit-indah");
assert.equal(context.currentShift.openingCash, 20);

const originalShiftId = context.currentShift.id;
assert.equal(context.ensureCurrentShift(), true, "原员工应能恢复班次");
assert.equal(context.currentShift.id, originalShiftId, "恢复班次不能建立新班次");

context.activeOperator = {
  name: "Cashier B",
  email: "cashier-b@example.com",
  branchId: "bukit-indah"
};
assert.equal(context.ensureCurrentShift(), false, "其他员工不能覆盖班次");
assert.equal(context.currentShift.id, originalShiftId);
assert.match(alerts.at(-1), /原员工恢复班次/);

context.activeOperator = {
  name: "Cashier A",
  email: "cashier-a@example.com",
  branchId: "nusa-bestari"
};
context.currentBranchId = "nusa-bestari";
assert.equal(context.ensureCurrentShift(), false, "同一员工也不能跨分行覆盖班次");
assert.equal(context.currentShift.branchId, "bukit-indah");

context.admin = true;
assert.equal(context.canManageCurrentShift(), true, "管理员应能处理进行中班次");

context.sales = [
  { id: "A", shiftId: "SHIFT-A", branchId: "bukit-indah", createdAt: "2026-06-28T01:05:00.000Z" },
  { id: "B", shiftId: "SHIFT-B", branchId: "bukit-indah", createdAt: "2026-06-28T01:06:00.000Z" },
  { id: "LEGACY", branchId: "bukit-indah", createdAt: "2026-06-28T01:07:00.000Z" }
];
const shiftSales = context.getShiftAllSales({
  id: "SHIFT-A",
  branchId: "bukit-indah",
  openedAt: "2026-06-28T01:00:00.000Z",
  closedAt: "2026-06-28T02:00:00.000Z"
});
assert.deepEqual(Array.from(shiftSales, (sale) => sale.id), ["A", "LEGACY"], "班次不能计入其他收银台的订单");

console.log("shift-lock.test.js: 7 项班次安全测试通过");
