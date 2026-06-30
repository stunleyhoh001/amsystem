const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const posDb = admin.firestore(
  admin.initializeApp({ projectId: "simplepos-2900e" }, "simple-pos")
);

const ADMIN_EMAILS = [
  "stanleyhoh79@gmail.com",
];

const TEST_INSTANT_MODE = false;
const CONFIRM_DAYS = TEST_INSTANT_MODE ? 0 : 7;
const REPEAT_RELEASE_DAYS = TEST_INSTANT_MODE ? [0] : [7, 14, 30];
const PACKAGE_UNIT_AMOUNT = 180;

function text(value) {
  return String(value || "").trim();
}

function safeExternalId(value) {
  const normalized = text(value);
  if (!normalized || normalized.length > 160 || normalized.includes("/")) {
    throw new HttpsError("invalid-argument", "externalOrderId is invalid.");
  }
  return normalized;
}

function normalizeInviteCode(value) {
  return text(value).toUpperCase();
}

function isValidPackageAmount(amount) {
  const value = Number(amount || 0);
  return value > 0 && value % PACKAGE_UNIT_AMOUNT === 0;
}

function assertAdmin(request) {
  const email = request.auth && request.auth.token && request.auth.token.email;
  if (!email || !ADMIN_EMAILS.includes(email)) {
    throw new HttpsError("permission-denied", "Admin permission required.");
  }
  return email;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function addHours(date, hours) {
  const next = new Date(date);
  next.setHours(next.getHours() + Number(hours || 0));
  return next.toISOString();
}

function planRepeatCooldownHours(plan) {
  if (TEST_INSTANT_MODE) return 0;
  return Number(plan.repeatCooldownHours ?? 24);
}

function money(value) {
  return `RM${Number(value || 0).toFixed(2)}`;
}

function planRepeatCredits(plan) {
  return Number(plan.repeatCredits ?? 10);
}

function planDirectRepeatRate(plan) {
  return Number(plan && plan.directRepeatRate !== undefined ? plan.directRepeatRate : 10);
}

function planPoolRepeatRate(plan) {
  return Number(plan && plan.repeatRate !== undefined ? plan.repeatRate : 10);
}

function isActivePackage(user) {
  return Boolean(user && user.packageUntil) && new Date(user.packageUntil) > new Date() && !user.frozen;
}

function orderPlan(order, plans) {
  const currentPlan = (plans || []).find((item) => item.id === order.planId);
  const snapshot = order.planSnapshot || {};
  if (!currentPlan && !Object.keys(snapshot).length) return null;
  return {
    ...(currentPlan || {}),
    ...snapshot,
    id: order.planId,
    name: snapshot.name || (currentPlan && currentPlan.name) || "Deleted plan",
  };
}

function planSnapshot(plan) {
  return {
    id: plan.id,
    name: plan.name,
    amount: Number(plan.amount || 0),
    unitAmount: PACKAGE_UNIT_AMOUNT,
    unitCount: Number(plan.amount || 0) / PACKAGE_UNIT_AMOUNT,
    points: Number(plan.points || 0),
    slots: Number(plan.slots || 0),
    repeatCredits: planRepeatCredits(plan),
    repeatCooldownHours: planRepeatCooldownHours(plan),
    validDays: Number(plan.validDays || 0),
    firstRate: Number(plan.firstRate || 0),
    directRepeatRate: planDirectRepeatRate(plan),
    repeatRate: planPoolRepeatRate(plan),
  };
}

async function resolveExternalUserId(data = {}) {
  const explicitUserId = text(data.userId);
  if (explicitUserId) return explicitUserId;
  const customerPhone = text(data.customerPhone || (data.customer && data.customer.phone));
  if (!customerPhone) {
    throw new HttpsError("invalid-argument", "userId or customerPhone is required.");
  }
  const snapshot = await db.collection("amsystemUsers")
    .where("phone", "==", customerPhone)
    .limit(2)
    .get();
  if (snapshot.empty) {
    throw new HttpsError("not-found", "No affiliate user matches this phone.");
  }
  if (snapshot.size > 1) {
    throw new HttpsError("failed-precondition", "Multiple affiliate users match this phone.");
  }
  return snapshot.docs[0].id;
}

function rewardAmount(order, rate) {
  return Number((Number(order.amount || 0) * (Number(rate || 0) / 100)).toFixed(2));
}

function createReleasePlan(totalAmount, paidAt) {
  const amount = Number(totalAmount || 0);
  let remaining = amount;
  return REPEAT_RELEASE_DAYS.map((days, index) => {
    const isLast = index === REPEAT_RELEASE_DAYS.length - 1;
    const partAmount = isLast
      ? remaining
      : Number((amount / REPEAT_RELEASE_DAYS.length).toFixed(2));
    remaining = Number((remaining - partAmount).toFixed(2));
    return {
      amount: partAmount,
      releaseAt: addDays(paidAt, days),
      released: TEST_INSTANT_MODE,
      releasedAt: TEST_INSTANT_MODE ? paidAt : "",
    };
  });
}

function createAdminLog(tx, action, target, detail, adminEmail) {
  const ref = db.collection("amsystemAdminLogs").doc();
  tx.set(ref, {
    id: ref.id,
    adminEmail,
    action,
    target,
    detail,
    createdAt: new Date().toISOString(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function createReward(tx, payload) {
  const rewardRef = db.collection("amsystemRewards").doc();
  tx.set(rewardRef, {
    id: rewardRef.id,
    status: TEST_INSTANT_MODE ? "confirmed" : "pending",
    confirmAfter: addDays(payload.createdAt, CONFIRM_DAYS),
    reviewedAt: TEST_INSTANT_MODE ? payload.createdAt : "",
    reviewNote: TEST_INSTANT_MODE ? "测试即时模式自动确认" : "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...payload,
  });
}

function createRepeatCreditLog(tx, payload) {
  const logRef = db.collection("amsystemRepeatCreditLogs").doc();
  tx.set(logRef, {
    id: logRef.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...payload,
  });
}

async function confirmOrderById(orderId, adminEmail) {
  if (!orderId) {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }

  const orderRef = db.collection("amsystemOrders").doc(orderId);
  const systemRef = db.collection("amsystem").doc("main");

  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }

    const order = orderSnap.data();
    if (order.status === "paid") {
      return;
    }
    if (order.status !== "pending") {
      throw new HttpsError("failed-precondition", "Only pending orders can be confirmed.");
    }

    const userRef = db.collection("amsystemUsers").doc(order.userId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }

    const systemSnap = await tx.get(systemRef);
    const plans = systemSnap.exists && Array.isArray(systemSnap.data().plans) ? systemSnap.data().plans : [];
    const plan = orderPlan(order, plans);
    if (!plan) {
      throw new HttpsError("not-found", "Plan not found.");
    }
    if (!isValidPackageAmount(order.amount) || !isValidPackageAmount(plan.amount)) {
      throw new HttpsError("failed-precondition", `Package amount must be a multiple of RM${PACKAGE_UNIT_AMOUNT}.`);
    }

    const buyer = userSnap.data();
    const paidOrdersSnap = await tx.get(
      db.collection("amsystemOrders")
        .where("userId", "==", order.userId)
        .where("status", "==", "paid")
    );
    const actualType = paidOrdersSnap.empty ? "first" : "repeat";
    const paidAt = new Date().toISOString();
    const pointChange = Number(plan.points || 0);
    const newBalance = Number(buyer.points || 0) + pointChange;
    const currentRepeatCredits = Number(buyer.repeatCredits || 0);
    const nextRepeatCredits = currentRepeatCredits;
    const buyerQueueAt = buyer.repeatCreditQueueAt || "";

    let referrerSnap = null;
    if (buyer.referrerId) {
      referrerSnap = await tx.get(db.collection("amsystemUsers").doc(buyer.referrerId));
    }

    let repeatReceiver = null;
    if (actualType === "repeat") {
      const eligibleSnap = await tx.get(
        db.collection("amsystemUsers").where("repeatCredits", ">", 0)
      );
      const eligibleUsers = [];
      eligibleSnap.forEach((doc) => {
        if (doc.id === order.userId) return;
        const data = doc.data();
        if (data.frozen) return;
        eligibleUsers.push({ id: doc.id, ref: doc.ref, ...data });
      });
      eligibleUsers.sort((a, b) =>
        new Date(a.repeatCreditQueueAt || "9999-12-31") - new Date(b.repeatCreditQueueAt || "9999-12-31")
      );
      repeatReceiver = eligibleUsers[0] || null;
    }

    tx.update(orderRef, {
      status: "paid",
      type: actualType,
      points: pointChange,
      paidAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(userRef, {
      points: newBalance,
      slots: Math.max(Number(buyer.slots || 0), Number(plan.slots || 0)),
      repeatCredits: nextRepeatCredits,
      repeatCreditQueueAt: buyerQueueAt,
      repeatCooldownUntil: actualType === "repeat" ? addHours(paidAt, planRepeatCooldownHours(plan)) : (buyer.repeatCooldownUntil || ""),
      packageUntil: addDays(paidAt, Number(plan.validDays || 0)),
      level: Number(plan.amount || 0) >= 720 ? "高级推广用户" : "推广用户",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const pointLogRef = db.collection("amsystemPointLogs").doc();
    tx.set(pointLogRef, {
      id: pointLogRef.id,
      userId: order.userId,
      change: pointChange,
      balance: newBalance,
      source: order.id,
      note: `${plan.name} 积分发放`,
      createdAt: paidAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (actualType === "first" && referrerSnap && referrerSnap.exists) {
      const referrer = referrerSnap.data();
      const rate = Number(plan.firstRate || 0);
      if (!referrer.frozen && rate > 0) {
        createReward(tx, {
          userId: buyer.referrerId,
          sourceUserId: order.userId,
          sourceUserName: buyer.name || "",
          sourceUserAccount: buyer.account || "",
          sourceUserInviteCode: buyer.inviteCode || "",
          orderId: order.id,
          type: "first",
          rate,
          amount: rewardAmount(order, rate),
          createdAt: paidAt,
        });
      }
    }

    if (actualType === "repeat" && repeatReceiver) {
      const rate = planPoolRepeatRate(plan);
      if (rate > 0) {
        const receiverCredits = Math.max(Number(repeatReceiver.repeatCredits || 0) - 1, 0);
        tx.set(repeatReceiver.ref, {
          repeatCredits: receiverCredits,
          repeatCreditQueueAt: receiverCredits > 0 ? (repeatReceiver.repeatCreditQueueAt || "") : "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        createRepeatCreditLog(tx, {
          userId: repeatReceiver.id,
          change: -1,
          balance: receiverCredits,
          reason: "used",
          source: order.id,
          note: `Repeat pool reward from ${buyer.name || buyer.account || order.userId}`,
          createdAt: paidAt,
        });

        const repeatRewardAmount = rewardAmount(order, rate);
        createReward(tx, {
          userId: repeatReceiver.id,
          sourceUserId: order.userId,
          sourceUserName: buyer.name || "",
          sourceUserAccount: buyer.account || "",
          sourceUserInviteCode: buyer.inviteCode || "",
          orderId: order.id,
          type: "repeat",
          rewardMode: "pool",
          rate,
          amount: repeatRewardAmount,
          releasedAmount: TEST_INSTANT_MODE ? repeatRewardAmount : 0,
          releasePlan: createReleasePlan(repeatRewardAmount, paidAt),
          createdAt: paidAt,
        });
      }
    }

    if (actualType === "repeat" && referrerSnap && referrerSnap.exists) {
      const referrer = referrerSnap.data();
      const rate = planDirectRepeatRate(plan);
      if (isActivePackage(referrer) && rate > 0) {
        const directRewardAmount = rewardAmount(order, rate);
        createReward(tx, {
          userId: buyer.referrerId,
          sourceUserId: order.userId,
          sourceUserName: buyer.name || "",
          sourceUserAccount: buyer.account || "",
          sourceUserInviteCode: buyer.inviteCode || "",
          orderId: order.id,
          type: "repeat",
          rewardMode: "direct",
          rate,
          amount: directRewardAmount,
          releasedAmount: TEST_INSTANT_MODE ? directRewardAmount : 0,
          releasePlan: createReleasePlan(directRewardAmount, paidAt),
          createdAt: paidAt,
        });
      }
    }

    createAdminLog(tx, "确认付款", order.id, `金额 ${money(order.amount)}`, adminEmail);
  });

  return { ok: true };
}

exports.confirmOrder = onCall(async (request) => {
  const adminEmail = assertAdmin(request);
  const orderId = request.data && request.data.orderId;
  return confirmOrderById(orderId, adminEmail);
});

async function ingestPosOrderData(data, adminEmail) {
  const externalOrderId = safeExternalId(data.externalOrderId);
  const posOrderId = text(data.posOrderId) || externalOrderId;
  const paymentReference = text(data.paymentReference);
  const amount = Number(data.amount || 0);
  const planId = text(data.planId) || "plan_rm180";
  const referralCode = normalizeInviteCode(data.referralCode);
  if (data.paymentStatus !== "confirmed" || !paymentReference) {
    throw new HttpsError("failed-precondition", "Confirmed payment and paymentReference are required.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("invalid-argument", "amount must be positive.");
  }

  const userId = await resolveExternalUserId(data);
  const externalRef = db.collection("amsystemExternalOrders").doc(externalOrderId);
  const orderId = `POS-${externalOrderId}`;
  const orderRef = db.collection("amsystemOrders").doc(orderId);
  const userRef = db.collection("amsystemUsers").doc(userId);
  const systemRef = db.collection("amsystem").doc("main");
  const inviteRef = referralCode
    ? db.collection("amsystemInviteCodes").doc(referralCode)
    : null;

  const result = await db.runTransaction(async (tx) => {
    const externalSnapshot = await tx.get(externalRef);
    const orderSnapshot = await tx.get(orderRef);
    const userSnapshot = await tx.get(userRef);
    const systemSnapshot = await tx.get(systemRef);
    const inviteSnapshot = inviteRef ? await tx.get(inviteRef) : null;

    if (!userSnapshot.exists) throw new HttpsError("not-found", "Affiliate user not found.");
    const buyer = userSnapshot.data();
    const plans = systemSnapshot.exists && Array.isArray(systemSnapshot.data().plans)
      ? systemSnapshot.data().plans
      : [];
    const plan = plans.find((item) => item.id === planId);
    if (!plan) throw new HttpsError("not-found", "Affiliate plan not found.");
    if (!isValidPackageAmount(plan.amount) || Number(plan.amount) !== amount) {
      throw new HttpsError(
        "failed-precondition",
        `POS amount must match affiliate plan price RM${Number(plan.amount || 0).toFixed(2)}.`
      );
    }
    if (referralCode) {
      if (!inviteSnapshot || !inviteSnapshot.exists) {
        throw new HttpsError("not-found", "Referral code not found.");
      }
      const expectedReferrerId = inviteSnapshot.data().userId;
      if (!buyer.referrerId || buyer.referrerId !== expectedReferrerId) {
        throw new HttpsError("failed-precondition", "Referral code does not match the user's fixed referrer.");
      }
    }

    if (externalSnapshot.exists) {
      const existing = externalSnapshot.data();
      if (
        existing.userId !== userId
        || existing.planId !== planId
        || Number(existing.amount) !== amount
        || existing.paymentReference !== paymentReference
      ) {
        throw new HttpsError("already-exists", "externalOrderId is already linked to different data.");
      }
      return {
        orderId: existing.affiliateOrderId || orderId,
        duplicate: true,
        status: existing.status || (orderSnapshot.exists ? orderSnapshot.data().status : "pending")
      };
    }
    if (orderSnapshot.exists) {
      throw new HttpsError("already-exists", "Affiliate order ID already exists.");
    }

    const createdAt = text(data.createdAt) || new Date().toISOString();
    const order = {
      id: orderId,
      userId,
      planId,
      planSnapshot: planSnapshot(plan),
      type: "",
      status: "pending",
      amount: Number(plan.amount),
      points: 0,
      paymentMethod: text(data.paymentMethod) || "SimplePay",
      paymentRef: paymentReference,
      paymentNote: `POS ${posOrderId}`,
      proofStatus: "external-confirmed",
      sourceSystem: "simple-pos",
      externalOrderId,
      posOrderId,
      branchId: text(data.branchId),
      referralCode,
      createdAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    tx.create(orderRef, order);
    tx.create(externalRef, {
      id: externalOrderId,
      idempotencyKey: externalOrderId,
      sourceSystem: "simple-pos",
      posOrderId,
      affiliateOrderId: orderId,
      userId,
      planId,
      amount: Number(plan.amount),
      paymentReference,
      referralCode,
      branchId: text(data.branchId),
      status: "pending-confirmation",
      createdAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    createAdminLog(
      tx,
      "接收 POS 订单",
      orderId,
      `POS ${posOrderId} / ${money(amount)} / ${paymentReference}`,
      adminEmail
    );
    return { orderId, duplicate: false, status: "pending" };
  });

  try {
    await confirmOrderById(result.orderId, adminEmail);
    await externalRef.set({
      status: "paid",
      confirmedAt: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      ok: true,
      externalOrderId,
      affiliateOrderId: result.orderId,
      status: "paid",
      duplicate: result.duplicate
    };
  } catch (error) {
    await externalRef.set({
      status: "confirmation-failed",
      lastError: error.message || "Order confirmation failed.",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    throw error;
  }
}

exports.ingestPosOrder = onCall(async (request) => {
  const adminEmail = assertAdmin(request);
  return ingestPosOrderData(request.data || {}, adminEmail);
});

function rewardHasReleasedValue(reward = {}) {
  if (Number(reward.releasedAmount || 0) > 0) return true;
  if (["confirmed", "releasing"].includes(reward.status)) return true;
  return Array.isArray(reward.releasePlan)
    && reward.releasePlan.some((part) => part.released || part.releasedAt);
}

function entitlementFromOrders(orders = []) {
  const paid = orders
    .filter((order) => order.status === "paid")
    .sort((a, b) => new Date(b.paidAt || b.createdAt) - new Date(a.paidAt || a.createdAt));
  if (!paid.length) {
    return {
      slots: 0,
      packageUntil: "",
      repeatCooldownUntil: "",
      level: "普通用户"
    };
  }
  const latest = paid[0];
  const plans = paid.map((order) => order.planSnapshot || {});
  const maxAmount = Math.max(...plans.map((plan) => Number(plan.amount || 0)), 0);
  const latestPlan = latest.planSnapshot || {};
  return {
    slots: Math.max(...plans.map((plan) => Number(plan.slots || 0)), 0),
    packageUntil: addDays(
      latest.paidAt || latest.createdAt,
      Number(latestPlan.validDays || 0)
    ),
    repeatCooldownUntil: latest.type === "repeat"
      ? addHours(latest.paidAt || latest.createdAt, planRepeatCooldownHours(latestPlan))
      : "",
    level: maxAmount >= 720 ? "高级推广用户" : "推广用户"
  };
}

async function reversePosOrderData(data, adminEmail) {
  const externalOrderId = safeExternalId(data.externalOrderId);
  const refundReference = text(data.refundReference);
  const reason = text(data.reason) || "POS order refunded";
  if (!refundReference) {
    throw new HttpsError("invalid-argument", "refundReference is required.");
  }

  const externalRef = db.collection("amsystemExternalOrders").doc(externalOrderId);
  const caseRef = db.collection("amsystemReversalCases").doc(`REV-${externalOrderId}`);

  return db.runTransaction(async (tx) => {
    const externalSnapshot = await tx.get(externalRef);
    if (!externalSnapshot.exists) throw new HttpsError("not-found", "External order not found.");
    const externalOrder = externalSnapshot.data();
    const orderRef = db.collection("amsystemOrders").doc(externalOrder.affiliateOrderId);
    const orderSnapshot = await tx.get(orderRef);
    if (!orderSnapshot.exists) throw new HttpsError("not-found", "Affiliate order not found.");
    const order = orderSnapshot.data();

    if (externalOrder.status === "reversed" || order.status === "refunded") {
      return {
        ok: true,
        status: "reversed",
        duplicate: true,
        caseId: caseRef.id
      };
    }
    if (!["paid", "reversal-review"].includes(order.status)) {
      throw new HttpsError("failed-precondition", "Only paid orders can be reversed.");
    }

    const userRef = db.collection("amsystemUsers").doc(order.userId);
    const userSnapshot = await tx.get(userRef);
    const rewardsSnapshot = await tx.get(
      db.collection("amsystemRewards").where("orderId", "==", order.id)
    );
    const repeatLogsSnapshot = await tx.get(
      db.collection("amsystemRepeatCreditLogs").where("source", "==", order.id)
    );
    const remainingOrdersSnapshot = await tx.get(
      db.collection("amsystemOrders")
        .where("userId", "==", order.userId)
        .where("status", "==", "paid")
    );
    if (!userSnapshot.exists) throw new HttpsError("not-found", "Affiliate user not found.");

    const rewards = rewardsSnapshot.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
    const buyer = userSnapshot.data();
    const hasReleasedRewards = rewards.some(rewardHasReleasedValue);
    const hasInsufficientBuyerPoints = Number(buyer.points || 0) < Number(order.points || 0);
    const requiresManualReview = hasReleasedRewards || hasInsufficientBuyerPoints;
    const createdAt = new Date().toISOString();

    if (requiresManualReview) {
      rewards.forEach((reward) => {
        tx.set(reward.ref, {
          previousStatus: reward.status,
          status: "frozen",
          reversalCaseId: caseRef.id,
          reviewNote: [reward.reviewNote, `退款冻结：${refundReference}`].filter(Boolean).join(" / "),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
      tx.set(orderRef, {
        status: "reversal-review",
        reversalCaseId: caseRef.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(externalRef, {
        status: "reversal-review",
        refundReference,
        reversalCaseId: caseRef.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(caseRef, {
        id: caseRef.id,
        externalOrderId,
        affiliateOrderId: order.id,
        userId: order.userId,
        refundReference,
        reason,
        status: "review-required",
        riskReasons: [
          hasReleasedRewards ? "released-rewards" : "",
          hasInsufficientBuyerPoints ? "insufficient-buyer-points" : ""
        ].filter(Boolean),
        releasedRewardAmount: rewards.reduce(
          (sum, reward) => sum + Number(reward.releasedAmount || reward.amount || 0),
          0
        ),
        rewardIds: rewards.map((reward) => reward.id),
        createdAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      createAdminLog(
        tx,
        "POS 退款待复核",
        order.id,
        `${refundReference} / ${hasReleasedRewards ? "已释放奖励" : "买家积分不足"}，相关奖励已冻结`,
        adminEmail
      );
      return {
        ok: true,
        status: "review-required",
        duplicate: false,
        caseId: caseRef.id
      };
    }

    const receiverRefs = [];
    for (const logDoc of repeatLogsSnapshot.docs) {
      const log = logDoc.data();
      if (Number(log.change || 0) >= 0) continue;
      receiverRefs.push({
        log,
        logRef: logDoc.ref,
        userRef: db.collection("amsystemUsers").doc(log.userId),
        userSnapshot: await tx.get(db.collection("amsystemUsers").doc(log.userId))
      });
    }

    const remainingOrders = remainingOrdersSnapshot.docs
      .filter((doc) => doc.id !== order.id)
      .map((doc) => ({ id: doc.id, ...doc.data() }));
    const entitlements = entitlementFromOrders(remainingOrders);
    const nextPoints = Math.max(Number(buyer.points || 0) - Number(order.points || 0), 0);

    rewards.forEach((reward) => {
      tx.set(reward.ref, {
        previousStatus: reward.status,
        status: "cancelled",
        reversalCaseId: caseRef.id,
        reviewedAt: createdAt,
        reviewNote: [reward.reviewNote, `POS 退款撤销：${refundReference}`].filter(Boolean).join(" / "),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    receiverRefs.forEach(({ log, userRef: receiverRef, userSnapshot: receiverSnapshot }) => {
      if (!receiverSnapshot.exists) return;
      const receiver = receiverSnapshot.data();
      const restoredCredits = Number(receiver.repeatCredits || 0) - Number(log.change || 0);
      tx.set(receiverRef, {
        repeatCredits: restoredCredits,
        repeatCreditQueueAt: receiver.repeatCreditQueueAt || createdAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      createRepeatCreditLog(tx, {
        userId: log.userId,
        change: -Number(log.change || 0),
        balance: restoredCredits,
        reason: "refund-reversal",
        source: order.id,
        note: `Restored after POS refund ${refundReference}`,
        createdAt
      });
    });
    tx.set(userRef, {
      points: nextPoints,
      ...entitlements,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const pointLogRef = db.collection("amsystemPointLogs").doc();
    tx.set(pointLogRef, {
      id: pointLogRef.id,
      userId: order.userId,
      change: -Number(order.points || 0),
      balance: nextPoints,
      source: order.id,
      note: `POS refund reversal ${refundReference}`,
      createdAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.set(orderRef, {
      status: "refunded",
      refundedAt: createdAt,
      refundReference,
      reversalCaseId: caseRef.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(externalRef, {
      status: "reversed",
      reversedAt: createdAt,
      refundReference,
      reversalCaseId: caseRef.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(caseRef, {
      id: caseRef.id,
      externalOrderId,
      affiliateOrderId: order.id,
      userId: order.userId,
      refundReference,
      reason,
      status: "reversed",
      releasedRewardAmount: 0,
      rewardIds: rewards.map((reward) => reward.id),
      createdAt,
      resolvedAt: createdAt,
      resolvedBy: adminEmail,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    createAdminLog(tx, "撤销 POS 订单", order.id, `${refundReference} / ${reason}`, adminEmail);
    return {
      ok: true,
      status: "reversed",
      duplicate: false,
      caseId: caseRef.id
    };
  });
}

exports.reversePosOrder = onCall(async (request) => {
  const adminEmail = assertAdmin(request);
  return reversePosOrderData(request.data || {}, adminEmail);
});

exports.processPosIntegrationCommand = onDocumentCreated(
  "amsystemIntegrationCommands/{commandId}",
  async (event) => {
    const commandRef = event.data.ref;
    const claimed = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(commandRef);
      if (!snapshot.exists) return null;
      const command = snapshot.data();
      if (command.status !== "pending") return null;
      tx.update(commandRef, {
        status: "processing",
        attempts: Number(command.attempts || 0) + 1,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return command;
    });
    if (!claimed) return;

    const posJobId = text(claimed.posJobId || event.params.commandId);
    try {
      const initialPosJob = await posDb.collection("integrationJobs").doc(posJobId).get();
      if (
        !initialPosJob.exists
        || initialPosJob.data().status === "canceled"
        || text(claimed.sourceSystem) !== "simple-pos"
      ) {
        await commandRef.set({
          status: "canceled",
          cancelReason: "pos-job-not-active",
          canceledAt: new Date().toISOString(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }
      let result;
      if (claimed.operation === "ingestPosOrder") {
        result = await ingestPosOrderData(claimed.payload || {}, "simple-pos-worker@system");
      } else if (claimed.operation === "reversePosOrder") {
        result = await reversePosOrderData(claimed.payload || {}, "simple-pos-worker@system");
      } else {
        throw new Error(`Unsupported integration operation: ${claimed.operation}`);
      }
      const posOrderId = text(claimed.payload && claimed.payload.posOrderId);
      const posJobRef = posDb.collection("integrationJobs").doc(posJobId);
      const posSaleRef = posOrderId ? posDb.collection("sales").doc(posOrderId) : null;
      let lateCancellation = false;

      if (claimed.operation === "ingestPosOrder" && posSaleRef) {
        await posDb.runTransaction(async (tx) => {
          const [jobSnapshot, saleSnapshot] = await Promise.all([
            tx.get(posJobRef),
            tx.get(posSaleRef)
          ]);
          lateCancellation = !jobSnapshot.exists
            || jobSnapshot.data().status === "canceled"
            || !saleSnapshot.exists
            || saleSnapshot.data().status === "voided";
          if (lateCancellation) return;
          tx.set(posJobRef, {
            status: "completed",
            targetReference: `amsystemIntegrationCommands/${event.params.commandId}`,
            result: {
              affiliateOrderId: text(result.affiliateOrderId),
              affiliateStatus: text(result.status)
            },
            cloudUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          tx.update(posSaleRef, {
            "externalReferences.affiliateOrderId": text(result.affiliateOrderId),
            "externalReferences.affiliateStatus": "linked",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
      }

      if (lateCancellation) {
        const reversal = await reversePosOrderData({
          externalOrderId: text(claimed.payload && claimed.payload.externalOrderId),
          refundReference: `POS-VOID-${posOrderId || posJobId}`,
          reason: "POS order was canceled while affiliate fulfillment was processing"
        }, "simple-pos-worker@system");
        const affiliateStatus = reversal.status === "reversed" ? "reversed" : "review-required";
        await Promise.all([
          commandRef.set({
            status: "canceled-after-processing",
            result: { ...result, lateCancellation: true, reversal },
            completedAt: new Date().toISOString(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true }),
          posJobRef.set({
            status: "canceled",
            result: {
              affiliateOrderId: text(result.affiliateOrderId),
              affiliateStatus,
              reversalCaseId: text(reversal.caseId)
            },
            cloudUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true }),
          posSaleRef.set({
            "externalReferences.affiliateOrderId": text(result.affiliateOrderId),
            "externalReferences.affiliateStatus": affiliateStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true })
        ]);
        return;
      }

      if (claimed.operation === "reversePosOrder") {
        await posJobRef.set({
          status: "completed",
          targetReference: `amsystemIntegrationCommands/${event.params.commandId}`,
          result: {
            affiliateStatus: text(result.status),
            reversalCaseId: text(result.caseId)
          },
          cloudUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        if (posSaleRef) {
          await posSaleRef.set({
            "externalReferences.affiliateStatus": result.status === "reversed"
              ? "reversed"
              : "review-required",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }
      await commandRef.set({
        status: "completed",
        result,
        completedAt: new Date().toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("POS integration command failed", event.params.commandId, error);
      const failure = {
        code: text(error.code || "affiliate-integration-error"),
        message: text(error.message || "Affiliate integration failed"),
        at: new Date().toISOString()
      };
      await commandRef.set({
        status: "failed",
        lastError: failure,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await posDb.collection("integrationJobs").doc(posJobId).set({
        status: "needs-attention",
        lastError: failure,
        cloudUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  }
);

