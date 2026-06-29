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

const context = {
  adminEmail: "",
  currentBranchId: "branch-2",
  operator: null,
  getOperator() {
    return context.operator;
  }
};
vm.createContext(context);
for (const name of [
  "isAdmin",
  "getOperationalBranchId",
  "canManageBranch",
  "isBranchLockedToOperator"
]) {
  vm.runInContext(extractFunction(name), context);
}

context.adminEmail = "admin@example.com";
assert.equal(context.isAdmin(), true);
assert.equal(context.canManageBranch("hq"), true);
assert.equal(context.canManageBranch("branch-1"), true);
assert.equal(context.canManageBranch("branch-999"), true);
assert.equal(context.getOperationalBranchId(), "branch-2");
assert.equal(context.isBranchLockedToOperator(), false);

context.adminEmail = "";
context.operator = { email: "cashier@example.com", branchId: "branch-1" };
assert.equal(context.isAdmin(), false);
assert.equal(context.canManageBranch("branch-1"), true);
assert.equal(context.canManageBranch("branch-2"), false);
assert.equal(context.getOperationalBranchId(), "branch-1");
assert.equal(context.isBranchLockedToOperator(), true);

assert.match(source, /appUser\.role === "admin" \? currentBranchId/);
assert.match(source, /管理员可切换总店与所有分行/);
assert.match(source, /branchId: "hq",[\s\S]*?role: "admin"/);

console.log("branch-access.test.js: 14 项管理员全局与员工单分行权限测试通过");
