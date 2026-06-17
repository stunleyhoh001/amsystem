import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const STORAGE_KEY = "amsystemFirebaseFallback";
const APP_VERSION = "20260617-45";
const WITHDRAW_COOLDOWN_HOURS = 24;
const SYSTEM_DOC_PATH = ["amsystem", "main"];
const USER_COLLECTION = "amsystemUsers";
const ORDER_COLLECTION = "amsystemOrders";
const REWARD_COLLECTION = "amsystemRewards";
const WITHDRAW_COLLECTION = "amsystemWithdraws";
const POINT_LOG_COLLECTION = "amsystemPointLogs";
const REPEAT_CREDIT_LOG_COLLECTION = "amsystemRepeatCreditLogs";
const ADMIN_LOG_COLLECTION = "amsystemAdminLogs";
const INVITE_COLLECTION = "amsystemInviteCodes";
const REFERRAL_COLLECTION = "amsystemReferrals";
const CONFIRM_DAYS = 7;
const REPEAT_RELEASE_DAYS = [7, 14, 30];
const MIN_WITHDRAW_AMOUNT = 50;
const PROOF_UPLOAD_TIMEOUT_MS = 60000;
const PROOF_STORAGE_ATTEMPT_MS = 12000;
const INLINE_PROOF_MAX_BYTES = 750 * 1024;
const ADMIN_EMAILS = [
  "stanleyhoh79@gmail.com",
];

const firebaseConfig = {
  apiKey: "AIzaSyDvPQgQiMVSqTsSe00D75k8bwMoFTjm164",
  authDomain: "amsystem-faafb.firebaseapp.com",
  projectId: "amsystem-faafb",
  storageBucket: "amsystem-faafb.firebasestorage.app",
  messagingSenderId: "526690797426",
  appId: "1:526690797426:web:6206d7ffb46abfcc98bfeb",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const systemRef = doc(db, ...SYSTEM_DOC_PATH);
const usersRef = collection(db, USER_COLLECTION);
const ordersRef = collection(db, ORDER_COLLECTION);
const rewardsRef = collection(db, REWARD_COLLECTION);
const withdrawsRef = collection(db, WITHDRAW_COLLECTION);
const pointLogsRef = collection(db, POINT_LOG_COLLECTION);
const repeatCreditLogsRef = collection(db, REPEAT_CREDIT_LOG_COLLECTION);
const adminLogsRef = collection(db, ADMIN_LOG_COLLECTION);
const invitesRef = collection(db, INVITE_COLLECTION);
const referralsRef = collection(db, REFERRAL_COLLECTION);

let firebaseReady = false;
let cloudAvailable = false;
let firebaseUser = null;
let state = null;
let syncMessage = "Firestore：等待检测";
let editingPlanId = "";

function isIgnorableSdkError(message) {
  return String(message || "").includes("INTERNAL ASSERTION FAILED: Pending promise was never set");
}

window.addEventListener("error", (event) => {
  if (isIgnorableSdkError(event.message)) {
    event.preventDefault();
    return;
  }
  const status = document.querySelector("#authStatus");
  if (status) status.textContent = `脚本错误：${event.message}`;
});

window.addEventListener("unhandledrejection", (event) => {
  const status = document.querySelector("#authStatus");
  const message = event.reason?.message || event.reason?.code || "未知异步错误";
  if (isIgnorableSdkError(message)) {
    event.preventDefault();
    return;
  }
  if (status) status.textContent = `异步错误：${message}`;
});

function setAuthStatusText(message) {
  const status = document.querySelector("#authStatus");
  if (status) status.textContent = message;
}

function setSyncStatusText(message) {
  const syncStatus = document.querySelector("#syncStatus");
  if (syncStatus) syncStatus.textContent = readableSyncMessage(message);
}

function renderAppVersion() {
  let target = document.querySelector("#appVersionText");
  const syncStatus = document.querySelector("#syncStatus");
  if (!target && syncStatus?.parentNode) {
    target = document.createElement("p");
    target.id = "appVersionText";
    target.className = "help-text muted-line";
    syncStatus.insertAdjacentElement("afterend", target);
  }
  if (target) target.textContent = `当前前端版本：${APP_VERSION}`;
}

function readableSyncMessage(message) {
  const text = String(message || "");
  if (text.includes("permission-denied")) {
    return "Firestore：权限被拒绝。请发布最新 firestore.rules，然后点“测试云端保存”。资料已暂存在本地。";
  }
  if (text.includes("storage/unauthorized")) {
    return "Storage：付款证明上传权限不足。请检查 storage.rules 是否已发布。";
  }
  return text;
}

function localPendingSyncItems(userId = currentUser()?.id) {
  if (!userId || !state) return [];
  const pendingOrders = (state.orders || []).filter((order) => order.userId === userId && order.status === "pending").length;
  const pendingWithdraws = (state.withdraws || []).filter((withdraw) => withdraw.userId === userId && withdraw.status === "pending").length;
  const failedProofs = (state.orders || []).filter((order) => order.userId === userId && order.proofStatus === "failed").length;
  const items = [];
  if (pendingOrders) items.push(`${pendingOrders} 笔充值订单`);
  if (pendingWithdraws) items.push(`${pendingWithdraws} 笔提现申请`);
  if (failedProofs) items.push(`${failedProofs} 个付款凭证待补传`);
  return items;
}

function ensureLocalSyncHint() {
  let hint = document.querySelector("#localSyncHint");
  if (hint) return hint;
  const syncStatus = document.querySelector("#syncStatus");
  if (!syncStatus?.parentNode) return null;
  hint = document.createElement("p");
  hint.id = "localSyncHint";
  hint.className = "help-text warning-text";
  hint.hidden = true;
  syncStatus.insertAdjacentElement("afterend", hint);
  return hint;
}

function renderLocalSyncHint(user = currentUser()) {
  const hint = ensureLocalSyncHint();
  if (!hint) return;
  const items = user && !cloudAvailable ? localPendingSyncItems(user.id) : [];
  hint.textContent = items.length
    ? `本地暂存待同步：${items.join("、")}。发布 Rules 后点“测试云端保存”。`
    : "";
  hint.hidden = !hint.textContent;
}

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function pastDate(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function createSeedData() {
  const data = {
    currentUserId: "u_1002",
    plans: [
      { id: "plan_rm180", name: "RM180 启动配套", amount: 180, points: 18000, slots: 10, repeatCredits: 10, repeatCooldownHours: 24, validDays: 30, firstRate: 20, repeatRate: 8 },
      { id: "plan_rm580", name: "RM580 进阶配套", amount: 580, points: 58000, slots: 35, repeatCredits: 10, repeatCooldownHours: 24, validDays: 60, firstRate: 25, repeatRate: 10 },
    ],
    users: [
      { id: "u_1001", name: "李明", account: "liming@example.com", phone: "", withdrawMethod: "", withdrawAccount: "", inviteCode: "LM1001", referrerId: "", level: "推广用户", points: 18000, slots: 10, repeatCredits: 5, repeatCreditQueueAt: pastDate(7), repeatCooldownUntil: "", packageUntil: futureDate(20), frozen: false },
      { id: "u_1002", name: "王芳", account: "13800000002", phone: "", withdrawMethod: "", withdrawAccount: "", inviteCode: "WF1002", referrerId: "u_1001", level: "高级推广用户", points: 58000, slots: 35, repeatCredits: 0, repeatCreditQueueAt: "", repeatCooldownUntil: "", packageUntil: futureDate(45), frozen: false },
      { id: "u_1003", name: "陈杰", account: "chenjie@example.com", phone: "", withdrawMethod: "", withdrawAccount: "", inviteCode: "CJ1003", referrerId: "u_1001", level: "普通用户", points: 0, slots: 0, repeatCredits: 0, repeatCreditQueueAt: "", repeatCooldownUntil: "", packageUntil: "", frozen: false },
    ],
    orders: [],
    pointLogs: [],
    rewards: [],
    withdraws: [],
    repeatCreditLogs: [],
    referrals: [],
    adminLogs: [],
  };
  createOrder(data, "u_1002", "plan_rm580", "first", "paid", pastDate(8));
  createOrder(data, "u_1003", "plan_rm180", "first", "paid", pastDate(1));
  data.referrals = data.users.filter((user) => user.referrerId).map((user) => referralDocForUser(user, data));
  return data;
}

async function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const localState = saved ? JSON.parse(saved) : null;
  if (!firebaseUser) {
    return localState || createSeedData();
  }
  try {
    const snapshot = await getDoc(systemRef);
    const seeded = createSeedData();
    cloudAvailable = true;
    if (firebaseUser && isAdmin()) {
      const usersSnapshot = await getDocs(usersRef);
      const records = {
        orders: snapshotDocs(await getDocs(ordersRef)),
        rewards: snapshotDocs(await getDocs(rewardsRef)),
        withdraws: snapshotDocs(await getDocs(withdrawsRef)),
        pointLogs: snapshotDocs(await getDocs(pointLogsRef)),
        repeatCreditLogs: snapshotDocs(await getDocs(repeatCreditLogsRef)),
        referrals: snapshotDocs(await getDocs(referralsRef)),
        adminLogs: snapshotDocs(await getDocs(adminLogsRef)),
      };
      if (snapshot.exists() || !usersSnapshot.empty) {
        return mergeLocalPendingState(composeStateFromCloud(snapshot, usersSnapshot, seeded, records), localState, firebaseUser.uid);
      }
    }
    if (firebaseUser) {
      const userSnapshot = await getDoc(doc(db, USER_COLLECTION, firebaseUser.uid));
      const records = {
        orders: snapshotDocs(await getDocs(query(ordersRef, where("userId", "==", firebaseUser.uid)))),
        rewards: snapshotDocs(await getDocs(query(rewardsRef, where("userId", "==", firebaseUser.uid)))),
        withdraws: snapshotDocs(await getDocs(query(withdrawsRef, where("userId", "==", firebaseUser.uid)))),
        pointLogs: snapshotDocs(await getDocs(query(pointLogsRef, where("userId", "==", firebaseUser.uid)))),
        repeatCreditLogs: snapshotDocs(await getDocs(query(repeatCreditLogsRef, where("userId", "==", firebaseUser.uid)))),
        referrals: snapshotDocs(await getDocs(query(referralsRef, where("referrerId", "==", firebaseUser.uid)))),
      };
      return mergeLocalPendingState(composeStateFromUserDoc(snapshot, userSnapshot, seeded, records), localState, firebaseUser.uid);
    }
    if (snapshot.exists()) {
      return {
        ...seeded,
        plans: Array.isArray(snapshot.data().plans) ? snapshot.data().plans : seeded.plans,
        adminLogs: [],
      };
    }
    return seeded;
  } catch (error) {
    console.warn("Firestore unavailable, using local fallback.", error);
    return localState || createSeedData();
  }
}

async function saveState() {
  if (firebaseUser) {
    normalizePendingOrderIdsForOwner(firebaseUser.uid);
  }
  normalizeWithdrawSources();
  normalizePendingOrderTypes();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!firebaseUser) {
    syncMessage = "Firestore：未登录，暂存本地";
    return;
  }
  try {
    const cloudState = splitStateForCloud(state);
    if (isAdmin()) {
      await setDoc(systemRef, { plans: cloudState.plans, updatedAt: serverTimestamp() });
      await Promise.all(
        [
          ...cloudState.users.map((user) =>
            setDoc(doc(db, USER_COLLECTION, user.id), { ...user, updatedAt: serverTimestamp() }, { merge: true })
          ),
          ...cloudState.orders.map((order) =>
            setDoc(doc(db, ORDER_COLLECTION, order.id), { ...order, updatedAt: serverTimestamp() }, { merge: true })
          ),
          ...cloudState.rewards.map((reward) =>
            setDoc(doc(db, REWARD_COLLECTION, reward.id), { ...reward, updatedAt: serverTimestamp() }, { merge: true })
          ),
          ...cloudState.withdraws.map((withdraw) =>
            setDoc(doc(db, WITHDRAW_COLLECTION, withdraw.id), { ...withdraw, updatedAt: serverTimestamp() }, { merge: true })
          ),
          ...cloudState.pointLogs.map((log) =>
            setDoc(doc(db, POINT_LOG_COLLECTION, log.id), { ...log, updatedAt: serverTimestamp() }, { merge: true })
          ),
          ...cloudState.repeatCreditLogs.map((log) =>
            setDoc(doc(db, REPEAT_CREDIT_LOG_COLLECTION, log.id), { ...log, updatedAt: serverTimestamp() }, { merge: true })
          ),
          ...cloudState.invites.map((invite) =>
            setDoc(doc(db, INVITE_COLLECTION, invite.id), { ...invite, updatedAt: serverTimestamp() }, { merge: true })
          ),
          ...cloudState.referrals.map((referral) =>
            setDoc(doc(db, REFERRAL_COLLECTION, referral.id), { ...referral, updatedAt: serverTimestamp() }, { merge: true })
          ),
          ...(cloudState.adminLogs || []).map((log) =>
            setDoc(doc(db, ADMIN_LOG_COLLECTION, log.id), { ...log, updatedAt: serverTimestamp() }, { merge: true })
          ),
        ]
      );
    } else {
      const user = cloudState.users.find((item) => item.id === firebaseUser.uid);
      if (!user) throw new Error("current-user-document-not-found");
      const userRef = doc(db, USER_COLLECTION, firebaseUser.uid);
      const userExists = (await getDoc(userRef)).exists();
      await setDocWithSyncStep("用户资料", userRef, { ...userSelfProfileForCloud(user, !userExists), updatedAt: serverTimestamp() }, { merge: true });
      for (const order of cloudState.orders.filter((item) => item.userId === firebaseUser.uid && item.status === "pending")) {
        await setDocWithSyncStep(`充值订单 ${order.id}`, doc(db, ORDER_COLLECTION, order.id), { ...order, updatedAt: serverTimestamp() }, { merge: true });
      }
      for (const withdraw of cloudState.withdraws.filter((item) => item.userId === firebaseUser.uid && item.status === "pending")) {
        await setDocWithSyncStep(`提现申请 ${withdraw.id}`, doc(db, WITHDRAW_COLLECTION, withdraw.id), { ...withdraw, updatedAt: serverTimestamp() }, { merge: true });
      }
      const optionalWrites = [
        ...cloudState.invites.filter((invite) => invite.userId === firebaseUser.uid).map((invite) => ({
          label: "invite",
          ref: doc(db, INVITE_COLLECTION, invite.id),
          data: invite,
        })),
        ...cloudState.referrals.filter((referral) => referral.inviteeId === firebaseUser.uid).map((referral) => ({
          label: "referral",
          ref: doc(db, REFERRAL_COLLECTION, referral.id),
          data: referral,
        })),
      ];
      for (const item of optionalWrites) {
        try {
          await setDoc(item.ref, { ...item.data, updatedAt: serverTimestamp() }, { merge: true });
        } catch (error) {
          console.warn(`Optional Firestore ${item.label} sync failed.`, error);
        }
      }
    }
    cloudAvailable = true;
    syncMessage = `Firestore：保存成功 ${new Date().toLocaleTimeString("zh-CN")}`;
  } catch (error) {
    cloudAvailable = false;
    console.warn("Firestore save failed, fallback remains local.", error);
    syncMessage = `Firestore：保存失败${error.syncStep ? `（${error.syncStep}）` : ""} ${error.code || error.name || "unknown"} - ${error.message || ""}`;
    toast(`Firestore 保存失败：${error.code || "unknown"}`);
  }
}

async function setDocWithSyncStep(step, ref, data, options = { merge: true }) {
  try {
    await setDoc(ref, data, options);
  } catch (error) {
    error.syncStep = step;
    throw error;
  }
}

function firestoreErrorHint(error) {
  const code = error?.code || error?.name || "unknown";
  const message = error?.message || "";
  if (code === "permission-denied") {
    return "Firestore：保存失败 permission-denied。请先发布最新 firestore.rules，然后回到页面点“测试云端保存”。本次资料已暂存在本地。";
  }
  if (code === "storage/unauthorized") {
    return "Storage：付款证明上传权限不足。请检查 storage.rules 是否已发布；订单资料会先暂存在本地。";
  }
  if (code === "unavailable" || message.toLowerCase().includes("network")) {
    return "Firestore：网络暂时不可用。本次资料已暂存在本地，稍后点“测试云端保存”可重新同步。";
  }
  return `Firestore：保存失败 ${code} - ${message}`;
}

