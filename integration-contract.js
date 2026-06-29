(function initializeIntegrationContract(root) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const SOURCE_SYSTEM = "simple-pos";

  function text(value) {
    return String(value || "").trim();
  }

  function money(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  function jobId(orderId, operation) {
    return `INT-${text(orderId)}-${operation.replaceAll(".", "-")}`;
  }

  function publicItems(items = []) {
    return items.map((item) => ({
      id: text(item.id),
      sku: text(item.barcode || item.sku),
      name: text(item.name),
      quantity: Number(item.qty || item.quantity || 0),
      unitPrice: money(item.price)
    }));
  }

  function affiliateItems(items = []) {
    return items.filter((item) =>
      text(item.affiliatePlanId)
      || text(item.barcode || item.sku).toUpperCase().startsWith("AFF-PLAN-")
    );
  }

  function baseJob(sale, operation, target, createdAt) {
    const id = jobId(sale.id, operation);
    return {
      id,
      idempotencyKey: id,
      schemaVersion: SCHEMA_VERSION,
      sourceSystem: SOURCE_SYSTEM,
      targetSystem: target,
      operation,
      status: "pending",
      attempts: 0,
      posOrderId: text(sale.id),
      branchId: text(sale.branchId || "hq"),
      branchName: text(sale.branchName),
      amount: {
        currency: "MYR",
        value: money(sale.total)
      },
      createdAt,
      updatedAt: createdAt
    };
  }

  function buildCheckoutJobs(sale) {
    const references = sale.externalReferences || {};
    const customer = sale.customer || {};
    const createdAt = text(sale.createdAt) || new Date().toISOString();
    const jobs = [];
    let paymentJob = null;

    if (references.simplePayStatus && references.simplePayStatus !== "not-used") {
      paymentJob = {
        ...baseJob(sale, "simplepay.payment", "simplepay", createdAt),
        action: text(references.simplePayReference) ? "verify-payment" : "create-payment-intent",
        requiresCustomerAuthorization: !text(references.simplePayReference),
        paymentReference: text(references.simplePayReference),
        merchant: {
          branchId: text(sale.branchId || "hq")
        }
      };
      jobs.push(paymentJob);
    }

    const referralCode = text(
      references.affiliateReferralCode || customer.referralCode
    ).toUpperCase();
    const eligibleItems = affiliateItems(sale.items);
    if (text(customer.phone) && eligibleItems.length) {
      const affiliateAmount = money(
        eligibleItems.reduce(
          (sum, item) => sum + Number(item.price || 0) * Number(item.qty || item.quantity || 0),
          0
        )
      );
      jobs.push({
        ...baseJob(sale, "affiliate.fulfill", "affiliate", createdAt),
        amount: {
          currency: "MYR",
          value: affiliateAmount
        },
        action: "create-or-confirm-order",
        blockedBy: paymentJob ? paymentJob.id : "",
        referralCode,
        planId: text(eligibleItems[0].affiliatePlanId) || "plan_rm180",
        customer: {
          name: text(customer.name),
          phone: text(customer.phone)
        },
        items: publicItems(eligibleItems)
      });
    }

    return jobs;
  }

  function buildVoidJobs(sale) {
    const references = sale.externalReferences || {};
    const customer = sale.customer || {};
    const createdAt = text(sale.voidedAt) || new Date().toISOString();
    const jobs = [];
    let refundJob = null;

    if (
      text(references.simplePayReference)
      && references.simplePayStatus
      && references.simplePayStatus !== "not-used"
    ) {
      refundJob = {
        ...baseJob(sale, "simplepay.refund", "simplepay", createdAt),
        action: "refund-payment",
        originalPaymentReference: text(references.simplePayReference),
        reason: "pos-order-voided"
      };
      jobs.push(refundJob);
    }

    const referralCode = text(
      references.affiliateReferralCode || customer.referralCode
    ).toUpperCase();
    if (text(references.affiliateOrderId)) {
      jobs.push({
        ...baseJob(sale, "affiliate.reverse", "affiliate", createdAt),
        action: "reverse-order-benefits",
        blockedBy: refundJob ? refundJob.id : "",
        affiliateOrderId: text(references.affiliateOrderId),
        originalExternalOrderId: jobId(sale.id, "affiliate.fulfill"),
        referralCode,
        reason: "pos-order-voided"
      });
    }

    return jobs;
  }

  function buildJobs(sale, eventType = "checkout") {
    if (!sale || !text(sale.id)) return [];
    return eventType === "void" ? buildVoidJobs(sale) : buildCheckoutJobs(sale);
  }

  function attachJobReferences(sale, eventType = "checkout") {
    const jobs = buildJobs(sale, eventType);
    const existing = sale.integrationOutbox || {};
    const key = eventType === "void" ? "voidJobIds" : "checkoutJobIds";
    return {
      ...sale,
      integrationOutbox: {
        ...existing,
        schemaVersion: SCHEMA_VERSION,
        [key]: jobs.map((job) => job.id),
        updatedAt: eventType === "void"
          ? (sale.voidedAt || new Date().toISOString())
          : (sale.createdAt || new Date().toISOString())
      }
    };
  }

  const api = {
    SCHEMA_VERSION,
    buildJobs,
    attachJobReferences,
    hasAffiliateItems(items) {
      return affiliateItems(items).length > 0;
    },
    jobId
  };

  root.integrationContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : window));
