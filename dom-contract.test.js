const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");

const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicateIds)], [], "HTML 不能出现重复 id");

const referencedIds = [...app.matchAll(/document\.querySelector\("#([^"]+)"\)/g)].map((match) => match[1]);
const missingIds = [...new Set(referencedIds.filter((id) => !htmlIds.includes(id)))];
assert.deepEqual(missingIds, [], "app.js 引用的控件必须存在于 index.html");

const appVersion = app.match(/const APP_VERSION = "(v[^"]+)"/)?.[1];
assert.equal(appVersion, "v0.88", "应用版本应为 v0.88");
assert.match(serviceWorker, /simple-pos-v100/, "Service Worker 缓存版本应为 v100");
assert.match(app, /closedBy: getCurrentActor\(\)/, "交班记录必须保存实际结班人");
assert.match(app, /"核对 \/ 结班人"/, "交班 CSV 必须包含实际结班人");
assert.match(app, /function getSimplePayIntentCode\(/, "SimplePay 待授权订单必须产生付款码");
assert.match(html, /id="receiptSimplePayQr"/, "收据必须提供 SimplePay 付款二维码");
assert.match(
  app,
  /\(sale\.items \|\| \[\]\)\.map\(\(item\) =>\s*`\$\{escapeHtml\(item\.name \|\| "-"\)\}/,
  "交易列表中的商品名称必须经过 HTML 转义"
);

for (const asset of [
  "./index.html",
  "./styles.css",
  "./bluetooth-printer.js",
  "./app.js",
  "./firebase-config.js",
  "./firebase-cloud.js",
  "./manifest.webmanifest"
]) {
  assert.ok(serviceWorker.includes(`"${asset}"`), `离线缓存缺少 ${asset}`);
}

console.log(`dom-contract.test.js: ${htmlIds.length} 个控件 id，${referencedIds.length} 个脚本引用全部通过`);