function snapshotDocs(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function mergeById(primary = [], fallback = []) {
  const seen = new Set(primary.map((item) => item.id));
  return [
    ...primary,
    ...fallback.filter((item) => item?.id && !seen.has(item.id)),
  ];
}

function mergeLocalPendingState(cloudState, localState, userId) {
  if (!cloudState || !localState || !userId) return cloudState;
  const localOwnerIds = new Set([userId]);
  const localUser = (localState.users || []).find((user) =>
    user.id === userId
    || user.firebaseUid === userId
    || (firebaseUser?.email && user.account === firebaseUser.email)
  );
  if (localUser?.id) localOwnerIds.add(localUser.id);
  const localPendingOrders = (localState.orders || [])
    .filter((order) => localOwnerIds.has(order.userId) && order.status === "pending")
    .map((order) => ({ ...order, userId }));
  const localPendingWithdraws = (localState.withdraws || [])
    .filter((withdraw) => localOwnerIds.has(withdraw.userId) && withdraw.status === "pending")
    .map((withdraw) => ({ ...withdraw, userId }));
  const hasUser = (cloudState.users || []).some((user) => user.id === userId);
  return {
    ...cloudState,
    currentUserId: userId,
    users: hasUser || !localUser ? cloudState.users : [...(cloudState.users || []), localUser],
    orders: mergeById(cloudState.orders || [], localPendingOrders),
    withdraws: mergeById(cloudState.withdraws || [], localPendingWithdraws),
  };
}

function composeStateFromCloud(systemSnapshot, usersSnapshot, fallback, records = {}) {
  if (systemSnapshot.exists() && systemSnapshot.data().state && usersSnapshot.empty) {
    return systemSnapshot.data().state;
  }
  const plans = systemSnapshot.exists() && Array.isArray(systemSnapshot.data().plans)
    ? systemSnapshot.data().plans
    : fallback.plans;
  const users = [];
  const orders = [...(records.orders || [])];
  const pointLogs = [...(records.pointLogs || [])];
  const repeatCreditLogs = [...(records.repeatCreditLogs || [])];
  const rewards = [...(records.rewards || [])];
  const withdraws = [...(records.withdraws || [])];
  const referrals = [...(records.referrals || [])];

  usersSnapshot.forEach((snapshot) => {
    const data = snapshot.data();
    users.push(normalizeUserDoc(snapshot.id, data));
    if (!records.orders?.length) orders.push(...(Array.isArray(data.orders) ? data.orders : []));
    if (!records.pointLogs?.length) pointLogs.push(...(Array.isArray(data.pointLogs) ? data.pointLogs : []));
    if (!records.repeatCreditLogs?.length) repeatCreditLogs.push(...(Array.isArray(data.repeatCreditLogs) ? data.repeatCreditLogs : []));
    if (!records.rewards?.length) rewards.push(...(Array.isArray(data.rewards) ? data.rewards : []));
    if (!records.withdraws?.length) withdraws.push(...(Array.isArray(data.withdraws) ? data.withdraws : []));
  });

  return {
    currentUserId: state?.currentUserId || firebaseUser?.uid || fallback.currentUserId,
    plans,
    users: users.length ? users : fallback.users,
    orders: orders.length ? orders : fallback.orders,
    pointLogs: pointLogs.length ? pointLogs : fallback.pointLogs,
    repeatCreditLogs: repeatCreditLogs.length ? repeatCreditLogs : (fallback.repeatCreditLogs || []),
    rewards: rewards.length ? rewards : fallback.rewards,
    withdraws: withdraws.length ? withdraws : fallback.withdraws,
    referrals: referrals.length ? referrals : fallback.referrals,
    adminLogs: records.adminLogs || [],
  };
}

function composeStateFromUserDoc(systemSnapshot, userSnapshot, fallback, records = {}) {
  const plans = systemSnapshot.exists() && Array.isArray(systemSnapshot.data().plans)
    ? systemSnapshot.data().plans
    : fallback.plans;

  if (!userSnapshot.exists()) {
    return {
      ...fallback,
      currentUserId: firebaseUser.uid,
      plans,
      users: [],
      orders: records.orders || [],
      pointLogs: records.pointLogs || [],
      repeatCreditLogs: records.repeatCreditLogs || [],
      rewards: records.rewards || [],
      withdraws: records.withdraws || [],
      referrals: records.referrals || [],
    };
  }

  const data = userSnapshot.data();
  const user = normalizeUserDoc(userSnapshot.id, data);
  return {
    currentUserId: user.id,
    plans,
    users: [user],
    orders: records.orders?.length ? records.orders : (Array.isArray(data.orders) ? data.orders : []),
    pointLogs: records.pointLogs?.length ? records.pointLogs : (Array.isArray(data.pointLogs) ? data.pointLogs : []),
    repeatCreditLogs: records.repeatCreditLogs?.length ? records.repeatCreditLogs : (Array.isArray(data.repeatCreditLogs) ? data.repeatCreditLogs : []),
    rewards: records.rewards?.length ? records.rewards : (Array.isArray(data.rewards) ? data.rewards : []),
    withdraws: records.withdraws?.length ? records.withdraws : (Array.isArray(data.withdraws) ? data.withdraws : []),
    referrals: records.referrals?.length ? records.referrals : (Array.isArray(data.referrals) ? data.referrals : []),
    adminLogs: [],
  };
}

function normalizeUserDoc(id, data) {
  return {
    id: data.id || id,
    firebaseUid: data.firebaseUid || id,
    name: data.name || "未命名用户",
    account: data.account || "",
    phone: data.phone || "",
    photoURL: data.photoURL || "",
    withdrawMethod: data.withdrawMethod || "",
    withdrawAccount: data.withdrawAccount || "",
    inviteCode: normalizeInviteCode(data.inviteCode || `${(data.name || "U").slice(0, 1).toUpperCase()}${id.slice(0, 4)}`),
    referrerId: data.referrerId || "",
    level: data.level || "普通用户",
    points: Number(data.points || 0),
    slots: Number(data.slots || 0),
    repeatCredits: Number(data.repeatCredits || 0),
    repeatCreditQueueAt: data.repeatCreditQueueAt || "",
    repeatCooldownUntil: data.repeatCooldownUntil || "",
    packageUntil: data.packageUntil || "",
    frozen: Boolean(data.frozen),
  };
}

function splitStateForCloud(data) {
  return {
    plans: data.plans,
    adminLogs: data.adminLogs || [],
    users: data.users.map(userProfileForCloud),
    orders: data.orders || [],
    rewards: data.rewards || [],
    withdraws: data.withdraws || [],
    pointLogs: data.pointLogs || [],
    repeatCreditLogs: data.repeatCreditLogs || [],
    invites: data.users.map(inviteDocForUser).filter((invite) => invite.id),
    referrals: referralDocsForState(data),
  };
}

function userProfileForCloud(user) {
  const { orders, rewards, withdraws, pointLogs, ...profile } = user;
  return profile;
}

function userSelfProfileForCloud(user, includeProtectedDefaults = false) {
  const profile = {
    id: user.id,
    firebaseUid: user.firebaseUid || user.id,
    name: user.name || "",
    account: user.account || "",
    phone: user.phone || "",
    photoURL: user.photoURL || "",
    withdrawMethod: user.withdrawMethod || "",
    withdrawAccount: user.withdrawAccount || "",
    inviteCode: normalizeInviteCode(user.inviteCode),
    referrerId: user.referrerId || "",
  };
  if (includeProtectedDefaults) {
    Object.assign(profile, {
      level: user.level || "普通用户",
      points: Number(user.points || 0),
      slots: Number(user.slots || 0),
      repeatCredits: Number(user.repeatCredits || 0),
      repeatCreditQueueAt: user.repeatCreditQueueAt || "",
      repeatCooldownUntil: user.repeatCooldownUntil || "",
      packageUntil: user.packageUntil || "",
      frozen: Boolean(user.frozen),
    });
  }
  return profile;
}

function normalizeInviteCode(code) {
  return String(code || "").trim().toUpperCase();
}

function inviteCodeFromInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, location.origin);
    const ref = parsed.searchParams.get("ref");
    if (ref) return normalizeInviteCode(ref);
  } catch (error) {
    // Plain invite codes are handled below.
  }
  const refMatch = raw.match(/[?&]ref=([^&#]+)/i);
  if (refMatch) return normalizeInviteCode(decodeURIComponent(refMatch[1]));
  return normalizeInviteCode(raw);
}

function currentUrlInviteCode() {
  return inviteCodeFromInput(new URLSearchParams(location.search).get("ref"));
}

function inviteDocForUser(user) {
  const code = normalizeInviteCode(user.inviteCode);
  return {
    id: code,
    code,
    userId: user.id,
    name: user.name || "",
    slots: Number(user.slots || 0),
    packageUntil: user.packageUntil || "",
    frozen: Boolean(user.frozen),
  };
}

function referralDocForUser(user, data = state) {
  const referrer = data.users.find((item) => item.id === user.referrerId);
  return {
    id: `${user.referrerId}_${user.id}`,
    referrerId: user.referrerId,
    referrerName: referrer?.name || "",
    inviteeId: user.id,
    inviteeName: user.name || "",
    inviteeAccount: user.account || "",
    createdAt: new Date().toISOString(),
  };
}

function referralDocsForState(data) {
  const existing = new Map((data.referrals || []).map((item) => [item.id, item]));
  data.users.filter((user) => user.referrerId).forEach((user) => {
    const next = referralDocForUser(user, data);
    existing.set(next.id, { ...next, ...(existing.get(next.id) || {}) });
  });
  return [...existing.values()];
}

function migrateUserId(oldId, newId) {
  if (!oldId || !newId || oldId === newId || !state) return;
  state.orders = (state.orders || []).map((order) => order.userId === oldId ? { ...order, userId: newId } : order);
  state.withdraws = (state.withdraws || []).map((withdraw) => withdraw.userId === oldId ? { ...withdraw, userId: newId } : withdraw);
  state.rewards = (state.rewards || []).map((reward) => reward.userId === oldId ? { ...reward, userId: newId } : reward);
  state.pointLogs = (state.pointLogs || []).map((log) => log.userId === oldId ? { ...log, userId: newId } : log);
  state.repeatCreditLogs = (state.repeatCreditLogs || []).map((log) => log.userId === oldId ? { ...log, userId: newId } : log);
  state.users.forEach((item) => {
    if (item.referrerId === oldId) item.referrerId = newId;
  });
  state.referrals = (state.referrals || []).map((referral) => ({
    ...referral,
    id: referral.id === `${referral.referrerId}_${referral.inviteeId}` ? undefined : referral.id,
    referrerId: referral.referrerId === oldId ? newId : referral.referrerId,
    inviteeId: referral.inviteeId === oldId ? newId : referral.inviteeId,
  })).map((referral) => ({
    ...referral,
    id: referral.id || `${referral.referrerId}_${referral.inviteeId}`,
  }));
  if (state.currentUserId === oldId) state.currentUserId = newId;
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
}

function orderNo(data = state, userId = "") {
  const ymd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const serial = `R${ymd}${String(data.orders.length + 1).padStart(4, "0")}`;
  if (!firebaseUser?.uid) return serial;
  const owner = String(userId || firebaseUser.uid).replace(/[^\w-]+/g, "").slice(0, 8);
  return `${serial}-${owner}-${Math.random().toString(16).slice(2, 6)}`;
}

function normalizePendingOrderIdsForOwner(userId) {
  if (!state || !userId) return;
  const owner = String(userId).replace(/[^\w-]+/g, "").slice(0, 8);
  state.orders = (state.orders || []).map((order) => {
    if (order.userId !== userId || order.status !== "pending" || !/^R\d{12}$/.test(order.id)) return order;
    return {
      ...order,
      id: `${order.id}-${owner}-${Math.random().toString(16).slice(2, 6)}`,
    };
  });
}

function normalizeWithdrawSources() {
  if (!state) return;
  state.withdraws = (state.withdraws || []).map((withdraw) => ({
    ...withdraw,
    source: withdraw.source || "reward",
  }));
}

function normalizePendingOrderTypes() {
  if (!state) return;
  state.orders = (state.orders || []).map((order) => {
    if (order.status !== "pending") return order;
    return {
      ...order,
      type: actualOrderType(state, order.userId, order.id),
    };
  });
}

function money(value) {
  return `RM${Number(value || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}`;
}

function points(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function addDays(iso, days) {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function addHours(iso, hours) {
  const date = new Date(iso);
  date.setHours(date.getHours() + Number(hours || 0));
  return date.toISOString();
}

function planRepeatCooldownHours(plan) {
  return Number(plan.repeatCooldownHours ?? 24);
}

function repeatCooldownRemaining(user) {
  if (!user.repeatCooldownUntil) return 0;
  return Math.max(new Date(user.repeatCooldownUntil).getTime() - Date.now(), 0);
}

function repeatCooldownText(user) {
  const remaining = repeatCooldownRemaining(user);
  if (!remaining) return "";
  const minutes = Math.ceil(remaining / 60000);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return hours ? `${hours}小时${restMinutes}分钟` : `${restMinutes}分钟`;
}

function findUser(userId) {
  return state.users.find((item) => item.id === userId);
}

function findPlan(planId) {
  return state.plans.find((item) => item.id === planId);
}

function currentUser() {
  return findUser(state.currentUserId) || state.users[0];
}

function isAdmin() {
  return Boolean(firebaseUser?.email && ADMIN_EMAILS.includes(firebaseUser.email));
}

function directReferralCount(userId, data = state) {
  const referralIds = new Set((data.referrals || [])
    .filter((referral) => referral.referrerId === userId)
    .map((referral) => referral.inviteeId));
  data.users
    .filter((user) => user.referrerId === userId)
    .forEach((user) => referralIds.add(user.id));
  return referralIds.size;
}

function isActivePackage(user) {
  return Boolean(user.packageUntil) && new Date(user.packageUntil) > new Date() && !user.frozen;
}

function packageStatus(user) {
  if (user.frozen) return ["frozen", "已冻结"];
  if (isActivePackage(user)) return ["active", `有效至 ${new Date(user.packageUntil).toLocaleDateString("zh-CN")}`];
  return ["expired", "未开通/已过期"];
}

function confirmedAvailable(userId) {
  return withdrawBreakdown(userId).available;
}

function withdrawBreakdown(userId) {
  const totals = {
    first: 0,
    repeatReleased: 0,
    pendingRelease: 0,
    requested: 0,
    available: 0,
  };
  state.rewards
    .filter((reward) => reward.userId === userId && ["confirmed", "releasing"].includes(reward.status))
    .forEach((reward) => {
      if (reward.type === "first") {
        totals.first += Number(reward.amount || 0);
        return;
      }
      if (Array.isArray(reward.releasePlan)) {
        totals.repeatReleased += Number(reward.releasedAmount || 0);
        totals.pendingRelease += Math.max(Number(reward.amount || 0) - Number(reward.releasedAmount || 0), 0);
        return;
      }
      totals.repeatReleased += Number(reward.amount || 0);
    });
  totals.requested = state.withdraws
    .filter((item) => item.userId === userId && item.status !== "rejected")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  totals.available = Math.max(totals.first + totals.repeatReleased - totals.requested, 0);
  return totals;
}

function withdrawEligibility(user) {
  const available = withdrawBreakdown(user.id).available;
  const reasons = [];
  if (user.frozen) reasons.push("账户已冻结");
  if (!isActivePackage(user)) reasons.push("需要有效配套");
  if (available < MIN_WITHDRAW_AMOUNT) reasons.push(`可提现余额需满 ${money(MIN_WITHDRAW_AMOUNT)}`);
  const cooldown = withdrawCooldownRemaining(user.id);
  if (cooldown > 0) reasons.push(`提现冷却中，还需 ${durationText(cooldown)}`);
  return {
    available,
    eligible: reasons.length === 0,
    reasons,
  };
}

function withdrawRuleText(available) {
  return `规则：充值积分不可提现；只有已确认/已释放的首充推荐奖励和复购奖励可提现。提现申请冷却 ${WITHDRAW_COOLDOWN_HOURS} 小时。当前可提现奖励 ${money(available)}。`;
}

function durationText(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours ? `${hours} 小时` : ""}${minutes ? ` ${minutes} 分钟` : ""}`.trim() || "少于 1 分钟";
}

function withdrawCooldownRemaining(userId) {
  const latest = (state.withdraws || [])
    .filter((withdraw) => withdraw.userId === userId && withdraw.status !== "rejected")
    .map((withdraw) => new Date(withdraw.createdAt).getTime())
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  if (!latest) return 0;
  return Math.max(latest + WITHDRAW_COOLDOWN_HOURS * 60 * 60 * 1000 - Date.now(), 0);
}

function duplicatePaymentRef(ref, userId = "") {
  const normalized = String(ref || "").trim().toLowerCase();
  if (!normalized) return null;
  return (state.orders || []).find((order) =>
    order.status !== "cancelled"
    && String(order.paymentRef || "").trim().toLowerCase() === normalized
    && (!userId || order.userId === userId)
  );
}

function duplicateProofName(fileName, userId = "") {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (!normalized) return null;
  return (state.orders || []).find((order) =>
    order.status !== "cancelled"
    && String(order.proofName || "").trim().toLowerCase() === normalized
    && (!userId || order.userId === userId)
  );
}

function duplicateOrderRisks(data = state) {
  const risks = [];
  const seenRefs = new Map();
  const seenProofs = new Map();
  (data.orders || [])
    .filter((order) => order.status !== "cancelled")
    .forEach((order) => {
      const refKey = `${order.userId}:${String(order.paymentRef || "").trim().toLowerCase()}`;
      if (order.paymentRef && seenRefs.has(refKey)) {
        risks.push(`重复付款参考号：${order.paymentRef}（${seenRefs.get(refKey)} / ${order.id}）`);
      } else if (order.paymentRef) {
        seenRefs.set(refKey, order.id);
      }

      const proofKey = `${order.userId}:${String(order.proofName || "").trim().toLowerCase()}`;
      if (order.proofName && seenProofs.has(proofKey)) {
        risks.push(`重复付款凭证文件名：${order.proofName}（${seenProofs.get(proofKey)} / ${order.id}）`);
      } else if (order.proofName) {
        seenProofs.set(proofKey, order.id);
      }
    });
  return risks;
}

function dataIntegrityIssues(data = state) {
  const issues = [];
  const users = data.users || [];
  const orders = data.orders || [];
  const rewards = data.rewards || [];
  const withdraws = data.withdraws || [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const inviteCodes = new Map();
  issues.push(...duplicateOrderRisks(data));

  users.forEach((user) => {
    const code = normalizeInviteCode(user.inviteCode);
    if (!code) issues.push(`用户 ${user.name || user.id} 缺少推荐码`);
    if (code && inviteCodes.has(code)) issues.push(`推荐码重复：${code}`);
    if (code) inviteCodes.set(code, user.id);
    if (user.referrerId) {
      if (user.referrerId === user.id) issues.push(`用户 ${user.name || user.id} 绑定了自己为推荐人`);
      if (!usersById.has(user.referrerId)) issues.push(`用户 ${user.name || user.id} 的推荐人不存在`);
    }
  });

  orders.forEach((order) => {
    if (!usersById.has(order.userId)) issues.push(`订单 ${order.id} 的用户不存在`);
    if (!(data.plans || []).some((plan) => plan.id === order.planId) && order.status !== "cancelled") issues.push(`订单 ${order.id} 的配套不存在或已删除`);
    if (order.status === "paid" && Number(order.points || 0) <= 0) issues.push(`已付款订单 ${order.id} 积分为 0`);
  });

  rewards.forEach((reward) => {
    if (!usersById.has(reward.userId)) issues.push(`奖励 ${reward.id || reward.orderId} 的收款用户不存在`);
    if (!ordersById.has(reward.orderId)) issues.push(`奖励 ${reward.id || reward.orderId} 对应订单不存在`);
    if (reward.type === "repeat" && Array.isArray(reward.releasePlan)) {
      const released = reward.releasePlan.reduce((sum, part) => sum + (part.released ? Number(part.amount || 0) : 0), 0);
      if (Number(reward.releasedAmount || 0) !== released) issues.push(`复购奖励 ${reward.id || reward.orderId} 已释放金额与分期不一致`);
    }
  });

  withdraws.forEach((withdraw) => {
    if (!usersById.has(withdraw.userId)) issues.push(`提现 ${withdraw.id} 的用户不存在`);
    if (withdraw.source !== "reward") issues.push(`提现 ${withdraw.id} 不是奖励提现来源`);
  });

  users.forEach((user) => {
    const breakdown = withdrawBreakdown(user.id);
    const earned = Number(breakdown.first || 0) + Number(breakdown.repeatReleased || 0);
    if (breakdown.requested > earned) issues.push(`用户 ${user.name || user.id} 提现金额超过已释放奖励`);
  });

  return issues;
}

function hasPaidOrder(data, userId, excludeOrderId = "") {
  return (data.orders || []).some((order) =>
    order.userId === userId
    && order.status === "paid"
    && order.id !== excludeOrderId
  );
}

function actualOrderType(data, userId, excludeOrderId = "") {
  return hasPaidOrder(data, userId, excludeOrderId) ? "repeat" : "first";
}

function createOrder(data, userId, planId, type, status = "paid", createdAt = new Date().toISOString(), paymentInfo = {}) {
  const user = data.users.find((item) => item.id === userId);
  const plan = data.plans.find((item) => item.id === planId);
  if (!user || !plan) return null;
  const orderType = type || actualOrderType(data, userId);
  const order = {
    id: orderNo(data, userId),
    userId,
    planId,
    type: orderType,
    status,
    amount: plan.amount,
    points: 0,
    paymentMethod: paymentInfo.method || "",
    paymentRef: paymentInfo.ref || "",
    paymentNote: paymentInfo.note || "",
    proofName: paymentInfo.proofName || "",
    proofPath: paymentInfo.proofPath || "",
    proofUrl: paymentInfo.proofUrl || "",
    proofInlineData: paymentInfo.proofInlineData || "",
    proofInlineType: paymentInfo.proofInlineType || "",
    proofStatus: paymentInfo.proofStatus || "none",
    proofError: paymentInfo.proofError || "",
    createdAt,
  };
  data.orders.push(order);
  if (status === "paid") {
    applyPaidOrder(data, order, createdAt);
  }
  return order;
}

function applyPaidOrder(data, order, paidAt = new Date().toISOString()) {
  const user = data.users.find((item) => item.id === order.userId);
  const plan = data.plans.find((item) => item.id === order.planId);
  if (!user || !plan || order.points > 0) return;
  order.type = actualOrderType(data, order.userId, order.id);
  order.status = "paid";
  order.points = plan.points;
  order.paidAt = paidAt;
  user.points += plan.points;
  user.slots = Math.max(user.slots || 0, plan.slots);
  user.packageUntil = addDays(paidAt, plan.validDays);
  user.level = plan.amount >= 580 ? "高级推广用户" : "推广用户";
  data.pointLogs.push({ id: id("log"), userId: user.id, change: plan.points, balance: user.points, source: order.id, note: `${plan.name} 积分发放`, createdAt: paidAt });
  if (order.type === "repeat") {
    user.repeatCooldownUntil = addHours(paidAt, planRepeatCooldownHours(plan));
    grantRepeatCredits(data, user, plan, paidAt);
    createRepeatPoolReward(data, order, user, plan, paidAt);
  } else {
    createFirstReward(data, order, user, plan, paidAt);
  }
}

function planRepeatCredits(plan) {
  return Number(plan.repeatCredits ?? 10);
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

function releaseDueRewardParts(reward, now = new Date()) {
  if (!Array.isArray(reward.releasePlan) || !reward.releasePlan.length) return false;
  let changed = false;
  reward.releasePlan.forEach((part) => {
    if (!part.released && new Date(part.releaseAt) <= now) {
      part.released = true;
      part.releasedAt = now.toISOString();
      changed = true;
    }
  });
  if (!changed) return false;
  reward.releasedAmount = reward.releasePlan
    .filter((part) => part.released)
    .reduce((sum, part) => sum + Number(part.amount || 0), 0);
  const fullyReleased = reward.releasePlan.every((part) => part.released);
  reward.status = fullyReleased ? "confirmed" : "releasing";
  reward.confirmAfter = fullyReleased
    ? reward.releasePlan[reward.releasePlan.length - 1].releaseAt
    : reward.releasePlan.find((part) => !part.released)?.releaseAt || reward.confirmAfter;
  return true;
}

function grantRepeatCredits(data, user, plan, paidAt) {
  const credits = planRepeatCredits(plan);
  if (credits <= 0) return;
  const currentCredits = Number(user.repeatCredits || 0);
  user.repeatCredits = currentCredits + credits;
  if (!user.repeatCreditQueueAt || currentCredits <= 0) {
    user.repeatCreditQueueAt = paidAt;
  }
  addRepeatCreditLog(data, user.id, credits, user.repeatCredits, "earned", "", `${plan.name} repeat purchase`, paidAt);
}

function createFirstReward(data, order, buyer, plan, paidAt = order.createdAt) {
  if (!buyer.referrerId) return;
  const referrer = data.users.find((item) => item.id === buyer.referrerId);
  if (!referrer || referrer.frozen) return;
  if (directReferralCount(referrer.id, data) > (referrer.slots || 0)) return;
  const rate = Number(plan.firstRate || 0);
  if (rate <= 0) return;
  data.rewards.push({
    id: id("rew"),
    userId: referrer.id,
    sourceUserId: buyer.id,
    orderId: order.id,
    type: "first",
    rate,
    amount: +(order.amount * (rate / 100)).toFixed(2),
    status: "pending",
    confirmAfter: addDays(paidAt, CONFIRM_DAYS),
    createdAt: paidAt,
  });
}

function createRepeatPoolReward(data, order, buyer, plan, paidAt = order.createdAt) {
  const receiver = nextRepeatReceiver(data, buyer.id);
  const rate = Number(plan.repeatRate || 0);
  if (!receiver || rate <= 0) return;
  receiver.repeatCredits = Math.max(Number(receiver.repeatCredits || 0) - 1, 0);
  if (receiver.repeatCredits <= 0) receiver.repeatCreditQueueAt = "";
  addRepeatCreditLog(data, receiver.id, -1, receiver.repeatCredits, "used", order.id, `Repeat pool reward from ${buyer.name || buyer.account}`, paidAt);
  data.rewards.push({
    id: id("rew"),
    userId: receiver.id,
    sourceUserId: buyer.id,
    orderId: order.id,
    type: "repeat",
    rewardMode: "pool",
    rate,
    amount: +(order.amount * (rate / 100)).toFixed(2),
    status: "pending",
    releasedAmount: 0,
    releasePlan: createReleasePlan(+(order.amount * (rate / 100)).toFixed(2), paidAt),
    confirmAfter: addDays(paidAt, CONFIRM_DAYS),
    createdAt: paidAt,
  });
}

function nextRepeatReceiver(data, buyerId) {
  return data.users
    .filter((user) => user.id !== buyerId && !user.frozen && Number(user.repeatCredits || 0) > 0)
    .sort((a, b) => new Date(a.repeatCreditQueueAt || "9999-12-31") - new Date(b.repeatCreditQueueAt || "9999-12-31"))[0];
}

function canRecalculateOrderRewards(order) {
  const rewards = (state.rewards || []).filter((reward) => reward.orderId === order.id);
  return rewards.every((reward) => reward.status === "pending");
}

function reverseRepeatCreditLogsForOrder(data, orderId) {
  const logs = (data.repeatCreditLogs || []).filter((log) => log.source === orderId);
  logs.forEach((log) => {
    const user = data.users.find((item) => item.id === log.userId);
    if (!user) return;
    user.repeatCredits = Math.max(Number(user.repeatCredits || 0) - Number(log.change || 0), 0);
    if (user.repeatCredits <= 0) user.repeatCreditQueueAt = "";
  });
  data.repeatCreditLogs = (data.repeatCreditLogs || []).filter((log) => log.source !== orderId);
  return logs.length;
}

function recalculateOrderRewards(data, order) {
  if (!order || order.status !== "paid") return { ok: false, message: "只有已支付订单可以重算奖励" };
  if (!canRecalculateOrderRewards(order)) return { ok: false, message: "已有非待确认奖励，不能自动重算" };
  const buyer = data.users.find((item) => item.id === order.userId);
  const plan = data.plans.find((item) => item.id === order.planId);
  if (!buyer || !plan) return { ok: false, message: "订单用户或配套不存在" };

  const removedRewards = (data.rewards || []).filter((reward) => reward.orderId === order.id).length;
  data.rewards = (data.rewards || []).filter((reward) => reward.orderId !== order.id);
  const reversedLogs = reverseRepeatCreditLogsForOrder(data, order.id);
  order.type = actualOrderType(data, order.userId, order.id);
  const paidAt = order.paidAt || order.createdAt || new Date().toISOString();
  if (order.type === "repeat") {
    grantRepeatCredits(data, buyer, plan, paidAt);
    createRepeatPoolReward(data, order, buyer, plan, paidAt);
  } else {
    createFirstReward(data, order, buyer, plan, paidAt);
  }
  return {
    ok: true,
    message: `已重算为${order.type === "first" ? "首充" : "复购"}，移除 ${removedRewards} 笔旧奖励、${reversedLogs} 条复购资格流水`,
  };
}

function orderConfirmPreview(order) {
  const user = findUser(order.userId);
  const plan = findPlan(order.planId);
  if (!user || !plan) return "订单资料不完整，仍要继续确认吗？";
  const previewType = actualOrderType(state, order.userId, order.id);
  const lines = [
    `确认订单：${order.id}`,
    `用户：${user.name} / ${user.account}`,
    `配套：${plan.name}，金额 ${money(order.amount)}`,
    `处理类型：${previewType === "first" ? "首充" : "复购"}`,
    `积分：+${points(plan.points)}`,
  ];
  if (previewType === "repeat") {
    const receiver = nextRepeatReceiver(state, user.id);
    const reward = +(order.amount * (Number(plan.repeatRate || 0) / 100)).toFixed(2);
    lines.push(`复购资格：买家 +${planRepeatCredits(plan)} 个`);
    lines.push(`复购冷却：${planRepeatCooldownHours(plan)} 小时`);
    lines.push(receiver
      ? `资格池接收人：${receiver.name} / 当前资格 ${receiver.repeatCredits} 个，将扣 1 个，奖励 ${money(reward)} 分 ${REPEAT_RELEASE_DAYS.length} 期释放`
      : "资格池接收人：暂无，当前复购只给买家增加资格，不产生资格池奖励");
  } else {
    const referrer = findUser(user.referrerId);
    const reward = +(order.amount * (Number(plan.firstRate || 0) / 100)).toFixed(2);
    lines.push(referrer ? `首充奖励：${referrer.name} 预计获得 ${money(reward)}` : "首充奖励：没有绑定推荐人");
  }
  lines.push("确定要确认付款吗？");
  return lines.join("\n");
}

function orderDetailText(order) {
  const user = findUser(order.userId);
  const plan = findPlan(order.planId);
  if (!order || !user || !plan) return "订单资料不完整";
  const resolvedType = order.status === "pending" ? actualOrderType(state, order.userId, order.id) : order.type;
  const rewards = (state.rewards || []).filter((reward) => reward.orderId === order.id);
  const rewardLines = rewards.length
    ? rewards.map((reward) => {
      const owner = findUser(reward.userId);
      return `- ${rewardTypeText(reward)}：${owner?.name || reward.userId} / ${rewardAmountText(reward)} / ${labelStatus(reward.status)} / 备注：${reward.reviewNote || "-"}`;
    })
    : ["- 暂无奖励记录"];
  const receiver = resolvedType === "repeat" ? nextRepeatReceiver(state, order.userId) : null;
  return [
    `订单：${order.id}`,
    `用户：${user.name} / ${user.account}`,
    `配套：${plan.name}`,
    `金额：${money(order.amount)}`,
    `状态：${labelStatus(order.status)}`,
    `当前判定：${resolvedType === "first" ? "首充" : "复购"}`,
    `付款：${paymentMethodText(order.paymentMethod)} / ${order.paymentRef || "-"}`,
    `凭证：${proofStatusText(order)}`,
    `处理备注：${order.reviewNote || "-"}`,
    `积分：${points(order.points || 0)} / 确认后应发 ${points(plan.points)}`,
    `确认时间：${order.reviewedAt ? new Date(order.reviewedAt).toLocaleString("zh-CN") : "-"}`,
    `取消时间：${order.cancelledAt ? new Date(order.cancelledAt).toLocaleString("zh-CN") : "-"}`,
    resolvedType === "first"
      ? `首充奖励对象：${user.referrerId ? (findUser(user.referrerId)?.name || user.referrerId) : "无推荐人"}`
      : `资格池接收人：${receiver ? `${receiver.name}（资格 ${receiver.repeatCredits}）` : "暂无"}`,
    "现有奖励记录：",
    ...rewardLines,
  ].join("\n");
}

function withdrawDetailText(withdraw) {
  const user = findUser(withdraw.userId);
  if (!withdraw || !user) return "提现资料不完整";
  const breakdown = withdrawBreakdown(user.id);
  return [
    `提现申请：${withdraw.id}`,
    `用户：${user.name} / ${user.account}`,
    `申请金额：${money(withdraw.amount)}`,
    `来源：${withdraw.source === "reward" ? "奖励提现" : withdraw.source || "-"}`,
    `状态：${labelStatus(withdraw.status)}`,
    `收款方式：${withdraw.method || "-"}`,
    `收款账号：${withdraw.account || "-"}`,
    `审核备注：${withdraw.reviewNote || "-"}`,
    `提交时间：${new Date(withdraw.createdAt).toLocaleString("zh-CN")}`,
    `审核时间：${withdraw.reviewedAt ? new Date(withdraw.reviewedAt).toLocaleString("zh-CN") : "-"}`,
    `打款时间：${withdraw.paidAt ? new Date(withdraw.paidAt).toLocaleString("zh-CN") : "-"}`,
    "",
    "当前奖励提现组成：",
    `首充奖励可提现：${money(breakdown.first)}`,
    `复购奖励已释放：${money(breakdown.repeatReleased)}`,
    `复购奖励待释放：${money(breakdown.pendingRelease)}`,
    `已申请/处理中：${money(breakdown.requested)}`,
    `当前可提现余额：${money(breakdown.available)}`,
  ].join("\n");
}

function userDetailText(user) {
  if (!user) return "找不到用户";
  const referrer = findUser(user.referrerId);
  const [statusClass, statusLabel] = packageStatus(user);
  const orders = state.orders.filter((order) => order.userId === user.id);
  const paidOrders = orders.filter((order) => order.status === "paid");
  const rewards = state.rewards.filter((reward) => reward.userId === user.id);
  const withdraws = state.withdraws.filter((withdraw) => withdraw.userId === user.id);
  const referrals = directReferralCount(user.id);
  const breakdown = withdrawBreakdown(user.id);
  return [
    `用户：${user.name}`,
    `账号：${user.account}`,
    `手机：${user.phone || "-"}`,
    `邀请码：${user.inviteCode}`,
    `推荐人：${referrer ? `${referrer.name} / ${referrer.inviteCode}` : "无"}`,
    `配套状态：${statusLabel}`,
    `账号状态：${user.frozen ? "已冻结" : "正常"}`,
    "",
    "余额与资格：",
    `充值积分：${points(user.points)}`,
    `可提现奖励：${money(breakdown.available)}`,
    `复购资格：${points(user.repeatCredits || 0)}`,
    `推荐名额：${referrals} / ${user.slots || 0}`,
    "",
    "业务统计：",
    `订单：${orders.length} 笔，其中已支付 ${paidOrders.length} 笔，累计 ${money(paidOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0))}`,
    `奖励：${rewards.length} 笔`,
    `提现：${withdraws.length} 笔`,
    "",
    "提现组成：",
    `首充奖励可提现：${money(breakdown.first)}`,
    `复购奖励已释放：${money(breakdown.repeatReleased)}`,
    `复购奖励待释放：${money(breakdown.pendingRelease)}`,
    `已申请/处理中：${money(breakdown.requested)}`,
  ].join("\n");
}

function labelStatus(status) {
  if (status === "releasing") return "分期释放中";
  return {
    paid: "已支付",
    pending: "待处理",
    refunded: "已退款",
    confirmed: "已确认",
    cancelled: "已取消",
    frozen: "已冻结",
    approved: "已通过",
    rejected: "已拒绝",
    paidout: "已打款",
  }[status] || status;
}

function rewardTypeText(reward) {
  if (reward.type === "first") return "首充奖励";
  if (reward.rewardMode === "pool") return "复购资格奖励";
  return "复购奖励";
}

function rewardAmountText(reward) {
  if (Array.isArray(reward.releasePlan)) {
    const releasedParts = reward.releasePlan.filter((part) => part.released).length;
    return `${money(reward.releasedAmount || 0)} / ${money(reward.amount)} (${releasedParts}/${reward.releasePlan.length})`;
  }
  return money(reward.amount);
}

function rewardNextDateText(reward) {
  if (Array.isArray(reward.releasePlan)) {
    const next = reward.releasePlan.find((part) => !part.released);
    return next ? new Date(next.releaseAt).toLocaleDateString("zh-CN") : new Date(reward.confirmAfter).toLocaleDateString("zh-CN");
  }
  return new Date(reward.confirmAfter).toLocaleDateString("zh-CN");
}

function proofStatusText(order) {
  if (order.proofUrl) return "凭证已上传";
  if (order.proofInlineData) return "凭证已暂存订单内";
  if (order.proofStatus === "uploaded") return "凭证已上传";
  if (order.proofStatus === "failed") return `凭证上传失败${order.proofError ? `：${order.proofError}` : ""}`;
  if (order.proofName) return `凭证待补传：${order.proofName}`;
  return "未上传凭证";
}

function paymentMethodText(method) {
  return {
    bank: "银行转账",
    tng: "Touch n Go",
    usdt: "USDT",
    cash: "现金",
  }[method] || method || "";
}

async function uploadPaymentProof(file, orderId) {
  if (!file) return {};
  const maxSize = 5 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error("付款证明不能超过 5MB");
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `paymentProofs/${firebaseUser.uid}/${orderId}-${Date.now()}-${safeName}`;
  const proofRef = storageRef(storage, path);
  await uploadBytes(proofRef, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(proofRef);
  return { proofName: file.name, proofPath: path, proofUrl: url, proofStatus: "uploaded", proofError: "" };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read file failed"));
    reader.readAsDataURL(file);
  });
}

async function inlinePaymentProof(file, sourceError = null) {
  if (!file) return {};
  if (file.size > INLINE_PROOF_MAX_BYTES) {
    throw sourceError || new Error("付款证明上传失败，且文件超过本地内嵌上限 750KB，请先压缩后补传");
  }
  const dataUrl = await fileToDataUrl(file);
  return {
    proofName: file.name,
    proofPath: "",
    proofUrl: "",
    proofInlineData: dataUrl,
    proofInlineType: file.type || "application/octet-stream",
    proofStatus: "uploaded",
    proofError: "Storage 超时，已暂存订单内",
  };
}

async function uploadPaymentProofForOrder(file, orderId) {
  if (!file) return {};
  try {
    return await withTimeout(
      uploadPaymentProof(file, orderId),
      PROOF_STORAGE_ATTEMPT_MS,
      "Storage 上传超时，已改用订单内暂存"
    );
  } catch (error) {
    console.warn("Storage proof upload failed, using inline proof fallback.", error);
    return inlinePaymentProof(file, error);
  }
}

async function callConfirmOrderFunction(orderId) {
  const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js");
  const functions = getFunctions(app);
  const confirmOrderFunction = httpsCallable(functions, "confirmOrder");
  return confirmOrderFunction({ orderId });
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function uploadErrorMessage(error) {
  const code = error?.code || "";
  const message = error?.message || "upload failed";
  if (code === "storage/unauthorized") return "付款证明上传权限不足，请发布 storage.rules";
  if (message.includes("超时")) return message;
  return message;
}

function toast(message) {
  const toastEl = document.querySelector("#toast");
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function upsertFirebaseUser(userCredential) {
  const googleUser = userCredential;
  const account = googleUser.email || googleUser.uid;
  let user = state.users.find((item) => item.firebaseUid === googleUser.uid || item.account === account);
  if (!user) {
    user = {
      id: googleUser.uid,
      firebaseUid: googleUser.uid,
      name: googleUser.displayName || account,
      account,
      phone: "",
      photoURL: googleUser.photoURL || "",
      withdrawMethod: "",
      withdrawAccount: "",
      inviteCode: normalizeInviteCode(`${(googleUser.displayName || "G").slice(0, 1).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`),
      referrerId: "",
      level: "普通用户",
      points: 0,
      slots: 0,
      repeatCredits: 0,
      repeatCreditQueueAt: "",
      repeatCooldownUntil: "",
      packageUntil: "",
      frozen: false,
    };
    state.users.push(user);
  } else {
    const oldId = user.id;
    if (oldId !== googleUser.uid) {
      migrateUserId(oldId, googleUser.uid);
      user.id = googleUser.uid;
    }
    user.firebaseUid = googleUser.uid;
    user.name = googleUser.displayName || user.name;
    user.account = account;
    user.phone = user.phone || "";
    user.photoURL = googleUser.photoURL || user.photoURL || "";
    user.withdrawMethod = user.withdrawMethod || "";
    user.withdrawAccount = user.withdrawAccount || "";
    user.inviteCode = normalizeInviteCode(user.inviteCode);
  }
  state.users = state.users.filter((item, index, users) =>
    index === users.findIndex((other) =>
      other.id === item.id
      || (item.account && other.account === item.account)
      || (item.firebaseUid && other.firebaseUid === item.firebaseUid)
    )
  );
  state.currentUserId = user.id;
}

function updateAuthStatus() {
  const status = document.querySelector("#authStatus");
  if (!status) return;
  if (firebaseUser) {
    status.textContent = `已登录：${firebaseUser.email || firebaseUser.displayName}`;
  } else if (firebaseReady) {
    status.textContent = "请使用 Google 登录。";
  } else {
    status.textContent = "正在连接 Firebase...";
  }
  const syncStatus = document.querySelector("#syncStatus");
  if (syncStatus) syncStatus.textContent = readableSyncMessage(syncMessage);
}

function renderMember() {
  const user = currentUser();
  const [statusClass, statusLabel] = packageStatus(user);
  const used = directReferralCount(user.id);
  const inviteLink = `${location.origin}${location.pathname}?ref=${user.inviteCode}`;
  document.querySelector("#memberName").textContent = `${user.name}（${user.inviteCode}）`;
  document.querySelector("#memberPoints").textContent = points(user.points);
  document.querySelector("#memberConfirmed").textContent = money(confirmedAvailable(user.id));
  document.querySelector("#memberPoints").closest("span").title = "充值积分不可提现";
  document.querySelector("#memberConfirmed").closest("span").title = "首充推荐奖励和复购奖励可提现";
  document.querySelector("#memberSlots").textContent = `${Math.max((user.slots || 0) - used, 0)} / ${user.slots || 0}`;
  document.querySelector("#memberRepeatCredits").textContent = points(user.repeatCredits || 0);
  document.querySelector("#memberPlanStatus").textContent = statusLabel;
  document.querySelector("#memberPlanStatus").className = `tag ${statusClass}`;
  document.querySelector("#inviteLink").textContent = inviteLink;
  renderInviteCodeBox(user);
  const refInput = document.querySelector("#registerForm [name='inviteCode']");
  const refButton = document.querySelector("#registerForm button[type='submit']");
  const urlRef = currentUrlInviteCode();
  if (refInput && urlRef && !refInput.value && urlRef !== user.inviteCode) refInput.value = urlRef;
  if (refInput && user.referrerId) {
    const referrer = findUser(user.referrerId);
    refInput.value = referrer ? `已绑定：${referrer.name}` : "已绑定推荐人";
    refInput.disabled = true;
    if (refButton) refButton.disabled = true;
  } else if (refInput) {
    refInput.disabled = false;
    if (refButton) refButton.disabled = false;
  }
  renderLocalSyncHint(user);
  renderMemberProfile(user);
  ensureStorageTestButton();
  renderMemberPlans(user);
  renderMemberOrders(user);
  renderMemberOrderProofStatuses(user);
  renderMemberReferrals(user);
  renderRewardRules();
  renderMemberRewards(user);
  renderMemberRepeatCreditLogs(user);
  renderMemberWithdraws(user);
}

function renderMemberProfile(user) {
  const form = document.querySelector("#profileForm");
  if (!form) return;
  form.querySelector("[name='name']").value = user.name || "";
  form.querySelector("[name='phone']").value = user.phone || "";
  form.querySelector("[name='withdrawMethod']").value = user.withdrawMethod || "";
  form.querySelector("[name='withdrawAccount']").value = user.withdrawAccount || "";

  const withdrawForm = document.querySelector("#withdrawForm");
  if (!withdrawForm) return;
  const methodInput = withdrawForm.querySelector("[name='method']");
  const accountInput = withdrawForm.querySelector("[name='account']");
  if (methodInput && !methodInput.value) methodInput.value = user.withdrawMethod || "";
  if (accountInput && !accountInput.value) accountInput.value = user.withdrawAccount || "";
  const eligibility = withdrawEligibility(user);
  const eligibilityText = document.querySelector("#withdrawEligibilityText");
  if (eligibilityText) {
    eligibilityText.textContent = eligibility.eligible
      ? `提现条件已满足。${withdrawRuleText(eligibility.available)}`
      : `提现条件未满足：${eligibility.reasons.join("、")}。${withdrawRuleText(eligibility.available)}`;
  }
  const submitButton = withdrawForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = !eligibility.eligible;
  renderWithdrawBreakdown(user);
}

function renderInviteCodeBox(user) {
  const inviteLinkBox = document.querySelector("#inviteLink");
  if (!inviteLinkBox?.parentNode) return;
  let codeBox = document.querySelector("#inviteCodeBox");
  if (!codeBox) {
    codeBox = document.createElement("div");
    codeBox.id = "inviteCodeBox";
    codeBox.className = "referral-code-box";
    inviteLinkBox.insertAdjacentElement("beforebegin", codeBox);
  }
  codeBox.innerHTML = `
    <span>我的推荐码</span>
    <strong>${user.inviteCode}</strong>
    <small>朋友也可以直接输入这个推荐码绑定。</small>
    <button class="button ghost compact-button" type="button" data-copy-invite-code="${user.inviteCode}">复制推荐码</button>
  `;
}

function ensureWithdrawBreakdownBox() {
  let box = document.querySelector("#withdrawBreakdownBox");
  if (box) return box;
  const withdrawForm = document.querySelector("#withdrawForm");
  if (!withdrawForm?.parentNode) return null;
  box = document.createElement("div");
  box.id = "withdrawBreakdownBox";
  box.className = "breakdown-box";
  withdrawForm.insertAdjacentElement("beforebegin", box);
  return box;
}

function renderWithdrawBreakdown(user) {
  const box = ensureWithdrawBreakdownBox();
  if (!box) return;
  const breakdown = withdrawBreakdown(user.id);
  box.innerHTML = `
    <span>首充奖励可提现 <strong>${money(breakdown.first)}</strong></span>
    <span>复购奖励已释放 <strong>${money(breakdown.repeatReleased)}</strong></span>
    <span>复购奖励待释放 <strong>${money(breakdown.pendingRelease)}</strong></span>
    <span>已申请/处理中 <strong>${money(breakdown.requested)}</strong></span>
  `;
}

function ensureStorageTestButton() {
  if (document.querySelector("#testStorageBtn")) return;
  const proofInput = document.querySelector("#paymentInfoForm [name='paymentProof']");
  const proofField = proofInput?.closest("label");
  if (!proofField) return;
  const button = document.createElement("button");
  button.id = "testStorageBtn";
  button.className = "button ghost";
  button.type = "button";
  button.textContent = "测试凭证上传";
  proofField.insertAdjacentElement("afterend", button);
}

function renderMemberPlans(user) {
  const nextType = actualOrderType(state, user.id);
  document.querySelector("#memberPlanCards").innerHTML = state.plans.map((plan) => `
    <article class="plan-card">
      <strong>${plan.name} · ${money(plan.amount)}</strong>
      <span>发放积分：${points(plan.points)}</span>
      <span>推荐权限：${plan.slots} 人 / 有效期：${plan.validDays} 天</span>
      <span>复购后获得资格：${planRepeatCredits(plan)} 个 / 冷却：${planRepeatCooldownHours(plan)} 小时 / 资格复购奖励：${plan.repeatRate}%</span>
      <span>首充推荐奖励：${plan.firstRate}%</span>
      <button class="button primary" data-buy-plan="${plan.id}" data-buy-type="${nextType}">申请充值配套</button>
    </article>
  `).join("");
}

function renderMemberOrders(user) {
  const rows = state.orders.filter((order) => order.userId === user.id).slice().reverse().map((order) => {
    const plan = findPlan(order.planId);
    return `<tr><td>${order.id}</td><td>${plan?.name || "-"}</td><td>${order.type === "first" ? "首充" : "复购"}</td><td>${money(order.amount)}</td><td>${points(order.points)}</td><td><span class="tag ${order.status}">${labelStatus(order.status)}</span></td><td>${new Date(order.createdAt).toLocaleString("zh-CN")}</td></tr>`;
  }).join("");
  document.querySelector("#memberOrderTable").innerHTML = rows || `<tr><td colspan="7">暂无订单</td></tr>`;
}

function renderMemberOrderProofStatuses(user) {
  const table = document.querySelector("#memberOrderTable");
  if (!table) return;
  const orders = state.orders.filter((order) => order.userId === user.id).slice().reverse();
  [...table.querySelectorAll("tr")].forEach((row, index) => {
    const order = orders[index];
    const statusCell = row.children[5];
    if (!order || !statusCell || statusCell.querySelector(".proof-status")) return;
    const proofLine = document.createElement("span");
    proofLine.className = "muted-line proof-status";
    proofLine.textContent = proofStatusText(order);
    statusCell.appendChild(proofLine);
    if (order.status === "pending" && !order.proofUrl) {
      const retryButton = document.createElement("button");
      retryButton.className = "link proof-retry";
      retryButton.type = "button";
      retryButton.dataset.retryProof = order.id;
      retryButton.textContent = "补传凭证";
      statusCell.appendChild(retryButton);
    }
  });
}

function renderMemberReferrals(user) {
  const usersById = new Map(state.users.map((item) => [item.id, item]));
  const referrals = new Map();
  state.users.filter((item) => item.referrerId === user.id).forEach((item) => {
    referrals.set(item.id, referralDocForUser(item));
  });
  (state.referrals || []).filter((item) => item.referrerId === user.id).forEach((item) => {
    referrals.set(item.inviteeId, item);
  });
  const rows = [...referrals.values()].map((referral) => {
    const invitee = usersById.get(referral.inviteeId);
    const [statusClass, statusLabel] = invitee ? packageStatus(invitee) : ["neutral", "已绑定"];
    const sales = state.orders.filter((order) => order.userId === referral.inviteeId && order.status === "paid").reduce((sum, order) => sum + order.amount, 0);
    return `<tr><td>${invitee?.name || referral.inviteeName || "-"}</td><td>${invitee?.account || referral.inviteeAccount || "-"}</td><td><span class="tag ${statusClass}">${statusLabel}</span></td><td>${money(sales)}</td><td>是</td></tr>`;
  }).join("");
  document.querySelector("#memberReferralTable").innerHTML = rows || `<tr><td colspan="5">暂无直接推荐用户</td></tr>`;
}

function renderRewardRules() {
  document.querySelector("#rewardRules").innerHTML = state.plans.map((plan) => `
    <article class="rule-card">
      <strong>${plan.name}</strong>
      <span>首充奖励：下线首次购买 ${money(plan.amount)}，推荐人获得 ${money(plan.amount * plan.firstRate / 100)}。</span>
      <span>复购资格：用户复购后获得 ${planRepeatCredits(plan)} 个复购奖励资格。</span>
      <span>资格奖励：后续复购订单会自动派发给资格池用户，每次资格奖励约 ${money(plan.amount * plan.repeatRate / 100)}，并扣 1 个资格。</span>
      <span>奖励先待确认，${CONFIRM_DAYS} 天后由后台确认。</span>
    </article>
  `).join("");
}

function renderMemberRewards(user) {
  const rows = state.rewards.filter((reward) => reward.userId === user.id).slice().reverse().map((reward) => {
    const sourceUser = findUser(reward.sourceUserId);
    return `<tr><td>${sourceUser?.name || "-"}</td><td>${reward.orderId}</td><td>${rewardTypeText(reward)}</td><td>${reward.rate}%</td><td>${rewardAmountText(reward)}</td><td><span class="tag ${reward.status}">${labelStatus(reward.status)}</span></td><td>${rewardNextDateText(reward)}</td></tr>`;
  }).join("");
  document.querySelector("#memberRewardTable").innerHTML = rows || `<tr><td colspan="7">暂无奖励</td></tr>`;
}

function renderMemberRepeatCreditLogs(user) {
  const table = document.querySelector("#memberRepeatCreditLogTable");
  if (!table) return;
  const rows = (state.repeatCreditLogs || [])
    .filter((log) => log.userId === user.id)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20)
    .map((log) => {
      const change = Number(log.change || 0);
      const changeText = `${change > 0 ? "+" : ""}${change}`;
      return `<tr><td>${new Date(log.createdAt).toLocaleString("zh-CN")}</td><td>${changeText}</td><td>${points(log.balance || 0)}</td><td>${repeatCreditReasonText(log.reason)}</td><td>${[log.source, log.note].filter(Boolean).join(" / ") || "-"}</td></tr>`;
    }).join("");
  table.innerHTML = rows || `<tr><td colspan="5">暂无复购资格流水</td></tr>`;
}

function renderMemberWithdraws(user) {
  const rows = state.withdraws.filter((item) => item.userId === user.id).slice().reverse().map((item) => `<tr><td>${item.id}</td><td>${money(item.amount)}</td><td>${item.source === "reward" ? "奖励提现" : item.source || "-"}</td><td>${item.method}</td><td>${item.account}</td><td><span class="tag ${item.status}">${labelStatus(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td></tr>`).join("");
  document.querySelector("#memberWithdrawTable").innerHTML = rows || `<tr><td colspan="7">暂无提现记录</td></tr>`;
}

function renderAdmin() {
  document.querySelector("#metricUsers").textContent = state.users.length;
  document.querySelector("#metricSales").textContent = money(state.orders.filter((order) => order.status === "paid").reduce((sum, order) => sum + order.amount, 0));
  document.querySelector("#metricPendingRewards").textContent = money(state.rewards.filter((reward) => ["pending", "releasing"].includes(reward.status)).reduce((sum, reward) => sum + (Number(reward.amount || 0) - Number(reward.releasedAmount || 0)), 0));
  document.querySelector("#metricWithdraws").textContent = money(state.withdraws.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.amount, 0));
  ensurePlanCooldownField();
  ensurePlanCancelButton();
  ensureRewardStatusOptions();
  renderAdminTodos();
  renderAdminTabBadges();
  renderAdminPlans();
  renderAdminUsers();
  renderRepeatCreditLogs();
  renderAdminOrders();
  renderAdminRewards();
  renderAdminWithdraws();
  renderAdminRiskRules();
  renderAdminLogs();
}

function adminTodoItems() {
  const now = new Date();
  const pendingOrders = (state.orders || []).filter((order) => order.status === "pending");
  const failedProofOrders = (state.orders || []).filter((order) => order.status === "pending" && order.proofStatus === "failed");
  const dueRewards = (state.rewards || []).filter((reward) =>
    ["pending", "releasing"].includes(reward.status) && new Date(reward.confirmAfter) <= now
  );
  const pendingRewards = (state.rewards || []).filter((reward) => ["pending", "releasing"].includes(reward.status));
  const pendingWithdraws = (state.withdraws || []).filter((withdraw) => withdraw.status === "pending");
  const duplicateRisks = duplicateOrderRisks(state);
  const integrityIssues = dataIntegrityIssues(state);
  const checks = readinessChecks();
  const failedChecks = checks.filter((check) => !check.ok);

  return [
    {
      title: "充值订单待审核",
      count: pendingOrders.length,
      level: pendingOrders.length ? "warn" : "ok",
      detail: pendingOrders.length ? `有 ${pendingOrders.length} 笔订单等待确认付款。` : "没有待审核充值订单。",
      action: "到订单管理处理",
      tab: "adminOrders",
      focus: "pendingOrders",
    },
    {
      title: "付款凭证异常",
      count: failedProofOrders.length,
      level: failedProofOrders.length ? "danger" : "ok",
      detail: failedProofOrders.length ? `${failedProofOrders.length} 笔订单凭证上传失败，需要用户补传或后台核对。` : "没有上传失败的付款凭证。",
      action: "到订单管理查看",
      tab: "adminOrders",
      focus: "failedProofs",
    },
    {
      title: "重复提交风险",
      count: duplicateRisks.length,
      level: duplicateRisks.length ? "danger" : "ok",
      detail: duplicateRisks.length ? duplicateRisks.slice(0, 2).join("；") : "没有发现重复付款参考号或重复凭证名。",
      action: "到风控规则查看",
      tab: "adminRisk",
      focus: "duplicateOrders",
    },
    {
      title: "奖励待处理",
      count: pendingRewards.length,
      level: dueRewards.length ? "warn" : pendingRewards.length ? "neutral" : "ok",
      detail: dueRewards.length ? `${dueRewards.length} 笔奖励已到期可确认/释放。` : pendingRewards.length ? `${pendingRewards.length} 笔奖励仍在等待或分期中。` : "没有待处理奖励。",
      action: "到奖励审核处理",
      tab: "adminRewards",
      focus: dueRewards.length ? "dueRewards" : "pendingRewards",
    },
    {
      title: "提现待审核",
      count: pendingWithdraws.length,
      level: pendingWithdraws.length ? "warn" : "ok",
      detail: pendingWithdraws.length ? `${pendingWithdraws.length} 笔提现申请等待审核。` : "没有待审核提现。",
      action: "到提现审核处理",
      tab: "adminWithdraws",
      focus: "pendingWithdraws",
    },
    {
      title: "数据异常",
      count: integrityIssues.length,
      level: integrityIssues.length ? "danger" : "ok",
      detail: integrityIssues.length ? integrityIssues.slice(0, 2).join("；") : "数据一致性正常。",
      action: "到风控规则查看",
      tab: "adminRisk",
      focus: "integrityIssues",
    },
    {
      title: "上线自检",
      count: failedChecks.length,
      level: failedChecks.length ? "warn" : "ok",
      detail: failedChecks.length ? `${failedChecks.length} 项自检待处理：${failedChecks.slice(0, 2).map((check) => check.label).join("、")}` : "上线自检全部通过。",
      action: "到风控规则查看",
      tab: "adminRisk",
      focus: "readiness",
    },
  ];
}

function renderAdminTodos() {
  const target = document.querySelector("#adminTodoList");
  if (!target) return;
  target.innerHTML = adminTodoItems().map((item) => `
    <article class="todo-card ${item.level}">
      <span>${item.title}</span>
      <strong>${item.count}</strong>
      <p>${item.detail}</p>
      <button class="link" type="button" data-open-admin-tab="${item.tab}" data-todo-focus="${item.focus}">${item.action}</button>
    </article>
  `).join("");
}

function setTabBadge(tabId, count, tone = "warn") {
  const button = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (!button) return;
  button.querySelector(".tab-badge")?.remove();
  if (!count) return;
  const badge = document.createElement("span");
  badge.className = `tab-badge ${tone}`;
  badge.textContent = count > 99 ? "99+" : String(count);
  button.appendChild(badge);
}

function renderAdminTabBadges() {
  const items = adminTodoItems();
  const byTab = items.reduce((map, item) => {
    map[item.tab] = (map[item.tab] || 0) + Number(item.count || 0);
    return map;
  }, {});
  const total = items.reduce((sum, item) => sum + Number(item.count || 0), 0);
  setTabBadge("adminTodos", total, "warn");
  setTabBadge("adminOrders", byTab.adminOrders || 0, byTab.adminOrders ? "danger" : "warn");
  setTabBadge("adminRewards", byTab.adminRewards || 0, "warn");
  setTabBadge("adminWithdraws", byTab.adminWithdraws || 0, "warn");
  setTabBadge("adminRisk", byTab.adminRisk || 0, byTab.adminRisk ? "danger" : "warn");
  setTabBadge("adminUsers", 0);
  setTabBadge("adminLogs", 0);
}

function ensureRewardStatusOptions() {
  const select = document.querySelector("#rewardStatusFilter");
  if (!select) return;
  if (!select.querySelector("option[value='due']")) {
    const dueOption = document.createElement("option");
    dueOption.value = "due";
    dueOption.textContent = "到期可处理";
    select.querySelector("option[value='pending']")?.insertAdjacentElement("beforebegin", dueOption);
  }
  if (select.querySelector("option[value='releasing']")) return;
  const option = document.createElement("option");
  option.value = "releasing";
  option.textContent = "分期释放中";
  const confirmedOption = select.querySelector("option[value='confirmed']");
  if (confirmedOption) {
    confirmedOption.insertAdjacentElement("beforebegin", option);
  } else {
    select.appendChild(option);
  }
}

function ensurePlanCooldownField() {
  const form = document.querySelector("#planForm");
  if (!form || form.querySelector("[name='repeatCooldownHours']")) return;
  const repeatField = form.querySelector("[name='repeatCredits']")?.closest("label");
  if (!repeatField) return;
  const field = document.createElement("label");
  field.innerHTML = `复购冷却小时<input name="repeatCooldownHours" type="number" min="0" step="1" value="24" required />`;
  repeatField.insertAdjacentElement("afterend", field);
}

function ensurePlanCancelButton() {
  const form = document.querySelector("#planForm");
  if (!form || form.querySelector("#cancelPlanEditBtn")) return;
  const submitButton = form.querySelector("button[type='submit']");
  if (!submitButton) return;
  const button = document.createElement("button");
  button.id = "cancelPlanEditBtn";
  button.className = "button ghost";
  button.type = "button";
  button.textContent = "取消编辑";
  button.hidden = true;
  submitButton.insertAdjacentElement("afterend", button);
}

function planUsed(planId) {
  return (state.orders || []).some((order) => order.planId === planId);
}

function planFromForm(form) {
  return {
    name: form.get("name").trim(),
    amount: Number(form.get("amount")),
    points: Number(form.get("points")),
    slots: Number(form.get("slots")),
    repeatCredits: Number(form.get("repeatCredits")),
    repeatCooldownHours: Number(form.get("repeatCooldownHours") || 24),
    validDays: Number(form.get("validDays")),
    firstRate: Number(form.get("firstRate")),
    repeatRate: Number(form.get("repeatRate")),
  };
}

function fillPlanForm(plan) {
  const form = document.querySelector("#planForm");
  if (!form || !plan) return;
  ensurePlanCooldownField();
  form.querySelector("[name='name']").value = plan.name || "";
  form.querySelector("[name='amount']").value = plan.amount || "";
  form.querySelector("[name='points']").value = plan.points || "";
  form.querySelector("[name='slots']").value = plan.slots || "";
  form.querySelector("[name='repeatCredits']").value = planRepeatCredits(plan);
  form.querySelector("[name='repeatCooldownHours']").value = planRepeatCooldownHours(plan);
  form.querySelector("[name='validDays']").value = plan.validDays || "";
  form.querySelector("[name='firstRate']").value = plan.firstRate || 0;
  form.querySelector("[name='repeatRate']").value = plan.repeatRate || 0;
  const button = form.querySelector("button[type='submit']");
  if (button) button.textContent = "保存配套";
  const cancelButton = form.querySelector("#cancelPlanEditBtn");
  if (cancelButton) cancelButton.hidden = false;
}

function resetPlanForm() {
  const form = document.querySelector("#planForm");
  if (!form) return;
  form.reset();
  editingPlanId = "";
  const button = form.querySelector("button[type='submit']");
  if (button) button.textContent = "新增配套";
  const cancelButton = form.querySelector("#cancelPlanEditBtn");
  if (cancelButton) cancelButton.hidden = true;
}

function renderAdminPlans() {
  document.querySelector("#adminPlanList").innerHTML = state.plans.map((plan) => `
    <article class="plan-card">
      <strong>${plan.name} · ${money(plan.amount)}</strong>
      <span>积分 ${points(plan.points)} / 推荐名额 ${plan.slots} / 复购资格 ${planRepeatCredits(plan)} 个</span>
      <span>冷却 ${planRepeatCooldownHours(plan)} 小时 / 有效期 ${plan.validDays} 天 / 首充 ${plan.firstRate}% / 资格复购 ${plan.repeatRate}%</span>
      <div class="actions">
        <button class="link" type="button" data-edit-plan="${plan.id}">编辑</button>
        ${planUsed(plan.id) ? `<span class="muted-line">已有订单，不能删除</span>` : `<button class="link danger-link" type="button" data-delete-plan="${plan.id}">删除</button>`}
      </div>
    </article>
  `).join("");
}

function renderAdminUsers() {
  const userOptions = state.users.map((user) => `<option value="${user.id}">${user.name}（${user.inviteCode}）</option>`).join("");
  document.querySelector("#pointsForm [name='userId']").innerHTML = userOptions;
  document.querySelector("#repeatCreditsForm [name='userId']").innerHTML = userOptions;
  const users = filteredUsers();
  document.querySelector("#adminUserTable").innerHTML = users.map((user) => {
    const referrer = findUser(user.referrerId);
    const [statusClass, statusLabel] = packageStatus(user);
    return `<tr><td>${user.name}</td><td>${user.account}</td><td>${user.phone || "-"}</td><td>${user.inviteCode}</td><td>${referrer?.name || "无"}</td><td>${points(user.points)}</td><td><span class="tag ${statusClass}">${statusLabel}</span></td><td>${directReferralCount(user.id)} / ${user.slots || 0}</td><td>${points(user.repeatCredits || 0)}</td><td><span class="tag ${user.frozen ? "frozen" : "active"}">${user.frozen ? "已冻结" : "正常"}</span></td><td><button class="link" data-user-detail="${user.id}">详情</button><button class="link" data-freeze-user="${user.id}">${user.frozen ? "解冻" : "冻结"}</button></td></tr>`;
  }).join("") || `<tr><td colspan="11">没有符合条件的用户</td></tr>`;
}

function repeatCreditReasonText(reason) {
  return {
    earned: "复购获得",
    used: "资格扣除",
    admin: "后台调整",
  }[reason] || reason || "-";
}

function ensureRepeatCreditLogActions() {
  if (document.querySelector("#exportRepeatCreditLogsBtn")) return;
  const table = document.querySelector("#repeatCreditLogTable");
  const wrap = table?.closest(".table-wrap");
  if (!wrap?.parentNode) return;
  const actions = document.createElement("div");
  actions.className = "repeat-log-actions";
  actions.innerHTML = `<button id="exportRepeatCreditLogsBtn" class="button ghost" type="button">导出资格流水</button>`;
  wrap.parentNode.insertBefore(actions, wrap);
}

function ensureRepeatCreditLogFilters() {
  if (document.querySelector("#repeatLogSearchInput")) return;
  const table = document.querySelector("#repeatCreditLogTable");
  const wrap = table?.closest(".table-wrap");
  if (!wrap?.parentNode) return;
  const filters = document.createElement("div");
  filters.className = "filter-bar repeat-log-filters";
  filters.innerHTML = `
    <label>搜索流水<input id="repeatLogSearchInput" placeholder="用户 / 账号 / 来源 / 备注" /></label>
    <label>用户<select id="repeatLogUserFilter"><option value="all">全部用户</option></select></label>
    <label>原因
      <select id="repeatLogReasonFilter">
        <option value="all">全部原因</option>
        <option value="earned">复购获得</option>
        <option value="used">资格扣除</option>
        <option value="admin">后台调整</option>
      </select>
    </label>
    <button id="clearRepeatLogFiltersBtn" class="button ghost" type="button">清除筛选</button>
  `;
  wrap.parentNode.insertBefore(filters, wrap);
}

function renderRepeatCreditLogFilters() {
  const select = document.querySelector("#repeatLogUserFilter");
  if (!select) return;
  const currentValue = select.value || "all";
  const usersWithLogs = new Set((state.repeatCreditLogs || []).map((log) => log.userId).filter(Boolean));
  const options = state.users
    .filter((user) => usersWithLogs.has(user.id))
    .map((user) => `<option value="${user.id}">${user.name} / ${user.inviteCode}</option>`);
  select.innerHTML = [`<option value="all">全部用户</option>`, ...options].join("");
  select.value = usersWithLogs.has(currentValue) ? currentValue : "all";
}

function filteredRepeatCreditLogs() {
  const keyword = getInputValue("#repeatLogSearchInput").toLowerCase();
  const userFilter = getSelectValue("#repeatLogUserFilter", "all");
  const reasonFilter = getSelectValue("#repeatLogReasonFilter", "all");
  return (state.repeatCreditLogs || [])
    .filter((log) => {
      const user = findUser(log.userId);
      const searchable = [
        log.id,
        log.userId,
        user?.name,
        user?.account,
        user?.inviteCode,
        log.source,
        log.note,
        repeatCreditReasonText(log.reason),
      ].join(" ").toLowerCase();
      const matchesKeyword = !keyword || searchable.includes(keyword);
      const matchesUser = userFilter === "all" || log.userId === userFilter;
      const matchesReason = reasonFilter === "all" || log.reason === reasonFilter;
      return matchesKeyword && matchesUser && matchesReason;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderRepeatCreditLogs() {
  const table = document.querySelector("#repeatCreditLogTable");
  if (!table) return;
  ensureRepeatCreditLogActions();
  ensureRepeatCreditLogFilters();
  renderRepeatCreditLogFilters();
  const rows = filteredRepeatCreditLogs()
    .slice(0, 20)
    .map((log) => {
      const user = findUser(log.userId);
      const change = Number(log.change || 0);
      const changeText = `${change > 0 ? "+" : ""}${change}`;
      return `<tr><td>${new Date(log.createdAt).toLocaleString("zh-CN")}</td><td>${user?.name || log.userId || "-"}</td><td>${changeText}</td><td>${points(log.balance || 0)}</td><td>${repeatCreditReasonText(log.reason)}</td><td>${[log.source, log.note].filter(Boolean).join(" / ") || "-"}</td></tr>`;
    }).join("");
  table.innerHTML = rows || `<tr><td colspan="6">暂无复购资格流水</td></tr>`;
}

function renderAdminOrders() {
  const orders = filteredOrders();
  const rows = orders.slice().reverse().map((order) => {
    const user = findUser(order.userId);
    const plan = findPlan(order.planId);
    const resolvedType = order.status === "pending" ? actualOrderType(state, order.userId, order.id) : order.type;
    const typeWarning = order.status === "pending" && order.type !== resolvedType
      ? ` <span class="tag warning">将按${resolvedType === "first" ? "首充" : "复购"}确认</span>`
      : "";
    const detailAction = `<button class="link" data-order-detail="${order.id}">详情</button>`;
    const actions = order.status === "pending"
      ? `<button class="link" data-confirm-order="${order.id}">确认付款</button><button class="link" data-cancel-order="${order.id}">取消订单</button>`
      : order.status === "paid"
        ? `<button class="link" data-recalc-order="${order.id}">重算奖励</button>`
        : "";
    const proofHref = order.proofUrl || order.proofInlineData || "";
    const proofLink = proofHref ? ` / <a class="link" href="${proofHref}" target="_blank" rel="noopener">查看凭证</a>` : "";
    const proofText = ` / ${proofStatusText(order)}`;
    const paymentText = `${paymentMethodText(order.paymentMethod)} ${order.paymentRef || ""}${order.paymentNote ? ` / ${order.paymentNote}` : ""}${proofText}${proofLink}`.trim() || "-";
    return `<tr><td>${order.id}</td><td>${user?.name || "-"}</td><td>${plan?.name || "-"}</td><td>${resolvedType === "first" ? "首充" : "复购"}${typeWarning}</td><td>${money(order.amount)}</td><td>${paymentText}</td><td>${points(order.points)}</td><td><span class="tag ${order.status}">${labelStatus(order.status)}</span></td><td>${new Date(order.createdAt).toLocaleString("zh-CN")}</td><td class="actions">${detailAction}${actions}</td></tr>`;
  }).join("");
  document.querySelector("#adminOrderTable").innerHTML = rows || `<tr><td colspan="10">没有符合条件的订单</td></tr>`;
}

function renderAdminRewards() {
  const rewards = filteredRewards();
  const rows = rewards.slice().reverse().map((reward) => {
    const user = findUser(reward.userId);
    const sourceUser = findUser(reward.sourceUserId);
    const canConfirm = ["pending", "releasing"].includes(reward.status) && new Date(reward.confirmAfter) <= new Date();
    return `<tr><td>${user?.name || "-"}</td><td>${sourceUser?.name || "-"}</td><td>${reward.orderId}</td><td>${reward.type === "first" ? "首充" : "复购"}</td><td>${rewardAmountText(reward)}${reward.reviewNote ? `<span class="muted-line">备注：${reward.reviewNote}</span>` : ""}</td><td><span class="tag ${reward.status}">${labelStatus(reward.status)}</span></td><td>${rewardNextDateText(reward)}</td><td class="actions">${canConfirm ? `<button class="link" data-confirm-reward="${reward.id}">确认</button>` : ""}${["pending", "releasing"].includes(reward.status) ? `<button class="link" data-cancel-reward="${reward.id}">取消</button><button class="link" data-freeze-reward="${reward.id}">冻结</button>` : ""}</td></tr>`;
  }).join("");
  document.querySelector("#adminRewardTable").innerHTML = rows || `<tr><td colspan="8">没有符合条件的奖励</td></tr>`;
}

function renderAdminWithdraws() {
  const withdraws = filteredWithdraws();
  const rows = withdraws.slice().reverse().map((item) => {
    const user = findUser(item.userId);
    const detailAction = `<button class="link" data-withdraw-detail="${item.id}">详情</button>`;
    return `<tr><td>${item.id}</td><td>${user?.name || "-"}</td><td>${money(item.amount)}</td><td>${item.source === "reward" ? "奖励提现" : item.source || "-"}</td><td>${item.method}</td><td>${item.account}</td><td><span class="tag ${item.status}">${labelStatus(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td><td class="actions">${detailAction}${item.status === "pending" ? `<button class="link" data-approve-withdraw="${item.id}">通过</button><button class="link" data-reject-withdraw="${item.id}">拒绝</button>` : ""}${item.status === "approved" ? `<button class="link" data-pay-withdraw="${item.id}">标记打款</button>` : ""}</td></tr>`;
  }).join("");
  document.querySelector("#adminWithdrawTable").innerHTML = rows || `<tr><td colspan="9">没有符合条件的提现申请</td></tr>`;
}

function readinessChecks() {
  const activePlans = (state.plans || []).filter((plan) => plan.active);
  const users = state.users || [];
  const paidOrders = (state.orders || []).filter((order) => order.status === "paid");
  const adminUsers = users.filter((user) => ADMIN_EMAILS.includes(user.email));
  const missingPaymentUsers = users.filter((user) => !user.payoutMethod || !user.payoutAccount);
  const pendingOrders = (state.orders || []).filter((order) => order.status === "pending");
  const pendingWithdraws = (state.withdraws || []).filter((withdraw) => withdraw.status === "pending");
  const pendingRewards = (state.rewards || []).filter((reward) => reward.status === "pending" || reward.status === "releasing");
  const integrityIssues = dataIntegrityIssues(state);

  return [
    {
      ok: activePlans.length > 0,
      label: "至少 1 个启用配套",
      detail: activePlans.length ? `当前启用 ${activePlans.length} 个配套` : "请先在左侧新增或启用配套",
    },
    {
      ok: adminUsers.length > 0 || isAdmin(),
      label: "管理员账号可识别",
      detail: adminUsers.length ? `已识别 ${adminUsers.length} 个管理员用户` : `当前管理员邮箱：${ADMIN_EMAILS.join(" / ")}`,
    },
    {
      ok: users.length === 0 || missingPaymentUsers.length === 0,
      label: "用户收款资料",
      detail: missingPaymentUsers.length ? `${missingPaymentUsers.length} 个用户还未填写完整收款资料` : "用户收款资料没有明显缺口",
    },
    {
      ok: pendingOrders.length === 0,
      label: "待处理充值订单",
      detail: pendingOrders.length ? `${pendingOrders.length} 笔订单等待审核` : "没有待处理充值订单",
    },
    {
      ok: pendingRewards.length === 0,
      label: "待确认/释放奖励",
      detail: pendingRewards.length ? `${pendingRewards.length} 笔奖励需要后续处理` : "没有待处理奖励",
    },
    {
      ok: pendingWithdraws.length === 0,
      label: "待审核提现",
      detail: pendingWithdraws.length ? `${pendingWithdraws.length} 笔提现等待审核` : "没有待审核提现",
    },
    {
      ok: paidOrders.every((order) => Number(order.points || 0) > 0),
      label: "已付款订单积分",
      detail: paidOrders.some((order) => Number(order.points || 0) <= 0)
        ? "存在已付款但积分为 0 的订单，请查看订单详情"
        : "已付款订单积分正常",
    },
    {
      ok: integrityIssues.length === 0,
      label: "数据一致性",
      detail: integrityIssues.length
        ? `${integrityIssues.length} 项异常：${integrityIssues.slice(0, 3).join("；")}${integrityIssues.length > 3 ? "；..." : ""}`
        : "推荐、订单、奖励、提现关系正常",
    },
  ];
}

function renderAdminRiskRules() {
  const target = document.querySelector("#riskRuleCards");
  if (!target) return;
  const planCooldowns = state.plans.map((plan) => `${plan.name}: ${planRepeatCooldownHours(plan)} 小时`).join(" / ");
  const checks = readinessChecks();
  const failedChecks = checks.filter((check) => !check.ok).length;
  target.innerHTML = [
    {
      title: "上线前自检",
      rows: [
        failedChecks ? `还有 ${failedChecks} 项需要处理。` : "全部检查通过，可以进入小范围测试。",
        `页面前端版本：${APP_VERSION}。`,
        ...checks.map((check) => `<b class="${check.ok ? "check-ok" : "check-warn"}">${check.ok ? "通过" : "待处理"}</b> ${check.label}：${check.detail}`),
      ],
    },
    {
      title: "复购冷却",
      rows: [
        "复购付款确认后，用户进入冷却期。",
        `当前配套冷却：${planCooldowns || "暂无配套"}`,
        "冷却期内不能再次提交复购订单；已有待确认复购订单也不能重复提交。",
      ],
    },
    {
      title: "复购奖励分期",
      rows: [
        `复购资格奖励分 ${REPEAT_RELEASE_DAYS.length} 期释放。`,
        `释放日：第 ${REPEAT_RELEASE_DAYS.join(" / 第 ")} 天。`,
        "只有已释放金额会计入用户可提现余额。",
      ],
    },
    {
      title: "资格池派发规则",
      rows: [
        "用户复购后获得资格，但不会接收自己这笔复购的资格池奖励。",
        "系统优先派发给资格池中排队最早且未冻结的用户。",
        "派发成功后接收人扣 1 个复购资格。",
      ],
    },
    {
      title: "防重复提交",
      rows: [
        "用户重复使用同一付款参考号时会收到确认提醒。",
        "用户重复上传同名付款凭证时会收到确认提醒。",
        "后台自检会标记重复付款参考号和重复凭证文件名。",
      ],
    },
    {
      title: "提现触发条件",
      rows: [
        `最低提现金额：${money(MIN_WITHDRAW_AMOUNT)}。`,
        `两次提现申请间隔：${WITHDRAW_COOLDOWN_HOURS} 小时。`,
        "用户必须账户正常，且拥有有效配套。",
        "申请金额不能超过当前可提现余额。",
      ],
    },
    {
      title: "后台人工审核",
      rows: [
        "充值订单需要后台确认后才发放积分、资格和奖励。",
        "奖励先进入待确认或分期释放状态，可取消或冻结。",
        "提现申请需要后台审核，通过后再标记打款。",
      ],
    },
    {
      title: "部署前自检",
      rows: [
        `页面前端版本应显示：${APP_VERSION}。`,
        "如果出现 permission-denied，先发布最新 firestore.rules。",
        "如果凭证上传异常，先发布 storage.rules；MVP 会把小图暂存订单内。",
      ],
    },
  ].map((card) => `
    <article class="risk-card">
      <strong>${card.title}</strong>
      ${card.rows.map((row) => `<span>${row}</span>`).join("")}
    </article>
  `).join("");
}

function getSelectValue(selector, fallback) {
  return document.querySelector(selector)?.value || fallback;
}

function getInputValue(selector) {
  return document.querySelector(selector)?.value.trim() || "";
}

function renderAdminLogs() {
  renderLogActionOptions();
  const logs = filteredLogs();
  const limit = getSelectValue("#logLimitFilter", "200");
  const visibleLogs = limit === "all" ? logs : logs.slice(0, Number(limit));
  const rows = visibleLogs.map((log) => `
    <tr>
      <td>${new Date(log.createdAt).toLocaleString("zh-CN")}</td>
      <td>${log.adminEmail || "-"}</td>
      <td>${log.action}</td>
      <td>${log.target || "-"}</td>
      <td>${log.detail || "-"}</td>
    </tr>
  `).join("");
  document.querySelector("#adminLogTable").innerHTML = rows || `<tr><td colspan="5">没有符合条件的操作日志</td></tr>`;
}

function renderLogActionOptions() {
  const select = document.querySelector("#logActionFilter");
  if (!select) return;
  const currentValue = select.value || "all";
  const actions = [...new Set((state.adminLogs || []).map((log) => log.action).filter(Boolean))].sort();
  select.innerHTML = [
    `<option value="all">全部动作</option>`,
    ...actions.map((action) => `<option value="${action}">${action}</option>`),
  ].join("");
  select.value = actions.includes(currentValue) ? currentValue : "all";
}

function addAdminLog(action, target, detail = "") {
  if (!Array.isArray(state.adminLogs)) state.adminLogs = [];
  state.adminLogs.push({
    id: id("alog"),
    adminUid: firebaseUser?.uid || "",
    adminEmail: firebaseUser?.email || "",
    action,
    target,
    detail,
    createdAt: new Date().toISOString(),
  });
}

function addRepeatCreditLog(data, userId, change, balance, reason, source = "", note = "", createdAt = new Date().toISOString()) {
  if (!Array.isArray(data.repeatCreditLogs)) data.repeatCreditLogs = [];
  data.repeatCreditLogs.push({
    id: id("rclog"),
    userId,
    change,
    balance,
    reason,
    source,
    note,
    createdAt,
  });
}

function exportStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function exportBundle() {
  const paidOrders = (state.orders || []).filter((order) => order.status === "paid");
  const readiness = readinessChecks();
  const integrityIssues = dataIntegrityIssues(state);
  const bundle = {
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    projectId: firebaseConfig.projectId,
    exportedBy: firebaseUser?.email || "",
    summary: {
      users: state.users.length,
      orders: state.orders.length,
      paidSales: paidOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0),
      rewards: state.rewards.length,
      withdraws: state.withdraws.length,
      repeatCreditLogs: (state.repeatCreditLogs || []).length,
      adminLogs: (state.adminLogs || []).length,
      riskItems: readiness.length,
      riskPendingItems: readiness.filter((check) => !check.ok).length,
      integrityIssues: integrityIssues.length,
    },
    riskReport: {
      checks: readiness,
      integrityIssues,
    },
    data: state,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `amsystem-backup-${exportStamp()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportRiskReport() {
  const checks = readinessChecks();
  const issues = dataIntegrityIssues(state);
  downloadCsv(
    `amsystem-risk-report-${exportStamp()}.csv`,
    ["类型", "状态", "项目", "详情"],
    [
      ...checks.map((check) => ["自检", check.ok ? "通过" : "待处理", check.label, check.detail]),
      ...issues.map((issue) => ["数据一致性", "异常", "明细", issue]),
    ]
  );
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const content = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filteredOrders() {
  const keyword = getInputValue("#orderSearchInput").toLowerCase();
  const statusFilter = getSelectValue("#orderStatusFilter", "all");
  const typeFilter = getSelectValue("#orderTypeFilter", "all");
  const proofFilter = getSelectValue("#orderProofFilter", "all");

  return state.orders.filter((order) => {
    const user = findUser(order.userId);
    const plan = findPlan(order.planId);
    const searchable = [
      order.id,
      user?.name,
      user?.account,
      user?.phone,
      user?.inviteCode,
      plan?.name,
      order.paymentRef,
      order.paymentNote,
      paymentMethodText(order.paymentMethod),
      proofStatusText(order),
    ].join(" ").toLowerCase();
    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;
    const matchesType = typeFilter === "all" || order.type === typeFilter;
    const matchesProof = proofFilter === "all"
      || order.proofStatus === proofFilter
      || (proofFilter === "uploaded" && Boolean(order.proofUrl))
      || (proofFilter === "inline" && Boolean(order.proofInlineData))
      || (proofFilter === "none" && !order.proofUrl && !order.proofInlineData && order.proofStatus !== "failed");
    return matchesKeyword && matchesStatus && matchesType && matchesProof;
  });
}

function filteredUsers() {
  const keyword = getInputValue("#userSearchInput").toLowerCase();
  const packageFilter = getSelectValue("#userPackageFilter", "all");
  const accountFilter = getSelectValue("#userAccountFilter", "all");

  return state.users.filter((user) => {
    const referrer = findUser(user.referrerId);
    const searchable = [
      user.name,
      user.account,
      user.phone,
      user.inviteCode,
      referrer?.name,
      referrer?.account,
    ].join(" ").toLowerCase();
    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesPackage = packageFilter === "all"
      || (packageFilter === "active" && isActivePackage(user))
      || (packageFilter === "expired" && !isActivePackage(user));
    const matchesAccount = accountFilter === "all"
      || (accountFilter === "normal" && !user.frozen)
      || (accountFilter === "frozen" && user.frozen);
    return matchesKeyword && matchesPackage && matchesAccount;
  });
}

function filteredRewards() {
  const keyword = getInputValue("#rewardSearchInput").toLowerCase();
  const statusFilter = getSelectValue("#rewardStatusFilter", "all");
  const typeFilter = getSelectValue("#rewardTypeFilter", "all");

  return state.rewards.filter((reward) => {
    const user = findUser(reward.userId);
    const sourceUser = findUser(reward.sourceUserId);
    const searchable = [
      reward.id,
      reward.orderId,
      user?.name,
      user?.account,
      user?.phone,
      sourceUser?.name,
      sourceUser?.account,
      sourceUser?.phone,
    ].join(" ").toLowerCase();
    const matchesKeyword = !keyword || searchable.includes(keyword);
    const isDue = ["pending", "releasing"].includes(reward.status) && new Date(reward.confirmAfter) <= new Date();
    const matchesStatus = statusFilter === "all"
      || reward.status === statusFilter
      || (statusFilter === "due" && isDue);
    const matchesType = typeFilter === "all" || reward.type === typeFilter;
    return matchesKeyword && matchesStatus && matchesType;
  });
}

function filteredWithdraws() {
  const keyword = getInputValue("#withdrawSearchInput").toLowerCase();
  const statusFilter = getSelectValue("#withdrawStatusFilter", "all");
  const minAmount = Number(getInputValue("#withdrawMinAmount") || 0);

  return state.withdraws.filter((item) => {
    const user = findUser(item.userId);
    const searchable = [
      item.id,
      user?.name,
      user?.account,
      user?.phone,
      user?.inviteCode,
      item.method,
      item.account,
    ].join(" ").toLowerCase();
    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    const matchesAmount = !minAmount || Number(item.amount || 0) >= minAmount;
    return matchesKeyword && matchesStatus && matchesAmount;
  });
}

function filteredLogs() {
  const keyword = getInputValue("#logSearchInput").toLowerCase();
  const actionFilter = getSelectValue("#logActionFilter", "all");
  return (state.adminLogs || [])
    .filter((log) => {
      const searchable = [
        log.adminEmail,
        log.action,
        log.target,
        log.detail,
      ].join(" ").toLowerCase();
      const matchesKeyword = !keyword || searchable.includes(keyword);
      const matchesAction = actionFilter === "all" || log.action === actionFilter;
      return matchesKeyword && matchesAction;
    })
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateAuthStatusClean() {
  const status = document.querySelector("#authStatus");
  if (status) {
    if (firebaseUser) {
      status.textContent = `已登录：${firebaseUser.email || firebaseUser.displayName}${isAdmin() ? "（管理员）" : ""}`;
    } else if (firebaseReady) {
      status.textContent = "请使用 Google 登录。";
    } else {
      status.textContent = "正在连接 Firebase...";
    }
  }
  const syncStatus = document.querySelector("#syncStatus");
  if (syncStatus) syncStatus.textContent = readableSyncMessage(syncMessage);
}

function renderAdminLocked() {
  document.querySelector("#metricUsers").textContent = "-";
  document.querySelector("#metricSales").textContent = "-";
  document.querySelector("#metricPendingRewards").textContent = "-";
  document.querySelector("#metricWithdraws").textContent = "-";
  document.querySelector("#adminPlanList").innerHTML = `<article class="plan-card"><strong>后台已锁定</strong><span>请使用管理员 Google 邮箱登录。</span></article>`;
  document.querySelector("#adminUserTable").innerHTML = `<tr><td colspan="11">无管理员权限</td></tr>`;
  document.querySelector("#repeatCreditLogTable").innerHTML = `<tr><td colspan="6">无管理员权限</td></tr>`;
  document.querySelector("#adminOrderTable").innerHTML = `<tr><td colspan="10">无管理员权限</td></tr>`;
  document.querySelector("#adminRewardTable").innerHTML = `<tr><td colspan="8">无管理员权限</td></tr>`;
  document.querySelector("#adminWithdrawTable").innerHTML = `<tr><td colspan="8">无管理员权限</td></tr>`;
  if (document.querySelector("#riskRuleCards")) {
    document.querySelector("#riskRuleCards").innerHTML = `<article class="risk-card"><strong>后台已锁定</strong><span>请使用管理员 Google 邮箱登录后查看风控规则。</span></article>`;
  }
  if (document.querySelector("#adminLogTable")) {
    document.querySelector("#adminLogTable").innerHTML = `<tr><td colspan="5">无管理员权限</td></tr>`;
  }
}

function requireAdmin() {
  if (isAdmin()) return true;
  toast("只有管理员可以操作后台");
  return false;
}

function renderAdminActionButtons() {
  const canAdmin = isAdmin();
  const exportBtn = document.querySelector("#exportBtn");
  const resetBtn = document.querySelector("#resetBtn");
  if (exportBtn) {
    exportBtn.disabled = !canAdmin;
    exportBtn.title = canAdmin ? "导出完整 JSON 备份包" : "请使用管理员账号登录";
  }
  if (resetBtn) {
    resetBtn.disabled = !canAdmin;
    resetBtn.title = canAdmin ? "危险操作：会重置演示数据" : "请使用管理员账号登录";
  }
}

function renderAll() {
  if (!state) return;
  updateAuthStatusClean();
  renderAppVersion();
  renderAdminActionButtons();
  renderMember();
  if (isAdmin()) {
    renderAdmin();
  } else {
    renderAdminLocked();
  }
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === "adminView" && !requireAdmin()) return;
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.view}`).classList.add("active");
  });
});

function openTab(tabId) {
  const panel = document.querySelector(`#${tabId}`);
  const button = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (!panel || !button) return;
  const view = panel.closest(".view");
  view.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
  view.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  panel.classList.add("active");
}

function applyTodoFocus(focus) {
  if (!focus) return;
  const setValue = (selector, value) => {
    const input = document.querySelector(selector);
    if (input) input.value = value;
  };
  if (focus === "pendingOrders") {
    setValue("#orderStatusFilter", "pending");
    setValue("#orderTypeFilter", "all");
    setValue("#orderProofFilter", "all");
    setValue("#orderSearchInput", "");
  }
  if (focus === "failedProofs") {
    setValue("#orderStatusFilter", "pending");
    setValue("#orderTypeFilter", "all");
    setValue("#orderProofFilter", "failed");
    setValue("#orderSearchInput", "");
  }
  if (focus === "pendingRewards") {
    setValue("#rewardStatusFilter", "pending");
    setValue("#rewardTypeFilter", "all");
    setValue("#rewardSearchInput", "");
  }
  if (focus === "dueRewards") {
    setValue("#rewardStatusFilter", "due");
    setValue("#rewardTypeFilter", "all");
    setValue("#rewardSearchInput", "");
  }
  if (focus === "pendingWithdraws") {
    setValue("#withdrawStatusFilter", "pending");
    setValue("#withdrawSearchInput", "");
    setValue("#withdrawMinAmount", "");
  }
}

document.querySelectorAll(".tabs").forEach((tabs) => {
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    openTab(button.dataset.tab);
  });
});

document.addEventListener("click", (event) => {
  const openAdminTab = event.target.closest("[data-open-admin-tab]");
  if (!openAdminTab) return;
  applyTodoFocus(openAdminTab.dataset.todoFocus);
  openTab(openAdminTab.dataset.openAdminTab);
  renderAll();
});

["#orderStatusFilter", "#orderTypeFilter", "#orderProofFilter", "#rewardStatusFilter", "#rewardTypeFilter", "#withdrawStatusFilter", "#userPackageFilter", "#userAccountFilter", "#logActionFilter", "#logLimitFilter"].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("change", renderAll);
});

document.querySelector("#userSearchInput")?.addEventListener("input", renderAll);
document.querySelector("#orderSearchInput")?.addEventListener("input", renderAll);
document.querySelector("#rewardSearchInput")?.addEventListener("input", renderAll);
document.querySelector("#withdrawSearchInput")?.addEventListener("input", renderAll);
document.querySelector("#withdrawMinAmount")?.addEventListener("input", renderAll);
document.querySelector("#logSearchInput")?.addEventListener("input", renderAll);

document.addEventListener("input", (event) => {
  if (event.target?.id === "repeatLogSearchInput") renderAll();
});

document.addEventListener("change", (event) => {
  if (["repeatLogUserFilter", "repeatLogReasonFilter"].includes(event.target?.id)) renderAll();
});

document.addEventListener("click", (event) => {
  if (event.target?.id !== "clearRepeatLogFiltersBtn") return;
  const searchInput = document.querySelector("#repeatLogSearchInput");
  const userFilter = document.querySelector("#repeatLogUserFilter");
  const reasonFilter = document.querySelector("#repeatLogReasonFilter");
  if (searchInput) searchInput.value = "";
  if (userFilter) userFilter.value = "all";
  if (reasonFilter) reasonFilter.value = "all";
  renderAll();
});

document.querySelector("#clearUserFiltersBtn")?.addEventListener("click", () => {
  const searchInput = document.querySelector("#userSearchInput");
  const packageFilter = document.querySelector("#userPackageFilter");
  const accountFilter = document.querySelector("#userAccountFilter");
  if (searchInput) searchInput.value = "";
  if (packageFilter) packageFilter.value = "all";
  if (accountFilter) accountFilter.value = "all";
  renderAll();
});

document.querySelector("#clearOrderFiltersBtn")?.addEventListener("click", () => {
  const searchInput = document.querySelector("#orderSearchInput");
  const statusFilter = document.querySelector("#orderStatusFilter");
  const typeFilter = document.querySelector("#orderTypeFilter");
  const proofFilter = document.querySelector("#orderProofFilter");
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (typeFilter) typeFilter.value = "all";
  if (proofFilter) proofFilter.value = "all";
  renderAll();
});

document.querySelector("#clearRewardFiltersBtn")?.addEventListener("click", () => {
  const searchInput = document.querySelector("#rewardSearchInput");
  const statusFilter = document.querySelector("#rewardStatusFilter");
  const typeFilter = document.querySelector("#rewardTypeFilter");
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (typeFilter) typeFilter.value = "all";
  renderAll();
});

document.querySelector("#clearWithdrawFiltersBtn")?.addEventListener("click", () => {
  const searchInput = document.querySelector("#withdrawSearchInput");
  const statusFilter = document.querySelector("#withdrawStatusFilter");
  const minAmountInput = document.querySelector("#withdrawMinAmount");
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (minAmountInput) minAmountInput.value = "";
  renderAll();
});

document.querySelector("#clearLogFiltersBtn")?.addEventListener("click", () => {
  const searchInput = document.querySelector("#logSearchInput");
  const actionFilter = document.querySelector("#logActionFilter");
  const limitFilter = document.querySelector("#logLimitFilter");
  if (searchInput) searchInput.value = "";
  if (actionFilter) actionFilter.value = "all";
  if (limitFilter) limitFilter.value = "200";
  renderAll();
});

document.querySelector("#firebaseLoginBtn").addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    toast("Google 登录失败，请检查 Firebase 授权域名");
  }
});

document.querySelector("#firebaseLogoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  toast("已退出登录");
});

document.querySelector("#testFirestoreBtn").addEventListener("click", async () => {
  if (!firebaseUser) return toast("请先使用 Google 登录");
  state.lastSyncTestAt = new Date().toISOString();
  await saveState();
  renderAll();
  toast(cloudAvailable ? "云端保存成功" : "云端保存失败，请看状态提示");
});

document.addEventListener("click", async (event) => {
  if (event.target?.id !== "testStorageBtn") return;
  if (!firebaseUser) return toast("请先使用 Google 登录");
  const proofFile = document.querySelector("#paymentInfoForm [name='paymentProof']")?.files[0];
  if (!proofFile) return toast("请先选择一张付款证明");
  try {
    toast("正在测试 Storage 上传...");
    await withTimeout(uploadPaymentProof(proofFile, `TEST-${Date.now()}`), PROOF_UPLOAD_TIMEOUT_MS, "付款证明上传超时，请检查 Firebase Storage 是否已启用");
    toast("Storage 上传成功");
  } catch (error) {
    toast(uploadErrorMessage(error));
  }
});

document.querySelector("#exportUsersBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-users-${exportStamp()}.csv`,
    ["用户ID", "姓名", "账号", "手机", "邀请码", "推荐人", "积分", "推荐名额", "已用名额", "复购资格", "配套状态", "账号状态"],
    filteredUsers().map((user) => {
      const referrer = findUser(user.referrerId);
      const [, statusLabel] = packageStatus(user);
      return [
        user.id,
        user.name,
        user.account,
        user.phone || "",
        user.inviteCode,
        referrer?.name || "",
        user.points,
        user.slots || 0,
        directReferralCount(user.id),
        user.repeatCredits || 0,
        statusLabel,
        user.frozen ? "已冻结" : "正常",
      ];
    })
  );
});

