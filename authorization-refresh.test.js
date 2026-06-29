const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cloudSource = fs.readFileSync(path.join(root, "firebase-cloud.js"), "utf8");

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
  let bodyDepth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === "{") bodyDepth += 1;
    if (appSource[index] === "}") bodyDepth -= 1;
    if (bodyDepth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 没有完整结束`);
}

const storage = new Map();
const sessionStorageValues = new Map();
const audits = [];
const alerts = [];
const context = {
  AUTHORIZATION_REFRESH_INTERVAL_MS: 15 * 60 * 1000,
  STORAGE_KEYS: {
    authorizedUsers: "authorizedUsers",
    adminEmail: "adminEmail",
    operatorEmail: "operatorEmail",
    branchId: "branchId"
  },
  authorizedUsers: [],
  currentCloudUser: null,
  operatorEmail: "",
  adminEmail: "",
  currentBranchId: "branch-1",
  currentShift: null,
  cloudSessionActive: false,
  lastAuthorizationCheckAt: 0,
  cart: [],
  localStorage: {
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    }
  },
  persistSessionEmail(key, value) {
    sessionStorageValues.set(key, String(value));
    storage.delete(key);
  },
  clearSessionEmail(key) {
    sessionStorageValues.delete(key);
    storage.delete(key);
  },
  normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  },
  save(key, value) {
    storage.set(key, structuredClone(value));
  },
  writeAuditLog(action, detail) {
    audits.push({ action, detail });
  },
  hasOpenShift() {
    return Boolean(context.currentShift && !context.currentShift.closedAt);
  },
  isShiftIdentity(email, branchId) {
    return context.hasOpenShift()
      && context.normalizeEmail(context.currentShift.operatorEmail) === context.normalizeEmail(email)
      && context.currentShift.branchId === branchId;
  },
  updateCloudStatus(text) {
    context.cloudStatus = text;
  },
  logoutCloudIfReady() {
    context.signedOut = true;
  },
  renderAll() {
    context.renderCount = (context.renderCount || 0) + 1;
  },
  alert(message) {
    alerts.push(message);
  },
  structuredClone
};

vm.createContext(context);
for (const name of [
  "isCloudAuthorizationValid",
  "shouldRefreshCloudAuthorization",
  "cacheCloudAuthorizedUser",
  "lockCloudSession",
  "lockOfflineSessionForOnlineVerification",
  "applyRefreshedAuthorization"
]) {
  vm.runInContext(extractFunction(name), context);
}

assert.equal(context.isCloudAuthorizationValid(null), false);
assert.equal(context.isCloudAuthorizationValid({ active: false }), false);
assert.equal(context.isCloudAuthorizationValid({ active: true }), true);

context.lastAuthorizationCheckAt = 1000;
assert.equal(context.shouldRefreshCloudAuthorization(false, 2000), false, "15 分钟内不应重复读取");
assert.equal(context.shouldRefreshCloudAuthorization(false, 1000 + 15 * 60 * 1000), true);
assert.equal(context.shouldRefreshCloudAuthorization(true, 2000), true, "恢复联网必须强制核对");

context.authorizedUsers = [{
  id: "U1",
  email: "cashier@example.com",
  branchId: "branch-1",
  active: true,
  offlinePasswordHash: "keep-me"
}];
context.currentCloudUser = { email: "cashier@example.com", branchId: "branch-1", active: true };
context.operatorEmail = "cashier@example.com";
context.adminEmail = "stale-admin@example.com";
storage.set("adminEmail", context.adminEmail);
context.cloudSessionActive = true;
context.cart = [{ id: "P1" }];
context.currentBranchId = "branch-1";

assert.equal(context.applyRefreshedAuthorization({
  id: "U1",
  email: "cashier@example.com",
  name: "Cashier",
  role: "POS用户",
  branchId: "branch-2",
  active: true
}), true);
assert.equal(context.currentBranchId, "branch-2", "无进行中班次时应切换到新授权分行");
assert.equal(context.cart.length, 0, "改派分行时必须清空旧分行购物车");
assert.equal(context.authorizedUsers[0].offlinePasswordHash, "keep-me", "刷新授权不能清除离线密码");
assert.equal(context.adminEmail, "", "员工授权刷新必须清除残留管理员身份");
assert.equal(storage.has("adminEmail"), false);

context.currentShift = {
  id: "SHIFT-1",
  branchId: "branch-2",
  operatorEmail: "cashier@example.com",
  openedAt: "2026-06-28T00:00:00.000Z"
};
context.currentCloudUser = { email: "cashier@example.com", branchId: "branch-2", active: true };
context.operatorEmail = "cashier@example.com";
context.cloudSessionActive = true;
assert.equal(context.applyRefreshedAuthorization({
  id: "U1",
  email: "cashier@example.com",
  role: "POS用户",
  branchId: "branch-3",
  active: true
}), false, "进行中班次遇到改派分行必须锁定");
assert.equal(context.currentShift.id, "SHIFT-1", "锁定账号不能删除进行中班次");
assert.equal(context.operatorEmail, "");
assert.match(alerts.at(-1), /班次已锁定/);

context.authorizedUsers = [{
  id: "U1",
  email: "cashier@example.com",
  branchId: "branch-3",
  active: true
}];
context.currentCloudUser = { email: "cashier@example.com" };
context.operatorEmail = "cashier@example.com";
context.cloudSessionActive = true;
context.lockCloudSession("cashier@example.com", "账号已被停用", true);
assert.equal(context.authorizedUsers[0].active, false);
assert.equal(context.currentCloudUser, null);
assert.equal(context.cloudSessionActive, false);
assert.equal(context.lastAuthorizationCheckAt, 0);
assert.equal(audits.at(-1).action, "authorization.session-locked");

context.currentCloudUser = null;
context.operatorEmail = "cashier@example.com";
context.adminEmail = "";
context.cloudSessionActive = false;
context.cart = [{ id: "P2" }];
storage.set("operatorEmail", "cashier@example.com");
assert.equal(context.lockOfflineSessionForOnlineVerification(), true);
assert.equal(context.operatorEmail, "");
assert.equal(context.cart.length, 0);
assert.equal(context.currentShift.id, "SHIFT-1", "联网重验不能删除离线班次");
assert.match(alerts.at(-1), /Google 登录重新验证身份/);

assert.match(cloudSource, /async function refreshAuthorization\(\)/);
assert.match(cloudSource, /refreshAuthorization,/);
assert.match(appSource, /window\.addEventListener\("online", async/);
assert.match(appSource, /document\.addEventListener\("visibilitychange"/);

console.log("authorization-refresh.test.js: 27 项授权刷新与自动锁定测试通过");
