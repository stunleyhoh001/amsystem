const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const hosting = firebaseConfig.hosting;

assert.equal(hosting.public, ".", "Hosting 目录结构改变时必须同步更新发布安全测试");

const ignored = new Set(hosting.ignore || []);
for (const pattern of [
  "firebase.json",
  "**/.*",
  "**/node_modules/**",
  "functions/**",
  "tests/**",
  "**/*.md",
  "dev-server.js",
  "firestore.rules",
  "firebase-config.example.js",
  "server*.log"
]) {
  assert.ok(ignored.has(pattern), `Firebase Hosting 必须排除 ${pattern}`);
}

for (const asset of [
  "index.html",
  "styles.css",
  "app.js",
  "integration-contract.js",
  "bluetooth-printer.js",
  "firebase-cloud.js",
  "firebase-config.js",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg"
]) {
  assert.ok(fs.existsSync(path.join(root, asset)), `运行资源不存在：${asset}`);
  assert.ok(!ignored.has(asset), `运行资源不能被 Hosting 排除：${asset}`);
}

assert.match(gitignore, /^firebase-config\.local\.js$/m);
assert.match(gitignore, /^functions\/node_modules\/$/m);
assert.match(gitignore, /^\.pnpm-store\/$/m);
assert.match(gitignore, /^server\*\.log$/m);

const localConfigHeaders = (hosting.headers || []).find(
  (entry) => entry.source === "/firebase-config.local.js"
);
assert.ok(localConfigHeaders, "真实 Firebase 配置必须有独立缓存规则");
assert.ok(
  localConfigHeaders.headers?.some(
    (header) => header.key.toLowerCase() === "cache-control" && header.value.includes("no-store")
  ),
  "真实 Firebase 配置必须禁止浏览器持久缓存"
);
assert.doesNotMatch(serviceWorker, /APP_SHELL\s*=\s*\[[\s\S]*firebase-config\.local\.js[\s\S]*\]/);
assert.match(
  serviceWorker,
  /pathname\.endsWith\("\/firebase-config\.local\.js"\)[\s\S]*event\.respondWith\(fetch\(event\.request\)\)/,
  "Service Worker 必须绕过真实 Firebase 配置的离线缓存"
);

console.log("deployment-surface.test.js: Hosting 发布范围与忽略规则测试通过");