document.addEventListener("click", (event) => {
  if (event.target?.id !== "exportRepeatCreditLogsBtn") return;
  if (!requireAdmin()) return;
  const logs = filteredRepeatCreditLogs();
  downloadCsv(
    `amsystem-repeat-credit-logs-${exportStamp()}.csv`,
    ["流水ID", "时间", "用户ID", "用户", "账号", "变动", "余额", "原因", "来源", "备注"],
    logs.map((log) => {
      const user = findUser(log.userId);
      return [
        log.id,
        log.createdAt,
        log.userId,
        user?.name || "",
        user?.account || "",
        log.change || 0,
        log.balance || 0,
        repeatCreditReasonText(log.reason),
        log.source || "",
        log.note || "",
      ];
    })
  );
});

document.querySelector("#exportOrdersBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-orders-${exportStamp()}.csv`,
    ["订单号", "用户", "配套", "类型", "金额", "付款方式", "付款参考号", "状态", "处理备注", "申请时间", "确认时间", "取消时间"],
    filteredOrders().map((order) => {
      const user = findUser(order.userId);
      const plan = findPlan(order.planId);
      return [order.id, user?.name || "", plan?.name || "", order.type, order.amount, paymentMethodText(order.paymentMethod), order.paymentRef || "", labelStatus(order.status), order.reviewNote || "", order.createdAt, order.reviewedAt || order.paidAt || "", order.cancelledAt || ""];
    })
  );
});

