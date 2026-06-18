const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

const ADMIN_EMAILS = [
  "stanleyhoh79@gmail.com",
];

const CONFIRM_DAYS = 7;
const REPEAT_RELEASE_DAYS = [7, 14, 30];

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
  return Number(plan.repeatCooldownHours ?? 24);
}

function money(value) {
  return `RM${Number(value || 0).toFixed(2)}`;
}

function planRepeatCredits(plan) {
  return Number(plan.repeatCredits ?? 10);
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
      released: false,
      releasedAt: "",
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
    status: "pending",
    confirmAfter: addDays(payload.createdAt, CONFIRM_DAYS),
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

exports.confirmOrder = onCall(async (request) => {
  const adminEmail = assertAdmin(request);
  const orderId = request.data && request.data.orderId;

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
    const earnedRepeatCredits = actualType === "repeat" ? planRepeatCredits(plan) : 0;
    const currentRepeatCredits = Number(buyer.repeatCredits || 0);
    const nextRepeatCredits = currentRepeatCredits + earnedRepeatCredits;
    const buyerQueueAt = earnedRepeatCredits > 0 && (!buyer.repeatCreditQueueAt || currentRepeatCredits <= 0)
      ? paidAt
      : (buyer.repeatCreditQueueAt || "");

    let referrerSnap = null;
    if (actualType === "first" && buyer.referrerId) {
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
      level: Number(plan.amount || 0) >= 580 ? "高级推广用户" : "推广用户",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (earnedRepeatCredits > 0) {
      createRepeatCreditLog(tx, {
        userId: order.userId,
        change: earnedRepeatCredits,
        balance: nextRepeatCredits,
        reason: "earned",
        source: order.id,
        note: `${plan.name} repeat purchase`,
        createdAt: paidAt,
      });
    }

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
          orderId: order.id,
          type: "first",
          rate,
          amount: rewardAmount(order, rate),
          createdAt: paidAt,
        });
      }
    }

    if (actualType === "repeat" && repeatReceiver) {
      const rate = Number(plan.repeatRate || 0);
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
          orderId: order.id,
          type: "repeat",
          rewardMode: "pool",
          rate,
          amount: repeatRewardAmount,
          releasedAmount: 0,
          releasePlan: createReleasePlan(repeatRewardAmount, paidAt),
          createdAt: paidAt,
        });
      }
    }

    createAdminLog(tx, "确认付款", order.id, `金额 ${money(order.amount)}`, adminEmail);
  });

  return { ok: true };
});
