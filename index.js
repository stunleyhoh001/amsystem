const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const POS_ADMIN_EMAIL = "stanleyhoh79@gmail.com";
const SIMPLEPAY_PROJECT_ID = "oneminpay";
const AFFILIATE_PROJECT_ID = "amsystem-faafb";
const RETRYABLE_JOB_STATUSES = new Set(["retry", "needs-attention"]);
const JOB_TARGETS = {
  "simplepay.payment": "simplepay",
  "simplepay.refund": "simplepay",
  "affiliate.fulfill": "affiliate",
  "affiliate.reverse": "affiliate"
};
const posDb = admin.firestore();
const simplePayDb = admin.firestore(
  admin.initializeApp({ projectId: SIMPLEPAY_PROJECT_ID }, "simplepay")
);
const affiliateDb = admin.firestore(
  admin.initializeApp({ projectId: AFFILIATE_PROJECT_ID }, "affiliate")
);

class IntegrationError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function text(value) {
  return String(value || "").trim();
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function expectedJobId(orderId, operation) {
  return `INT-${text(orderId)}-${text(operation).replaceAll(".", "-")}`;
}

function affiliateItems(items = []) {
  return items.filter((item) =>
    text(item.affiliatePlanId)
    || text(item.barcode || item.sku).toUpperCase().startsWith("AFF-PLAN-")
  );
}

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function assertAdmin(request) {
  const email = text(request.auth && request.auth.token && request.auth.token.email).toLowerCase();
  if (!request.auth || email !== POS_ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Only the Simple POS administrator can retry integration jobs.");
  }
}

async function claimJob(jobRef) {
  return posDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(jobRef);
    if (!snapshot.exists) return null;
    const job = snapshot.data();
    if (!["pending", "retry"].includes(job.status)) return null;
    const attempts = Number(job.attempts || 0) + 1;
    tx.update(jobRef, {
      status: "processing",
      attempts,
      lastAttemptAt: serverTimestamp(),
      cloudUpdatedAt: serverTimestamp()
    });
    return { ...job, id: snapshot.id, attempts };
  });
}

async function validateJobAgainstSale(job) {
  const operation = text(job.operation);
  const targetSystem = JOB_TARGETS[operation];
  if (!targetSystem) throw new IntegrationError("unsupported-operation", `Unsupported operation: ${operation}`);
  if (text(job.id) !== expectedJobId(job.posOrderId, operation)) {
    throw new IntegrationError("job-id-mismatch", "Integration job ID does not match its POS order and operation.");
  }
  if (
    text(job.idempotencyKey) !== text(job.id)
    || text(job.sourceSystem) !== "simple-pos"
    || text(job.targetSystem) !== targetSystem
  ) {
    throw new IntegrationError("job-contract-invalid", "Integration job source, target, or idempotency key is invalid.");
  }

  const saleSnapshot = await posDb.collection("sales").doc(text(job.posOrderId)).get();
  if (!saleSnapshot.exists) throw new IntegrationError("pos-order-not-found", "POS order was not found.");
  const sale = saleSnapshot.data();
  const branchId = text(sale.branchId || "hq");
  const references = sale.externalReferences || {};
  const customer = sale.customer || {};
  const isVoidOperation = ["simplepay.refund", "affiliate.reverse"].includes(operation);
  if (text(job.branchId || "hq") !== branchId) {
    throw new IntegrationError("branch-mismatch", "Integration job branch does not match the POS order.");
  }
  if (isVoidOperation !== (sale.status === "voided")) {
    throw new IntegrationError(
      "pos-order-status-mismatch",
      isVoidOperation
        ? "Refund or reversal jobs require a voided POS order."
        : "Checkout integration jobs cannot run after the POS order is voided."
    );
  }

  if (operation === "simplepay.payment" || operation === "simplepay.refund") {
    if (
      text(job.amount && job.amount.currency) !== "MYR"
      || money(job.amount && job.amount.value) !== money(sale.total)
    ) {
      throw new IntegrationError("amount-mismatch", "SimplePay job amount does not match the POS order.");
    }
  }
  if (operation === "simplepay.payment") {
    const reference = text(references.simplePayReference || sale.payment?.reference);
    const expectedAction = reference ? "verify-payment" : "create-payment-intent";
    if (
      text(job.action) !== expectedAction
      || text(job.paymentReference) !== reference
      || text(job.merchant && job.merchant.branchId) !== branchId
    ) {
      throw new IntegrationError("payment-contract-mismatch", "SimplePay payment job does not match the POS order.");
    }
  }
  if (
    operation === "simplepay.refund"
    && (
      text(job.action) !== "refund-payment"
      || text(job.originalPaymentReference) !== text(references.simplePayReference || sale.payment?.reference)
    )
  ) {
    throw new IntegrationError("refund-contract-mismatch", "SimplePay refund reference does not match the POS order.");
  }

  if (operation === "affiliate.fulfill") {
    const eligibleItems = affiliateItems(sale.items);
    const affiliateAmount = money(eligibleItems.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.qty || item.quantity || 0),
      0
    ));
    const planId = text(eligibleItems[0]?.affiliatePlanId) || "plan_rm180";
    const expectedBlocker = references.simplePayStatus && references.simplePayStatus !== "not-used"
      ? expectedJobId(saleSnapshot.id, "simplepay.payment")
      : "";
    if (
      !eligibleItems.length
      || text(job.action) !== "create-or-confirm-order"
      || text(job.blockedBy) !== expectedBlocker
      || money(job.amount && job.amount.value) !== affiliateAmount
      || text(job.planId || "plan_rm180") !== planId
      || text(job.referralCode).toUpperCase() !== text(references.affiliateReferralCode || customer.referralCode).toUpperCase()
      || text(job.customer && job.customer.phone) !== text(customer.phone)
      || text(job.customer && job.customer.name) !== text(customer.name)
    ) {
      throw new IntegrationError("affiliate-contract-mismatch", "Affiliate fulfillment job does not match the POS order.");
    }
  }
  if (
    operation === "affiliate.reverse"
    && (
      text(job.action) !== "reverse-order-benefits"
      || text(job.affiliateOrderId) !== text(references.affiliateOrderId)
      || text(job.originalExternalOrderId) !== expectedJobId(saleSnapshot.id, "affiliate.fulfill")
      || text(job.blockedBy) !== (
        text(references.simplePayReference)
          ? expectedJobId(saleSnapshot.id, "simplepay.refund")
          : ""
      )
    )
  ) {
    throw new IntegrationError("affiliate-reversal-mismatch", "Affiliate reversal job does not match the POS order.");
  }
  return sale;
}