document.querySelector("#exportRewardsBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-rewards-${exportStamp()}.csv`,
    ["奖励ID", "奖励人", "来源用户", "订单", "类型", "比例", "金额", "状态", "可确认日", "审核备注", "审核时间"],
    filteredRewards().map((reward) => {
      const user = findUser(reward.userId);
      const sourceUser = findUser(reward.sourceUserId);
      return [reward.id, user?.name || "", sourceUser?.name || "", reward.orderId, rewardTypeText(reward), reward.rate, rewardAmountText(reward), labelStatus(reward.status), rewardNextDateText(reward), reward.reviewNote || "", reward.reviewedAt || ""];
    })
  );
});

document.querySelector("#exportWithdrawsBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-withdraws-${exportStamp()}.csv`,
    ["提现ID", "用户", "金额", "来源", "方式", "账号", "状态", "审核备注", "申请时间", "审核时间", "打款时间"],
    filteredWithdraws().map((item) => {
      const user = findUser(item.userId);
      return [item.id, user?.name || "", item.amount, item.source === "reward" ? "奖励提现" : item.source || "", item.method, item.account, labelStatus(item.status), item.reviewNote || "", item.createdAt, item.reviewedAt || "", item.paidAt || ""];
    })
  );
});

document.querySelector("#exportLogsBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-admin-logs-${exportStamp()}.csv`,
    ["日志ID", "时间", "管理员", "动作", "对象", "详情"],
    filteredLogs().map((log) => [
      log.id,
      log.createdAt,
      log.adminEmail || "",
      log.action || "",
      log.target || "",
      log.detail || "",
    ])
  );
});

