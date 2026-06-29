const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const contract = require(path.join(root, "integration-contract.js"));
const cloudSource = fs.readFileSync(path.join(root, "firebase-cloud.js"), "utf8");
const rulesSource = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const swSource = fs.readFileSync(path.join(root, "sw.js"), "utf8");

function sale(overrides = {}) {
  return {
    id: "POS-20260628-0001",
    createdAt: "2026-06-28T10:00:00.000Z",
    branchId: "branch-1",
    branchName: "Bukit Indah",
    total: 180,
    customer: {
      name: "Test User",
      phone: "0123456789",
      referralCode: ""
    },
    items: [{
      id: "P1",
      barcode: "PLAN-180",
      name: "Package",
      qty: 1,
      price: 180
    }],
    externalReferences: {
      simplePayReference: "",
      simplePayStatus: "not-used",
      affiliateReferralCode: "",
      affiliateOrderId: "",
      affiliateStatus: "not-used"
    },
    ...overrides
  };
}

assert.equal(contract.SCHEMA_VERSION, 1);
assert.deepEqual(contract.buildJobs(sale()), []);

const simplePaySale = sale({
  externalReferences: {
    simplePayReference: "",
    simplePayStatus: "pending",
    affiliateReferralCode: "",
    affiliateOrderId: "",
    affiliateStatus: "not-used"
  }
});
const paymentJobs = contract.buildJobs(simplePaySale);
assert.equal(paymentJobs.length, 1);
assert.equal(paymentJobs[0].operation, "simplepay.payment");
assert.equal(paymentJobs[0].action, "create-payment-intent");
assert.equal(paymentJobs[0].requiresCustomerAuthorization, true);
assert.equal(paymentJobs[0].amount.currency, "MYR");
assert.equal(paymentJobs[0].amount.value, 180);
assert.equal(paymentJobs[0].branchId, "branch-1");
assert.equal(paymentJobs[0].status, "pending");
assert.equal(paymentJobs[0].attempts, 0);
assert.equal(paymentJobs[0].id, paymentJobs[0].idempotencyKey);

const referencedPayment = contract.buildJobs(sale({
  externalReferences: {
    simplePayReference: "SP-123",
    simplePayStatus: "linked"
  }
}))[0];
assert.equal(referencedPayment.action, "verify-payment");
assert.equal(referencedPayment.requiresCustomerAuthorization, false);
assert.equal(referencedPayment.paymentReference, "SP-123");

const affiliateSale = sale({
  customer: {
    name: "Test User",
    phone: "0123456789",
    referralCode: "abc123"
  },
  externalReferences: {
    simplePayReference: "",
    simplePayStatus: "pending",
    affiliateReferralCode: "abc123",
    affiliateOrderId: "",
    affiliateStatus: "pending"
  },
  items: [{
    id: "AFF1",
    barcode: "AFF-PLAN-RM180",
    affiliatePlanId: "plan_rm180",
    name: "Affiliate Package",
    qty: 1,
    price: 180
  }]
});
const checkoutJobs = contract.buildJobs(affiliateSale);
assert.equal(checkoutJobs.length, 2);
assert.equal(checkoutJobs[1].operation, "affiliate.fulfill");
assert.equal(checkoutJobs[1].referralCode, "ABC123");
assert.equal(checkoutJobs[1].blockedBy, checkoutJobs[0].id);
assert.deepEqual(checkoutJobs[1].items[0], {
  id: "AFF1",
  sku: "AFF-PLAN-RM180",
  name: "Affiliate Package",
  quantity: 1,
  unitPrice: 180
});
assert.equal(checkoutJobs[1].planId, "plan_rm180");
assert.equal(checkoutJobs[1].amount.value, 180);
assert.equal(contract.hasAffiliateItems(affiliateSale.items), true);
assert.equal(contract.hasAffiliateItems(sale().items), false);

const affiliateWithoutReferral = contract.buildJobs(sale({
  customer: {
    name: "Test User",
    phone: "0123456789",
    referralCode: ""
  },
  externalReferences: {
    simplePayStatus: "not-used",
    affiliateReferralCode: "",
    affiliateOrderId: "",
    affiliateStatus: "pending"
  },
  items: affiliateSale.items
}));
assert.equal(affiliateWithoutReferral.length, 1);
assert.equal(affiliateWithoutReferral[0].operation, "affiliate.fulfill");
assert.equal(affiliateWithoutReferral[0].referralCode, "");

const affiliateWithoutPhone = contract.buildJobs(sale({
  customer: { name: "Test User", phone: "", referralCode: "ABC123" },
  externalReferences: {
    simplePayStatus: "not-used",
    affiliateReferralCode: "ABC123",
    affiliateStatus: "pending"
  },
  items: affiliateSale.items
}));
assert.deepEqual(affiliateWithoutPhone, []);