async function settleJobIfActive(jobRef, job, patch) {
  return posDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(jobRef);
    if (!snapshot.exists) return false;
    const current = snapshot.data();
    if (current.status !== "processing" || Number(current.attempts || 0) !== Number(job.attempts || 0)) {
      return false;
    }
    tx.set(jobRef, patch, { merge: true });
    return true;
  });
}

async function getBranchMerchant(job) {
  const branchId = text(job.branchId || "hq");
  const snapshot = await posDb.collection("branches").doc(branchId).get();
  const merchantId = text(snapshot.exists && snapshot.data().simplePayMerchantId);
  if (!merchantId) {
    throw new IntegrationError(
      "simplepay-merchant-not-configured",
      `Branch ${branchId} has no SimplePay merchant ID.`
    );
  }
  return {
    branchId,
    branchName: text(snapshot.data().name || job.branchName),
    merchantId
  };
}

async function findMerchantOrder(reference) {
  const value = text(reference);
  if (!value) return null;
  const direct = await simplePayDb.collection("merchantOrders").doc(value).get();
  if (direct.exists) return { id: direct.id, ...direct.data() };
  const byReference = await simplePayDb
    .collection("merchantOrders")
    .where("paymentReference", "==", value)
    .limit(2)
    .get();
  if (byReference.size === 1) {
    const doc = byReference.docs[0];
    return { id: doc.id, ...doc.data() };
  }
  return null;
}

async function simplePayAmountPoints(job) {
  const config = await simplePayDb.collection("systemConfig").doc("main").get();
  const pointsPerMyr = Number(config.exists && config.data().pointsPerMyr) || 100;
  return {
    pointsPerMyr,
    amountPoints: Math.round(money(job.amount && job.amount.value) * pointsPerMyr)
  };
}