document.querySelector("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!firebaseUser) return toast("请先使用 Google 登录");
  const user = currentUser();
  const form = new FormData(event.currentTarget);
  user.name = form.get("name").trim();
  user.phone = form.get("phone").trim();
  user.withdrawMethod = form.get("withdrawMethod").trim();
  user.withdrawAccount = form.get("withdrawAccount").trim();
  if (!user.name) return toast("请填写显示名称");
  await saveState();
  renderAll();
  toast("用户资料已保存");
});

document.querySelector("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!firebaseUser) return toast("请先使用 Google 登录");
  const formEl = event.currentTarget;
  const user = currentUser();
  const inviteCode = inviteCodeFromInput(new FormData(formEl).get("inviteCode"));
  if (!inviteCode) return toast("请输入推荐码");
  if (user.referrerId) return toast("你已经绑定推荐人，不能更换");
  const inviteSnapshot = await getDoc(doc(db, INVITE_COLLECTION, inviteCode));
  if (!inviteSnapshot.exists()) return toast("推荐码不存在或尚未同步");
  const invite = inviteSnapshot.data();
  if (invite.userId === user.id) return toast("不能绑定自己");
  if (invite.frozen) return toast("推荐人账号暂不可绑定");
  user.referrerId = invite.userId;
  state.referrals = referralDocsForState(state);
  await saveState();
  formEl.reset();
  renderAll();
  toast("推荐人已绑定");
});

