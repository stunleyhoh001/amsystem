const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { TextEncoder } = require("node:util");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`async function ${name}(`);
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

const context = {
  crypto: webcrypto,
  TextEncoder,
  OFFLINE_PASSWORD_ITERATIONS: 210000,
  normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }
};
vm.createContext(context);
for (const name of ["sha256Hex", "hashOfflinePassword", "verifyOfflinePassword"]) {
  vm.runInContext(extractFunction(name), context);
}

(async () => {
  const email = "cashier@example.com";
  const password = "strong-password";
  const salt = "test-salt";
  const hash = await context.hashOfflinePassword(email, password, salt, 100000);
  assert.equal(hash.length, 64);

  const modernUser = {
    email,
    offlinePasswordAlgorithm: "PBKDF2-SHA256",
    offlinePasswordIterations: 100000,
    offlinePasswordSalt: salt,
    offlinePasswordHash: hash
  };
  assert.equal(await context.verifyOfflinePassword(modernUser, password), true);
  assert.equal(await context.verifyOfflinePassword(modernUser, "wrong-password"), false);

  const legacyHash = await context.sha256Hex(`${salt}:${email}:${password}`);
  const legacyUser = {
    email,
    offlinePasswordSalt: salt,
    offlinePasswordHash: legacyHash
  };
  assert.equal(await context.verifyOfflinePassword(legacyUser, password), true);
  assert.equal(await context.verifyOfflinePassword(legacyUser, "wrong-password"), false);

  console.log("offline-password.test.js: PBKDF2 与旧密码兼容测试通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
