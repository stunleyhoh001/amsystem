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

function classList() {
  const values = new Set();
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    toggle(value, force) {
      if (force === true) values.add(value);
      else if (force === false) values.delete(value);
      else if (values.has(value)) values.delete(value);
      else values.add(value);
    },
    contains(value) {
      return values.has(value);
    }
  };
}

const sessions = new Map();
const alerts = [];
const syncedUsers = [];
const audits = [];
const context = {
  navigator: { onLine: true },
  STORAGE_KEYS: {
    adminEmail: "adminEmail",
    operatorEmail: "operatorEmail",
    authorizedUsers: "authorizedUsers"
  },
  els: {
    adminEmailInput: { value: "admin@example.com" },
    adminPasswordInput: { value: "correct-password", focus() {} },
    adminLoginMessage: { textContent: "", classList: classList() },
    adminOfflinePasswordInput: { value: "", focus() {} },
    adminOfflinePasswordConfirm: { value: "", focus() {} },
    adminOfflinePasswordForm: { reset() { context.formReset = true; } },
    adminOfflinePasswordStatus: { textContent: "", classList: classList() }
  },
  adminEmail: "",
  operatorEmail: "",
  currentCloudUser: null,
  authorizedUsers: [],
  OFFLINE_PASSWORD_ITERATIONS: 210000,
  normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  },
  async isConfiguredAdminEmail(email) {
    return email === "admin@example.com";
  },
  async verifyOfflinePassword(user, password) {
    return user.offlinePasswordHash === "stored-hash" && password === "correct-password";
  },
  persistSessionEmail(key, value) {
    sessions.set(key, String(value));
  },
  async signInWithGoogle() {
    context.googleSignInCount = (context.googleSignInCount || 0) + 1;
  },
  renderAll() {
    context.renderCount = (context.renderCount || 0) + 1;
  },
  requireCloudAdmin() {
    return context.currentCloudUser?.role === "admin";
  },
  createPasswordSalt() {
    return "salt";
  },
  async hashOfflinePassword(email, password, salt) {
    return `${salt}:${email}:${password}`;
  },
  save(key, value) {
    context.savedUsers = { key, value: structuredClone(value) };
    return true;
  },
  async syncManagementToCloud(type, user) {
    syncedUsers.push({ type, user: structuredClone(user) });
    return context.cloudSyncResult ?? true;
  },
  writeAuditLog(action, detail) {
    audits.push({ action, detail });
  },
  renderManagementLists() {
    context.managementRendered = true;
  },
  alert(message) {
    alerts.push(message);
  },
  structuredClone
};

vm.createContext(context);
vm.runInContext(extractFunction("loginAdmin"), context);
vm.runInContext(extractFunction("saveAdminOfflinePassword"), context);

const event = { preventDefault() {} };

(async () => {
  await context.loginAdmin(event);
  assert.equal(context.googleSignInCount, 1, "联网邮箱表单必须转向 Google");
  assert.equal(context.adminEmail, "", "联网时不能直接建立本机管理员身份");
  assert.match(context.els.adminLoginMessage.textContent, /必须使用 Google/);

  context.navigator.onLine = false;
  context.authorizedUsers = [{
    id: "admin-user",
    email: "admin@example.com",
    role: "admin",
    branchId: "hq",
    active: true
  }];
  await context.loginAdmin(event);
  assert.equal(context.adminEmail, "");
  assert.match(context.els.adminLoginMessage.textContent, /尚未设置离线密码/);

  context.authorizedUsers[0].offlinePasswordHash = "stored-hash";
  context.els.adminPasswordInput.value = "wrong-password";
  await context.loginAdmin(event);
  assert.equal(context.adminEmail, "");
  assert.match(context.els.adminLoginMessage.textContent, /密码不正确/);

  context.els.adminPasswordInput.value = "correct-password";
  await context.loginAdmin(event);
  assert.equal(context.adminEmail, "admin@example.com");
  assert.equal(context.operatorEmail, "admin@example.com");
  assert.equal(sessions.get("adminEmail"), "admin@example.com");
  assert.equal(sessions.get("operatorEmail"), "admin@example.com");
  assert.match(context.els.adminLoginMessage.textContent, /离线身份已验证/);

  context.currentCloudUser = {
    id: "admin-user",
    email: "admin@example.com",
    name: "Admin",
    role: "admin",
    branchId: "hq",
    active: true
  };
  context.els.adminOfflinePasswordInput.value = "new-password";
  context.els.adminOfflinePasswordConfirm.value = "different-password";
  await context.saveAdminOfflinePassword(event);
  assert.match(alerts.at(-1), /不一致/);
  assert.equal(syncedUsers.length, 0);

  context.els.adminOfflinePasswordConfirm.value = "new-password";
  await context.saveAdminOfflinePassword(event);
  const updatedAdmin = context.authorizedUsers.find((user) => user.email === "admin@example.com");
  assert.equal(updatedAdmin.offlinePasswordSalt, "salt");
  assert.equal(updatedAdmin.offlinePasswordHash, "salt:admin@example.com:new-password");
  assert.equal(updatedAdmin.offlinePasswordAlgorithm, "PBKDF2-SHA256");
  assert.equal(updatedAdmin.offlinePasswordIterations, 210000);
  assert.equal(syncedUsers[0].type, "user");
  assert.equal(syncedUsers[0].user.role, "admin");
  assert.equal(audits[0].action, "admin.offline-password.update");
  assert.equal(context.formReset, true);
  assert.match(context.els.adminOfflinePasswordStatus.textContent, /安全更新/);
  assert.equal(context.els.adminOfflinePasswordStatus.classList.contains("error"), false);

  context.cloudSyncResult = false;
  context.els.adminOfflinePasswordInput.value = "another-password";
  context.els.adminOfflinePasswordConfirm.value = "another-password";
  await context.saveAdminOfflinePassword(event);
  assert.match(context.els.adminOfflinePasswordStatus.textContent, /本设备/);
  assert.match(context.els.adminOfflinePasswordStatus.textContent, /其他设备暂时不能/);
  assert.equal(context.els.adminOfflinePasswordStatus.classList.contains("error"), true);

  assert.match(appSource, /sessionStorage\.setItem/);
  assert.match(appSource, /sessionStorage\.removeItem/);
  assert.doesNotMatch(appSource, /localStorage\.setItem\(STORAGE_KEYS\.(adminEmail|operatorEmail)/);
  assert.match(appSource, /adminOfflinePasswordForm\.addEventListener\("submit", saveAdminOfflinePassword\)/);
  assert.match(appSource, /const OFFLINE_PASSWORD_ITERATIONS = 210000/);
  assert.match(appSource, /crypto\.subtle\.deriveBits/);
  assert.match(appSource, /offlinePasswordAlgorithm === "PBKDF2-SHA256"/);

  console.log("admin-login-security.test.js: 28 项管理员登录与会话安全测试通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