async function processSimplePayPayment(job) {
  const merchant = await getBranchMerchant(job);
  const amount = await simplePayAmountPoints(job);

  if (job.action === "verify-payment") {
    const order = await findMerchantOrder(job.paymentReference);
    if (!order) throw new IntegrationError("payment-not-found", "SimplePay payment was not found.", true);
    if (order.status !== "approved") {
      throw new IntegrationError("payment-not-approved", `SimplePay payment status is ${order.status}.`, true);
    }
    if (text(order.merchantId) !== merchant.merchantId) {
      throw new IntegrationError("merchant-mismatch", "SimplePay payment belongs to another merchant.");
    }
    if (Number(order.amount || 0) !== amount.amountPoints) {
      throw new IntegrationError("amount-mismatch", "SimplePay payment amount does not match the POS order.");
    }
    return {
      status: "completed",
      targetReference: `merchantOrders/${order.id}`,
      result: {
        paymentReference: text(order.paymentReference || order.id),
        merchantId: merchant.merchantId,
        amountPoints: amount.amountPoints
      }
    };
  }

  const intentRef = simplePayDb.collection("paymentIntents").doc(job.id);
  await intentRef.set({
    id: job.id,
    idempotencyKey: job.id,
    sourceSystem: "simple-pos",
    posOrderId: text(job.posOrderId),
    branchId: merchant.branchId,
    branchName: merchant.branchName,
    merchantId: merchant.merchantId,
    amountMyr: money(job.amount && job.amount.value),
    amountPoints: amount.amountPoints,
    pointsPerMyr: amount.pointsPerMyr,
    currency: "MYR",
    customer: job.customer || {},
    status: "awaiting-customer-authorization",
    createdAt: text(job.createdAt) || new Date().toISOString(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return {
    status: "awaiting-customer-authorization",
    targetReference: `paymentIntents/${intentRef.id}`,
    result: {
      merchantId: merchant.merchantId,
      amountPoints: amount.amountPoints
    }
  };
}

async function processSimplePayRefund(job) {
  const merchant = await getBranchMerchant(job);
  const order = await findMerchantOrder(job.originalPaymentReference);
  if (!order) throw new IntegrationError("payment-not-found", "Original SimplePay payment was not found.", true);
  if (text(order.merchantId) !== merchant.merchantId) {
    throw new IntegrationError("merchant-mismatch", "Original payment belongs to another merchant.");
  }
  if (order.status === "refunded") {
    return {
      status: "completed",
      targetReference: `merchantOrders/${order.id}`,
      result: { refundReference: text(order.refundRequestId || `RF-${order.id}`) }
    };
  }
  const requestId = `RF-${order.id}`;
  const refundRef = simplePayDb.collection("merchantRefundIntents").doc(requestId);
  await refundRef.set({
    id: requestId,
    idempotencyKey: job.id,
    sourceSystem: "simple-pos",
    posJobId: job.id,
    posOrderId: text(job.posOrderId),
    orderId: order.id,
    paymentReference: text(order.paymentReference || order.id),
    merchantId: merchant.merchantId,
    reason: text(job.reason || "POS order voided"),
    status: "awaiting-merchant-approval",
    createdAt: text(job.createdAt) || new Date().toISOString(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return {
    status: "awaiting-refund-approval",
    targetReference: `merchantRefundIntents/${refundRef.id}`,
    result: { refundReference: refundRef.id }
  };
}

async function blockerResult(job) {
  if (!text(job.blockedBy)) return null;
  const snapshot = await posDb.collection("integrationJobs").doc(job.blockedBy).get();
  if (!snapshot.exists) {
    throw new IntegrationError("blocker-not-found", `Blocking job ${job.blockedBy} was not found.`);
  }
  const blocker = snapshot.data();
  if (blocker.status !== "completed") {
    return { blocked: true, status: blocker.status };
  }
  return { blocked: false, ...blocker.result };
}

async function processAffiliate(job) {
  const blocker = await blockerResult(job);
  if (blocker && blocker.blocked) {
    return {
      status: "blocked",
      result: { blockedBy: job.blockedBy, blockerStatus: blocker.status }
    };
  }

  const operation = job.operation === "affiliate.reverse" ? "reversePosOrder" : "ingestPosOrder";
  const commandRef = affiliateDb.collection("amsystemIntegrationCommands").doc(job.id);
      const payload = operation === "reversePosOrder"
    ? {
        externalOrderId: text(job.originalExternalOrderId),
        posOrderId: text(job.posOrderId),
        refundReference: text(blocker && blocker.refundReference) || `POS-VOID-${job.posOrderId}`,
        reason: text(job.reason || "POS order refunded")
      }
    : {
        externalOrderId: job.id,
        posOrderId: text(job.posOrderId),
        branchId: text(job.branchId),
        paymentStatus: "confirmed",
        paymentReference: text(blocker && blocker.paymentReference) || `POS-${job.posOrderId}`,
        paymentMethod: text(blocker && blocker.paymentReference) ? "SimplePay" : "POS",
        amount: money(job.amount && job.amount.value),
        planId: text(job.planId || "plan_rm180"),
        referralCode: text(job.referralCode),
        customer: job.customer || {},
        customerName: text(job.customer && job.customer.name),
        customerPhone: text(job.customer && job.customer.phone),
        createdAt: text(job.createdAt)
      };
  await commandRef.set({
    id: job.id,
    idempotencyKey: job.id,
    sourceSystem: "simple-pos",
    posProjectId: process.env.GCLOUD_PROJECT || "simplepos-2900e",
    posJobId: job.id,
    operation,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: text(job.createdAt) || new Date().toISOString(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return {
    status: "dispatched",
    targetReference: `amsystemIntegrationCommands/${commandRef.id}`,
    result: { operation }
  };
}

async function runJob(jobRef) {
  const job = await claimJob(jobRef);
  if (!job) return;
  try {
    await validateJobAgainstSale(job);
    let outcome;
    if (job.operation === "simplepay.payment") outcome = await processSimplePayPayment(job);
    else if (job.operation === "simplepay.refund") outcome = await processSimplePayRefund(job);
    else if (["affiliate.fulfill", "affiliate.reverse"].includes(job.operation)) {
      outcome = await processAffiliate(job);
    } else {
      throw new IntegrationError("unsupported-operation", `Unsupported operation: ${job.operation}`);
    }
    await settleJobIfActive(jobRef, job, {
      ...outcome,
      lastError: admin.firestore.FieldValue.delete(),
      cloudUpdatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Integration job failed", job.id, error);
    await settleJobIfActive(jobRef, job, {
      status: error.retryable && job.attempts < 5 ? "retry" : "needs-attention",
      lastError: {
        code: text(error.code || "integration-error"),
        message: text(error.message || "Integration job failed"),
        retryable: Boolean(error.retryable),
        at: new Date().toISOString()
      },
      cloudUpdatedAt: serverTimestamp()
    });
  }
}

async function releaseDependents(completedJobId) {
  const snapshot = await posDb
    .collection("integrationJobs")
    .where("blockedBy", "==", completedJobId)
    .where("status", "==", "blocked")
    .get();
  await Promise.all(snapshot.docs.map((doc) => doc.ref.set({
    status: "pending",
    cloudUpdatedAt: serverTimestamp()
  }, { merge: true })));
}

async function cancelTargetIntent(jobId, job) {
  const cancellation = {
    status: "canceled",
    cancelReason: text(job.cancelReason || "pos-order-canceled"),
    canceledAt: text(job.canceledAt) || new Date().toISOString(),
    updatedAt: serverTimestamp()
  };
  if (job.operation === "simplepay.payment") {
    await simplePayDb.collection("paymentIntents").doc(jobId).set(cancellation, { merge: true });
  }
  if (["affiliate.fulfill", "affiliate.reverse"].includes(job.operation)) {
    const commandRef = affiliateDb.collection("amsystemIntegrationCommands").doc(jobId);
    await affiliateDb.runTransaction(async (tx) => {
      const snapshot = await tx.get(commandRef);
      if (!snapshot.exists || snapshot.data().status !== "pending") return;
      tx.set(commandRef, cancellation, { merge: true });
    });
  }
}

exports.processIntegrationJob = onDocumentWritten("integrationJobs/{jobId}", async (event) => {
  const before = event.data && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;
  if (["pending", "retry"].includes(after.status)) {
    await runJob(event.data.after.ref);
  }
  if (after.status === "completed" && before && before.status !== "completed") {
    await releaseDependents(event.params.jobId);
  }
  if (after.status === "canceled" && (!before || before.status !== "canceled")) {
    await cancelTargetIntent(event.params.jobId, after);
  }
});

exports.retryIntegrationJob = onCall(async (request) => {
  assertAdmin(request);
  const jobId = text(request.data && request.data.jobId);
  if (!jobId) throw new HttpsError("invalid-argument", "jobId is required.");
  const jobRef = posDb.collection("integrationJobs").doc(jobId);
  await posDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(jobRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Integration job not found.");
    const job = snapshot.data();
    if (!RETRYABLE_JOB_STATUSES.has(job.status)) {
      throw new HttpsError(
        "failed-precondition",
        `Integration job status ${job.status} cannot be retried.`
      );
    }
    const saleSnapshot = await tx.get(posDb.collection("sales").doc(text(job.posOrderId)));
    if (!saleSnapshot.exists) throw new HttpsError("not-found", "POS order not found.");
    const sale = saleSnapshot.data();
    const isVoidOperation = ["simplepay.refund", "affiliate.reverse"].includes(job.operation);
    if (isVoidOperation !== (sale.status === "voided")) {
      throw new HttpsError(
        "failed-precondition",
        isVoidOperation
          ? "Refund or reversal jobs require a voided POS order."
          : "Checkout integration jobs cannot be retried after the POS order is voided."
      );
    }
    tx.set(jobRef, {
      status: "pending",
      lastError: admin.firestore.FieldValue.delete(),
      retryRequestedAt: serverTimestamp(),
      cloudUpdatedAt: serverTimestamp()
    }, { merge: true });
  });
  return { ok: true, jobId };
});
