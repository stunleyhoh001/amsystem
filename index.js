const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

const ADMIN_EMAILS = [
  "stanleyhoh79@gmail.com",
];

const CONFIRM_DAYS = 7;

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

function money(value) {
  return `RM${Number(value || 0).toFixed(2)}`;
}

async function createAdminLog(tx, action, target, detail, adminEmail) {
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
    const plan = plans.find((item) => item.id === order.planId);
    if (!plan) {
      throw new HttpsError("not-found", "Plan not found.");
    }

    const user = userSnap.data();
    const paidAt = new Date().toISOString();
    const newBalance = Number(user.points || 0) + Number(plan.points || 0);

    tx.update(orderRef, {
      status: "paid",
      points: Number(plan.points || 0),
      paidAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.set(userRef, {
      points: newBalance,
      slots: Math.max(Number(user.slots || 0), Number(plan.slots || 0)),
      packageUntil: addDays(paidAt, Number(plan.validDays || 0)),
      level: Number(plan.amount || 0) >= 580 ? "高级推广用户" : "推广用户",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const pointLogRef = db.collection("amsystemPointLogs").doc();
    tx.set(pointLogRef, {
      id: pointLogRef.id,
      userId: order.userId,
      change: Number(plan.points || 0),
      balance: newBalance,
      source: order.id,
      note: `${plan.name} points issued`,
      createdAt: paidAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (user.referrerId) {
      const referrerRef = db.collection("amsystemUsers").doc(user.referrerId);
      const referrerSnap = await tx.get(referrerRef);
      if (referrerSnap.exists) {
        const referrer = referrerSnap.data();
        const referrerActive = referrer.packageUntil && new Date(referrer.packageUntil) > new Date() && !referrer.frozen;
        const shouldReward = order.type === "first" || (order.type === "repeat" && referrerActive);

        if (shouldReward) {
          const rate = order.type === "first" ? Number(plan.firstRate || 0) : Number(plan.repeatRate || 0);
          const amount = Number((Number(order.amount || 0) * (rate / 100)).toFixed(2));
          const rewardRef = db.collection("amsystemRewards").doc();
          tx.set(rewardRef, {
            id: rewardRef.id,
            userId: user.referrerId,
            sourceUserId: order.userId,
            orderId: order.id,
            type: order.type,
            rate,
            amount,
            status: "pending",
            confirmAfter: addDays(paidAt, CONFIRM_DAYS),
            createdAt: paidAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    await createAdminLog(tx, "确认付款", order.id, `Amount ${money(order.amount)}`, adminEmail);
  });

  return { ok: true };
});