const referralOnlyJobs = contract.buildJobs(sale({
  customer: { name: "User", phone: "012", referralCode: "ABC123" },
  externalReferences: {
    simplePayStatus: "not-used",
    affiliateReferralCode: "ABC123",
    affiliateStatus: "pending"
  }
}));
assert.deepEqual(referralOnlyJobs, []);

const repeatedJobs = contract.buildJobs(affiliateSale);
assert.deepEqual(
  repeatedJobs.map((job) => job.id),
  checkoutJobs.map((job) => job.id)
);

const attachedCheckout = contract.attachJobReferences(affiliateSale, "checkout");
assert.equal(attachedCheckout.integrationOutbox.checkoutJobIds.length, 2);
assert.equal(attachedCheckout.integrationOutbox.schemaVersion, 1);

const voidedSale = {
  ...attachedCheckout,
  voidedAt: "2026-06-28T11:00:00.000Z",
  externalReferences: {
    ...attachedCheckout.externalReferences,
    simplePayReference: "SP-123",
    affiliateOrderId: "AFF-123"
  }
};
const voidJobs = contract.buildJobs(voidedSale, "void");
assert.equal(voidJobs.length, 2);
assert.equal(voidJobs[0].operation, "simplepay.refund");
assert.equal(voidJobs[0].originalPaymentReference, "SP-123");
assert.equal(voidJobs[1].operation, "affiliate.reverse");
assert.equal(voidJobs[1].affiliateOrderId, "AFF-123");
assert.equal(voidJobs[1].blockedBy, voidJobs[0].id);
assert.equal(
  voidJobs[1].originalExternalOrderId,
  contract.jobId(voidedSale.id, "affiliate.fulfill")
);

const attachedVoid = contract.attachJobReferences(voidedSale, "void");
assert.equal(attachedVoid.integrationOutbox.checkoutJobIds.length, 2);
assert.equal(attachedVoid.integrationOutbox.voidJobIds.length, 2);

const canceledUnpaidSale = {
  ...affiliateSale,
  status: "voided",
  voidedAt: "2026-06-28T11:10:00.000Z",
  externalReferences: {
    ...affiliateSale.externalReferences,
    simplePayReference: "",
    simplePayStatus: "pending",
    affiliateOrderId: "",
    affiliateStatus: "pending"
  }
};
assert.deepEqual(
  contract.buildJobs(canceledUnpaidSale, "void"),
  [],
  "unpaid cancellation must not create refund or affiliate reversal jobs"
);
assert.deepEqual(
  contract.attachJobReferences(canceledUnpaidSale, "void").integrationOutbox.voidJobIds,
  []
);

assert.match(cloudSource, /function writeIntegrationJobs\(/);
assert.match(cloudSource, /writeIntegrationJobs\(transaction, sale, "checkout"\)/);
assert.match(cloudSource, /writeIntegrationJobs\(transaction, voidedSale, "void"\)/);
assert.match(
  cloudSource,
  /status: "inventory-review"[\s\S]*?integrationJobIds: integrationJobs\.map/,
  "inventory review checkout must still enqueue integration jobs"
);
assert.match(rulesSource, /match \/integrationJobs\/\{jobId\}/);
assert.match(rulesSource, /request\.resource\.data\.status == "pending"/);
assert.match(rulesSource, /function validIntegrationJobCreate\(jobId\)/);
assert.match(rulesSource, /request\.resource\.data\.idempotencyKey == jobId/);
assert.match(rulesSource, /request\.resource\.data\.branchId == sale\.branchId/);
assert.match(rulesSource, /request\.resource\.data\.amount\.value == sale\.total/);
assert.doesNotMatch(
  rulesSource,
  /affectedKeys\(\)\.hasOnly\(\[[\s\S]*?"externalReferences"[\s\S]*?\]\)/,
  "员工订单更新不应允许直接篡改跨系统关联资料"
);
assert.match(appSource, /function openIntegrationEditor\(saleId\) \{\s*if \(!requireAdmin\(\)\) return;/);
assert.match(appSource, /attachIntegrationOutbox\(\{/);
assert.match(htmlSource, /integration-contract\.js/);
assert.match(swSource, /simple-pos-v100/);
assert.match(appSource, /function requireAffiliateCustomerPhone\(/);
assert.match(appSource, /affiliateStatus: affiliateEligible \? "pending" : "not-used"/);
assert.match(cloudSource, /function cancelOpenIntegrationJobs\(/);
assert.match(cloudSource, /status: "canceled"/);
assert.doesNotMatch(appSource, /price:\s*150/);
assert.match(appSource, /LEGACY_DEMO_PRODUCT_BARCODES/);
assert.match(cloudSource, /async function deleteProduct\(/);

console.log("integration-outbox.test.js: 59 integration outbox assertions passed");