document.querySelector("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAdmin()) return;
  const form = new FormData(event.currentTarget);
  const data = planFromForm(form);
  if (!data.name || data.amount <= 0 || data.validDays <= 0) return toast("请填写完整配套资料");
  const wasEditing = Boolean(editingPlanId);
  if (editingPlanId) {
    const plan = findPlan(editingPlanId);
    if (!plan) return toast("找不到要编辑的配套");
    Object.assign(plan, data);
    addAdminLog("编辑配套", plan.name, `金额 ${plan.amount} / 积分 ${plan.points}`);
  } else {
    state.plans.push({ id: id("plan"), ...data });
    addAdminLog("新增配套", data.name, `金额 ${data.amount} / 积分 ${data.points}`);
  }
  resetPlanForm();
  await saveState();
  renderAll();
  toast(wasEditing ? "配套规则已保存" : "配套规则已新增");
});

document.addEventListener("click", (event) => {
  if (event.target?.id !== "cancelPlanEditBtn") return;
  resetPlanForm();
  toast("已取消编辑");
});

document.querySelector("#pointsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAdmin()) return;
  const form = new FormData(event.currentTarget);
  const user = findUser(form.get("userId"));
  const change = Number(form.get("points"));
  user.points += change;
  state.pointLogs.push({ id: id("log"), userId: user.id, change, balance: user.points, source: "admin", note: form.get("note").trim(), createdAt: new Date().toISOString() });
  addAdminLog("调整积分", user.name, `变动 ${change}，备注：${form.get("note").trim()}`);
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("积分已调整");
});

