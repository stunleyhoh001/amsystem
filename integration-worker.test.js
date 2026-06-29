const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));

assert.equal(firebaseConfig.functions.source, "functions");
assert.match(source, /SIMPLEPAY_PROJECT_ID = "oneminpay"/);
assert.match(source, /AFFILIATE_PROJECT_ID = "amsystem-faafb"/);
assert.match(source, /onDocumentWritten\("integrationJobs\/\{jobId\}"/);
assert.match(source, /idempotencyKey: job\.id/);
assert.match(source, /collection\("paymentIntents"\)\.doc\(job\.id\)/);
assert.match(source, /status: "awaiting-customer-authorization"/);
assert.doesNotMatch(
  source,
  /collection\("wallets"\)[\s\S]{0,300}(balance|FieldValue\.increment)/,
  "POS worker must not directly debit a SimplePay wallet"
);
assert.match(source, /collection\("merchantRefundIntents"\)/);
assert.match(source, /status: "awaiting-merchant-approval"/);
assert.match(source, /collection\("amsystemIntegrationCommands"\)\.doc\(job\.id\)/);
assert.match(source, /where\("blockedBy", "==", completedJobId\)/);
assert.match(source, /async function cancelTargetIntent\(/);
assert.match(source, /after\.status === "canceled"/);
assert.match(source, /collection\("amsystemIntegrationCommands"\)\.doc\(jobId\)/);
assert.match(source, /snapshot\.data\(\)\.status !== "pending"/);
assert.match(source, /RETRYABLE_JOB_STATUSES = new Set\(\["retry", "needs-attention"\]\)/);
assert.match(source, /async function validateJobAgainstSale\(job\)/);
assert.match(source, /job-id-mismatch/);
assert.match(source, /payment-contract-mismatch/);
assert.match(source, /affiliate-contract-mismatch/);
assert.match(source, /affiliate-reversal-mismatch/);
assert.match(source, /async function settleJobIfActive\(jobRef, job, patch\)/);
assert.match(source, /current\.status !== "processing"/);
assert.match(source, /posOrderId: text\(job\.posOrderId\)/);
assert.match(source, /customerPhone: text\(job\.customer && job\.customer\.phone\)/);
assert.match(source, /Integration job status \$\{job\.status\} cannot be retried/);
assert.match(source, /Checkout integration jobs cannot be retried after the POS order is voided/);
assert.match(source, /Refund or reversal jobs require a voided POS order/);
assert.match(source, /simplePayMerchantId/);
assert.match(appSource, /function updateBranchSimplePayMerchant\(/);
assert.match(htmlSource, /id="branchSimplePayMerchantIdInput"/);

console.log("integration-worker.test.js: 29 cross-project safety assertions passed");