document.querySelector("#repeatCreditsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAdmin()) return;
  const form = new FormData(event.currentTarget);
  const user = findUser(form.get("userId"));
  const change = Number(form.get("credits"));
  if (!user || Number.isNaN(change)) return toast("复购资格调整无效");
  const before = Number(user.repeatCredits || 0);
  user.repeatCredits = Math.max(before + change, 0);
  if (user.repeatCredits > 0 && before <= 0) {
    user.repeatCreditQueueAt = new Date().toISOString();
  }
  if (user.repeatCredits <= 0) {
    user.repeatCreditQueueAt = "";
  }
  addAdminLog("调整复购资格", user.name, `变动 ${change}，当前 ${user.repeatCredits}，备注：${form.get("note").trim()}`);
  addRepeatCreditLog(state, user.id, user.repeatCredits - before, user.repeatCredits, "admin", "admin", form.get("note").trim());
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("复购资格已调整");
});

document.querySelector("#withdrawForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = currentUser();
  const form = new FormData(event.currentTarget);
  const amount = Number(form.get("amount"));
  const method = form.get("method").trim() || user.withdrawMethod || "";
  const account = form.get("account").trim() || user.withdrawAccount || "";
  const eligibility = withdrawEligibility(user);
  if (!eligibility.eligible) return toast(`暂不能提现：${eligibility.reasons.join("、")}`);
  if (amount < MIN_WITHDRAW_AMOUNT) return toast(`最低提现金额为 ${money(MIN_WITHDRAW_AMOUNT)}`);
  if (amount > eligibility.available) return toast("可提现奖励不足");
  if (!method || !account) return toast("请先填写收款方式和收款账号");
  if (amount > confirmedAvailable(user.id)) return toast("可提现奖励不足");
  const cooldown = withdrawCooldownRemaining(user.id);
  if (cooldown > 0) return toast(`提现冷却中，请 ${durationText(cooldown)} 后再申请`);
  state.withdraws.push({ id: id("wd"), userId: user.id, amount, method, account, source: "reward", status: "pending", createdAt: new Date().toISOString() });
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("提现申请已提交，等待后台审核");
});

document.querySelector("#confirmDueBtn").addEventListener("click", async () => {
  if (!requireAdmin()) return;
  let count = 0;
  const now = new Date();
  state.rewards.forEach((reward) => {
    if (Array.isArray(reward.releasePlan) && ["pending", "releasing"].includes(reward.status) && releaseDueRewardParts(reward, now)) {
      count += 1;
      addAdminLog("释放分期奖励", reward.orderId, `已释放 ${money(reward.releasedAmount || 0)} / ${money(reward.amount)}`);
      return;
    }
    if (!Array.isArray(reward.releasePlan) && reward.status === "pending" && new Date(reward.confirmAfter) <= now) {
      reward.status = "confirmed";
      count += 1;
      addAdminLog("确认到期奖励", reward.orderId, `奖励 ${money(reward.amount)}`);
    }
  });
  await saveState();
  renderAll();
  toast(count ? `已确认 ${count} 笔奖励` : "暂无到期可确认奖励");
});

document.body.addEventListener("click", async (event) => {
  const orderDetail = event.target.closest("[data-order-detail]");
  if (orderDetail) {
    if (!requireAdmin()) return;
    const order = state.orders.find((item) => item.id === orderDetail.dataset.orderDetail);
    if (!order) return toast("找不到订单");
    window.alert(orderDetailText(order));
    return;
  }

  const withdrawDetail = event.target.closest("[data-withdraw-detail]");
  if (withdrawDetail) {
    if (!requireAdmin()) return;
    const withdraw = state.withdraws.find((item) => item.id === withdrawDetail.dataset.withdrawDetail);
    if (!withdraw) return toast("找不到提现申请");
    window.alert(withdrawDetailText(withdraw));
    return;
  }

  const userDetail = event.target.closest("[data-user-detail]");
  if (userDetail) {
    if (!requireAdmin()) return;
    const user = findUser(userDetail.dataset.userDetail);
    if (!user) return toast("找不到用户");
    window.alert(userDetailText(user));
    return;
  }

  const editPlan = event.target.closest("[data-edit-plan]");
  if (editPlan) {
    if (!requireAdmin()) return;
    const plan = findPlan(editPlan.dataset.editPlan);
    if (!plan) return toast("找不到配套");
    editingPlanId = plan.id;
    fillPlanForm(plan);
    toast("正在编辑配套");
    return;
  }

  const deletePlan = event.target.closest("[data-delete-plan]");
  if (deletePlan) {
    if (!requireAdmin()) return;
    const plan = findPlan(deletePlan.dataset.deletePlan);
    if (!plan) return toast("找不到配套");
    if (planUsed(plan.id)) return toast("已有订单使用这个配套，不能删除");
    if (!window.confirm(`确定删除配套：${plan.name}？`)) return;
    state.plans = state.plans.filter((item) => item.id !== plan.id);
    if (editingPlanId === plan.id) resetPlanForm();
    addAdminLog("删除配套", plan.name, `金额 ${plan.amount}`);
    await saveState();
    renderAll();
    toast("配套已删除");
    return;
  }

  const copyInviteCode = event.target.closest("[data-copy-invite-code]");
  if (copyInviteCode) {
    await navigator.clipboard.writeText(copyInviteCode.dataset.copyInviteCode);
    toast("推荐码已复制");
    return;
  }

  const retryProof = event.target.closest("[data-retry-proof]");
  if (retryProof) {
    if (!firebaseUser) return toast("请先使用 Google 登录");
    const order = state.orders.find((item) => item.id === retryProof.dataset.retryProof && item.userId === currentUser().id);
    if (!order || order.status !== "pending") return toast("只有待确认订单可以补传凭证");
    const proofFile = document.querySelector("#paymentInfoForm [name='paymentProof']").files[0];
    if (!proofFile) return toast("请先在付款资料选择付款证明文件");
    try {
      toast("正在补传付款证明...");
      Object.assign(order, await uploadPaymentProofForOrder(proofFile, order.id));
      await saveState();
      renderAll();
      toast("付款证明已补传");
    } catch (error) {
      order.proofName = proofFile.name;
      order.proofStatus = "failed";
      order.proofError = uploadErrorMessage(error);
      await saveState();
      renderAll();
      toast(uploadErrorMessage(error));
    }
    return;
  }

  const buyPlan = event.target.closest("[data-buy-plan]");
  if (buyPlan) {
    if (!firebaseUser) return toast("请先使用 Google 登录");
    const paymentForm = new FormData(document.querySelector("#paymentInfoForm"));
    const paymentInfo = {
      method: paymentForm.get("paymentMethod"),
      ref: paymentForm.get("paymentRef").trim(),
      note: paymentForm.get("paymentNote").trim(),
    };
    if (!paymentInfo.ref) return toast("请先填写付款参考号");
    const user = currentUser();
    const duplicateRefOrder = duplicatePaymentRef(paymentInfo.ref, user.id);
    if (duplicateRefOrder && !window.confirm(`付款参考号已在订单 ${duplicateRefOrder.id} 使用过。\n\n如果这是同一笔付款，请不要重复申请；如果确认是新付款，点“确定”继续。`)) return;
    const orderType = actualOrderType(state, user.id);
    if (orderType === "repeat" && repeatCooldownRemaining(user) > 0) {
      return toast(`复购冷却中，请 ${repeatCooldownText(user)} 后再申请`);
    }
    if (orderType === "repeat" && state.orders.some((order) => order.userId === user.id && order.type === "repeat" && order.status === "pending")) {
      return toast("你已有待确认的复购订单，请先等待后台处理");
    }
    toast("正在提交配套申请...");
    const order = createOrder(state, user.id, buyPlan.dataset.buyPlan, orderType, "pending", new Date().toISOString(), paymentInfo);
    const proofFile = document.querySelector("#paymentInfoForm [name='paymentProof']").files[0];
    if (proofFile) {
      const duplicateProofOrder = duplicateProofName(proofFile.name, user.id);
      if (duplicateProofOrder && !window.confirm(`付款凭证文件名已在订单 ${duplicateProofOrder.id} 使用过。\n\n请确认不是重复上传同一张凭证。确定继续提交吗？`)) {
        state.orders = state.orders.filter((item) => item.id !== order.id);
        renderAll();
        return;
      }
      try {
        toast("正在上传付款证明...");
        Object.assign(order, await uploadPaymentProofForOrder(proofFile, order.id));
      } catch (error) {
        console.warn("Payment proof upload skipped.", error);
        order.proofName = proofFile.name;
        order.proofStatus = "failed";
        order.proofError = uploadErrorMessage(error);
        order.paymentNote = `${order.paymentNote || ""} / 付款证明暂未上传：${uploadErrorMessage(error)}`.trim();
        toast(uploadErrorMessage(error));
      }
    }
    await saveState();
    renderAll();
    toast("配套申请已提交，等待后台确认付款");
    return;
  }

  if (event.target.closest("#copyInviteBtn")) {
    await navigator.clipboard.writeText(document.querySelector("#inviteLink").textContent);
    toast("推荐链接已复制");
    return;
  }

  const confirmOrder = event.target.closest("[data-confirm-order]");
  if (confirmOrder) {
    if (!requireAdmin()) return;
    const order = state.orders.find((item) => item.id === confirmOrder.dataset.confirmOrder);
    if (!order || order.status !== "pending") return toast("订单状态不可确认");
    if (!window.confirm(orderConfirmPreview(order))) return;
    const note = window.prompt("请输入确认付款备注（可留空）", order.reviewNote || "");
    if (note === null) return;
    order.reviewNote = note.trim();
    order.reviewedAt = new Date().toISOString();
    try {
      await callConfirmOrderFunction(order.id);
      state = await loadState();
      const syncedOrder = state.orders.find((item) => item.id === order.id);
      if (syncedOrder) {
        syncedOrder.reviewNote = order.reviewNote;
        syncedOrder.reviewedAt = order.reviewedAt;
        await saveState();
      }
      renderAll();
      toast("订单已由云函数确认，积分和奖励已生成");
    } catch (error) {
      console.error(error);
      applyPaidOrder(state, order);
      addAdminLog("确认付款", order.id, `金额 ${money(order.amount)} / 前端管理员确认 / ${order.reviewNote || "无备注"}`);
      await saveState();
      renderAll();
      toast("云函数未启用，已使用管理员前端确认付款");
    }
    return;
  }

  const cancelOrder = event.target.closest("[data-cancel-order]");
  if (cancelOrder) {
    if (!requireAdmin()) return;
    const order = state.orders.find((item) => item.id === cancelOrder.dataset.cancelOrder);
    if (!order || order.status !== "pending") return toast("订单状态不可取消");
    const note = window.prompt("请输入取消订单原因（可留空）", order.reviewNote || "");
    if (note === null) return;
    order.status = "cancelled";
    order.reviewNote = note.trim();
    order.cancelledAt = new Date().toISOString();
    addAdminLog("取消订单", order.id, `金额 ${money(order.amount)} / ${order.reviewNote || "无备注"}`);
    await saveState();
    renderAll();
    toast("订单已取消");
    return;
  }

  const recalcOrder = event.target.closest("[data-recalc-order]");
  if (recalcOrder) {
    if (!requireAdmin()) return;
    const order = state.orders.find((item) => item.id === recalcOrder.dataset.recalcOrder);
    if (!order) return toast("找不到订单");
    if (!window.confirm(`确定重算订单奖励：${order.id}？\n只会处理待确认奖励，已确认/已释放奖励不会自动改动。`)) return;
    const result = recalculateOrderRewards(state, order);
    if (!result.ok) return toast(result.message);
    addAdminLog("重算订单奖励", order.id, result.message);
    await saveState();
    renderAll();
    toast(result.message);
    return;
  }

  const freezeUser = event.target.closest("[data-freeze-user]");
  if (freezeUser) {
    if (!requireAdmin()) return;
    const user = findUser(freezeUser.dataset.freezeUser);
    user.frozen = !user.frozen;
    addAdminLog(user.frozen ? "冻结用户" : "解冻用户", user.name, user.account);
    await saveState();
    renderAll();
    toast(user.frozen ? "用户已冻结" : "用户已解冻");
    return;
  }

  const rewardAction = event.target.closest("[data-confirm-reward], [data-cancel-reward], [data-freeze-reward]");
  if (rewardAction) {
    if (!requireAdmin()) return;
    const rewardId = rewardAction.dataset.confirmReward || rewardAction.dataset.cancelReward || rewardAction.dataset.freezeReward;
    const reward = state.rewards.find((item) => item.id === rewardId);
    const actionLabel = rewardAction.dataset.confirmReward ? "确认" : rewardAction.dataset.cancelReward ? "取消" : "冻结";
    const note = window.prompt(`请输入奖励${actionLabel}备注（可留空）`, reward.reviewNote || "");
    if (note === null) return;
    if (rewardAction.dataset.confirmReward) {
      if (Array.isArray(reward.releasePlan)) {
        releaseDueRewardParts(reward);
      } else {
        reward.status = "confirmed";
      }
    }
    if (rewardAction.dataset.cancelReward) reward.status = "cancelled";
    if (rewardAction.dataset.freezeReward) reward.status = "frozen";
    reward.reviewNote = note.trim();
    reward.reviewedAt = new Date().toISOString();
    addAdminLog("更新奖励状态", reward.orderId, `${actionLabel} / ${reward.status} / ${money(reward.amount)} / ${reward.reviewNote || "无备注"}`);
    await saveState();
    renderAll();
    toast("奖励状态已更新");
    return;
  }

  const withdrawAction = event.target.closest("[data-approve-withdraw], [data-reject-withdraw], [data-pay-withdraw]");
  if (withdrawAction) {
    if (!requireAdmin()) return;
    const withdrawId = withdrawAction.dataset.approveWithdraw || withdrawAction.dataset.rejectWithdraw || withdrawAction.dataset.payWithdraw;
    const withdraw = state.withdraws.find((item) => item.id === withdrawId);
    const actionLabel = withdrawAction.dataset.approveWithdraw ? "通过" : withdrawAction.dataset.rejectWithdraw ? "拒绝" : "标记打款";
    const note = window.prompt(`请输入提现${actionLabel}备注（可留空）`, withdraw.reviewNote || "");
    if (note === null) return;
    if (withdrawAction.dataset.approveWithdraw) {
      withdraw.status = "approved";
      withdraw.reviewedAt = new Date().toISOString();
    }
    if (withdrawAction.dataset.rejectWithdraw) {
      withdraw.status = "rejected";
      withdraw.reviewedAt = new Date().toISOString();
    }
    if (withdrawAction.dataset.payWithdraw) {
      withdraw.status = "paidout";
      withdraw.paidAt = new Date().toISOString();
    }
    withdraw.reviewNote = note.trim();
    addAdminLog("更新提现状态", withdraw.id, `${actionLabel} / ${money(withdraw.amount)} / ${withdraw.reviewNote || "无备注"}`);
    await saveState();
    renderAll();
    toast("提现状态已更新");
  }
});

document.querySelector("#exportBtn").addEventListener("click", () => {
  if (!requireAdmin()) return;
  exportBundle();
  toast("完整备份包已导出");
});

document.querySelector("#exportRiskReportBtn")?.addEventListener("click", async () => {
  if (!requireAdmin()) return;
  exportRiskReport();
  addAdminLog("导出异常报告", "风控规则", "导出上线自检与数据一致性报告");
  await saveState();
  renderAll();
  toast("异常报告已导出");
});

document.querySelector("#resetBtn").addEventListener("click", async () => {
  if (!requireAdmin()) return;
  const answer = window.prompt("危险操作：这会重置演示数据。系统会先导出备份包。\n\n如果确定继续，请输入 RESET");
  if (answer !== "RESET") {
    toast("已取消重置");
    return;
  }
  exportBundle();
  state = createSeedData();
  addAdminLog("重置演示数据", "系统", "已重置为种子数据；重置前已触发备份包下载");
  await saveState();
  renderAll();
  toast("演示数据已重置，重置前备份包已下载");
});

onAuthStateChanged(auth, async (user) => {
  firebaseUser = user;
  firebaseReady = true;
  renderAll();
  if (!state) state = await loadState();
  if (user) {
    try {
      state = await loadState();
      cloudAvailable = true;
    } catch (error) {
      console.warn("Could not reload cloud state after login.", error);
      syncMessage = `Firestore：读取失败 ${error.code || error.name || "unknown"} - ${error.message || ""}`;
    }
    upsertFirebaseUser(user);
    await saveState();
  }
  renderAll();
});

setAuthStatusText("脚本已加载，正在等待 Firebase 登录状态...");
setSyncStatusText("Firestore：等待登录后检测");

state = localStorage.getItem(STORAGE_KEY) ? JSON.parse(localStorage.getItem(STORAGE_KEY)) : createSeedData();
renderAll();

setTimeout(() => {
  if (!firebaseReady) {
    setAuthStatusText("Firebase 登录状态未返回，请强制刷新或检查浏览器缓存。");
    setSyncStatusText("Firestore：尚未开始检测");
  }
}, 5000);




