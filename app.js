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

window.addEventListener("error", (event) => {
  const status = document.querySelector("#authStatus");
  if (status) status.textContent = `脚本错误：${event.message}`;
});

window.addEventListener("unhandledrejection", (event) => {
  const status = document.querySelector("#authStatus");
  const message = event.reason?.message || event.reason?.code || "未知异步错误";
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
      await Promise.all([
        setDoc(userRef, { ...userSelfProfileForCloud(user, !userExists), updatedAt: serverTimestamp() }, { merge: true }),
        ...cloudState.orders.filter((order) => order.userId === firebaseUser.uid && order.status === "pending").map((order) =>
          setDoc(doc(db, ORDER_COLLECTION, order.id), { ...order, updatedAt: serverTimestamp() }, { merge: true })
        ),
        ...cloudState.withdraws.filter((withdraw) => withdraw.userId === firebaseUser.uid && withdraw.status === "pending").map((withdraw) =>
          setDoc(doc(db, WITHDRAW_COLLECTION, withdraw.id), { ...withdraw, updatedAt: serverTimestamp() }, { merge: true })
        ),
        ...cloudState.invites.filter((invite) => invite.userId === firebaseUser.uid).map((invite) =>
          setDoc(doc(db, INVITE_COLLECTION, invite.id), { ...invite, updatedAt: serverTimestamp() }, { merge: true })
        ),
        ...cloudState.referrals.filter((referral) => referral.inviteeId === firebaseUser.uid).map((referral) =>
          setDoc(doc(db, REFERRAL_COLLECTION, referral.id), { ...referral, updatedAt: serverTimestamp() }, { merge: true })
        ),
      ]);
    }
    cloudAvailable = true;
    syncMessage = `Firestore：保存成功 ${new Date().toLocaleTimeString("zh-CN")}`;
  } catch (error) {
    cloudAvailable = false;
    console.warn("Firestore save failed, fallback remains local.", error);
    syncMessage = `Firestore：保存失败 ${error.code || error.name || "unknown"} - ${error.message || ""}`;
    toast(`Firestore 保存失败：${error.code || "unknown"}`);
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
  const localPendingOrders = (localState.orders || [])
    .filter((order) => order.userId === userId && order.status === "pending");
  const localPendingWithdraws = (localState.withdraws || [])
    .filter((withdraw) => withdraw.userId === userId && withdraw.status === "pending");
  const localUser = (localState.users || []).find((user) => user.id === userId);
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

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
}

function orderNo(data = state) {
  const ymd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `R${ymd}${String(data.orders.length + 1).padStart(4, "0")}`;
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
  const confirmed = state.rewards
    .filter((reward) => reward.userId === userId && ["confirmed", "releasing"].includes(reward.status))
    .reduce((sum, reward) => sum + (Array.isArray(reward.releasePlan) ? Number(reward.releasedAmount || 0) : Number(reward.amount || 0)), 0);
  const requested = state.withdraws
    .filter((item) => item.userId === userId && item.status !== "rejected")
    .reduce((sum, item) => sum + item.amount, 0);
  return Math.max(confirmed - requested, 0);
}

function withdrawEligibility(user) {
  const available = confirmedAvailable(user.id);
  const reasons = [];
  if (user.frozen) reasons.push("账户已冻结");
  if (!isActivePackage(user)) reasons.push("需要有效配套");
  if (available < MIN_WITHDRAW_AMOUNT) reasons.push(`可提现余额需满 ${money(MIN_WITHDRAW_AMOUNT)}`);
  return {
    available,
    eligible: reasons.length === 0,
    reasons,
  };
}

function createOrder(data, userId, planId, type, status = "paid", createdAt = new Date().toISOString(), paymentInfo = {}) {
  const user = data.users.find((item) => item.id === userId);
  const plan = data.plans.find((item) => item.id === planId);
  if (!user || !plan) return null;
  const order = {
    id: orderNo(data),
    userId,
    planId,
    type,
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

function orderConfirmPreview(order) {
  const user = findUser(order.userId);
  const plan = findPlan(order.planId);
  if (!user || !plan) return "订单资料不完整，仍要继续确认吗？";
  const lines = [
    `确认订单：${order.id}`,
    `用户：${user.name} / ${user.account}`,
    `配套：${plan.name}，金额 ${money(order.amount)}`,
    `积分：+${points(plan.points)}`,
  ];
  if (order.type === "repeat") {
    const receiver = nextRepeatReceiver(state, user.id);
    const reward = +(order.amount * (Number(plan.repeatRate || 0) / 100)).toFixed(2);
    lines.push(`复购资格：买家 +${planRepeatCredits(plan)} 个`);
    lines.push(`复购冷却：${planRepeatCooldownHours(plan)} 小时`);
    lines.push(receiver ? `资格池奖励：${receiver.name} 将扣 1 个资格，奖励 ${money(reward)} 分 ${REPEAT_RELEASE_DAYS.length} 期释放` : "资格池奖励：目前没有可接收资格池奖励的用户");
  } else {
    const referrer = findUser(user.referrerId);
    const reward = +(order.amount * (Number(plan.firstRate || 0) / 100)).toFixed(2);
    lines.push(referrer ? `首充奖励：${referrer.name} 预计获得 ${money(reward)}` : "首充奖励：没有绑定推荐人");
  }
  lines.push("确定要确认付款吗？");
  return lines.join("\n");
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
    user.firebaseUid = googleUser.uid;
    user.name = googleUser.displayName || user.name;
    user.account = account;
    user.phone = user.phone || "";
    user.photoURL = googleUser.photoURL || user.photoURL || "";
    user.withdrawMethod = user.withdrawMethod || "";
    user.withdrawAccount = user.withdrawAccount || "";
    user.inviteCode = normalizeInviteCode(user.inviteCode);
  }
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
  document.querySelector("#memberSlots").textContent = `${Math.max((user.slots || 0) - used, 0)} / ${user.slots || 0}`;
  document.querySelector("#memberRepeatCredits").textContent = points(user.repeatCredits || 0);
  document.querySelector("#memberPlanStatus").textContent = statusLabel;
  document.querySelector("#memberPlanStatus").className = `tag ${statusClass}`;
  document.querySelector("#inviteLink").textContent = inviteLink;
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
      ? `提现条件已满足：当前可提现 ${money(eligibility.available)}。`
      : `提现条件未满足：${eligibility.reasons.join("、")}。当前可提现 ${money(eligibility.available)}。`;
  }
  const submitButton = withdrawForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = !eligibility.eligible;
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
  document.querySelector("#memberPlanCards").innerHTML = state.plans.map((plan) => `
    <article class="plan-card">
      <strong>${plan.name} · ${money(plan.amount)}</strong>
      <span>发放积分：${points(plan.points)}</span>
      <span>推荐权限：${plan.slots} 人 / 有效期：${plan.validDays} 天</span>
      <span>复购后获得资格：${planRepeatCredits(plan)} 个 / 冷却：${planRepeatCooldownHours(plan)} 小时 / 资格复购奖励：${plan.repeatRate}%</span>
      <span>首充推荐奖励：${plan.firstRate}%</span>
      <button class="button primary" data-buy-plan="${plan.id}" data-buy-type="${user.packageUntil ? "repeat" : "first"}">申请充值配套</button>
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
  const rows = state.withdraws.filter((item) => item.userId === user.id).slice().reverse().map((item) => `<tr><td>${item.id}</td><td>${money(item.amount)}</td><td>${item.method}</td><td>${item.account}</td><td><span class="tag ${item.status}">${labelStatus(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td></tr>`).join("");
  document.querySelector("#memberWithdrawTable").innerHTML = rows || `<tr><td colspan="6">暂无提现记录</td></tr>`;
}

function renderAdmin() {
  document.querySelector("#metricUsers").textContent = state.users.length;
  document.querySelector("#metricSales").textContent = money(state.orders.filter((order) => order.status === "paid").reduce((sum, order) => sum + order.amount, 0));
  document.querySelector("#metricPendingRewards").textContent = money(state.rewards.filter((reward) => ["pending", "releasing"].includes(reward.status)).reduce((sum, reward) => sum + (Number(reward.amount || 0) - Number(reward.releasedAmount || 0)), 0));
  document.querySelector("#metricWithdraws").textContent = money(state.withdraws.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.amount, 0));
  ensurePlanCooldownField();
  ensureRewardStatusOptions();
  renderAdminPlans();
  renderAdminUsers();
  renderRepeatCreditLogs();
  renderAdminOrders();
  renderAdminRewards();
  renderAdminWithdraws();
  renderAdminRiskRules();
  renderAdminLogs();
}

function ensureRewardStatusOptions() {
  const select = document.querySelector("#rewardStatusFilter");
  if (!select || select.querySelector("option[value='releasing']")) return;
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

function renderAdminPlans() {
  document.querySelector("#adminPlanList").innerHTML = state.plans.map((plan) => `
    <article class="plan-card">
      <strong>${plan.name} · ${money(plan.amount)}</strong>
      <span>积分 ${points(plan.points)} / 推荐名额 ${plan.slots} / 复购资格 ${planRepeatCredits(plan)} 个</span>
      <span>冷却 ${planRepeatCooldownHours(plan)} 小时 / 有效期 ${plan.validDays} 天 / 首充 ${plan.firstRate}% / 资格复购 ${plan.repeatRate}%</span>
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
    return `<tr><td>${user.name}</td><td>${user.account}</td><td>${user.phone || "-"}</td><td>${user.inviteCode}</td><td>${referrer?.name || "无"}</td><td>${points(user.points)}</td><td><span class="tag ${statusClass}">${statusLabel}</span></td><td>${directReferralCount(user.id)} / ${user.slots || 0}</td><td>${points(user.repeatCredits || 0)}</td><td><span class="tag ${user.frozen ? "frozen" : "active"}">${user.frozen ? "已冻结" : "正常"}</span></td><td><button class="link" data-freeze-user="${user.id}">${user.frozen ? "解冻" : "冻结"}</button></td></tr>`;
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
    const actions = order.status === "pending"
      ? `<button class="link" data-confirm-order="${order.id}">确认付款</button><button class="link" data-cancel-order="${order.id}">取消订单</button>`
      : "";
    const proofHref = order.proofUrl || order.proofInlineData || "";
    const proofLink = proofHref ? ` / <a class="link" href="${proofHref}" target="_blank" rel="noopener">查看凭证</a>` : "";
    const proofText = ` / ${proofStatusText(order)}`;
    const paymentText = `${paymentMethodText(order.paymentMethod)} ${order.paymentRef || ""}${order.paymentNote ? ` / ${order.paymentNote}` : ""}${proofText}${proofLink}`.trim() || "-";
    return `<tr><td>${order.id}</td><td>${user?.name || "-"}</td><td>${plan?.name || "-"}</td><td>${order.type === "first" ? "首充" : "复购"}</td><td>${money(order.amount)}</td><td>${paymentText}</td><td>${points(order.points)}</td><td><span class="tag ${order.status}">${labelStatus(order.status)}</span></td><td>${new Date(order.createdAt).toLocaleString("zh-CN")}</td><td class="actions">${actions}</td></tr>`;
  }).join("");
  document.querySelector("#adminOrderTable").innerHTML = rows || `<tr><td colspan="10">没有符合条件的订单</td></tr>`;
}

function renderAdminRewards() {
  const rewards = filteredRewards();
  const rows = rewards.slice().reverse().map((reward) => {
    const user = findUser(reward.userId);
    const sourceUser = findUser(reward.sourceUserId);
    const canConfirm = ["pending", "releasing"].includes(reward.status) && new Date(reward.confirmAfter) <= new Date();
    return `<tr><td>${user?.name || "-"}</td><td>${sourceUser?.name || "-"}</td><td>${reward.orderId}</td><td>${reward.type === "first" ? "首充" : "复购"}</td><td>${rewardAmountText(reward)}</td><td><span class="tag ${reward.status}">${labelStatus(reward.status)}</span></td><td>${rewardNextDateText(reward)}</td><td class="actions">${canConfirm ? `<button class="link" data-confirm-reward="${reward.id}">确认</button>` : ""}${["pending", "releasing"].includes(reward.status) ? `<button class="link" data-cancel-reward="${reward.id}">取消</button><button class="link" data-freeze-reward="${reward.id}">冻结</button>` : ""}</td></tr>`;
  }).join("");
  document.querySelector("#adminRewardTable").innerHTML = rows || `<tr><td colspan="8">没有符合条件的奖励</td></tr>`;
}

function renderAdminWithdraws() {
  const withdraws = filteredWithdraws();
  const rows = withdraws.slice().reverse().map((item) => {
    const user = findUser(item.userId);
    return `<tr><td>${item.id}</td><td>${user?.name || "-"}</td><td>${money(item.amount)}</td><td>${item.method}</td><td>${item.account}</td><td><span class="tag ${item.status}">${labelStatus(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td><td class="actions">${item.status === "pending" ? `<button class="link" data-approve-withdraw="${item.id}">通过</button><button class="link" data-reject-withdraw="${item.id}">拒绝</button>` : ""}${item.status === "approved" ? `<button class="link" data-pay-withdraw="${item.id}">标记打款</button>` : ""}</td></tr>`;
  }).join("");
  document.querySelector("#adminWithdrawTable").innerHTML = rows || `<tr><td colspan="8">没有符合条件的提现申请</td></tr>`;
}

function renderAdminRiskRules() {
  const target = document.querySelector("#riskRuleCards");
  if (!target) return;
  const planCooldowns = state.plans.map((plan) => `${plan.name}: ${planRepeatCooldownHours(plan)} 小时`).join(" / ");
  target.innerHTML = [
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
      title: "提现触发条件",
      rows: [
        `最低提现金额：${money(MIN_WITHDRAW_AMOUNT)}。`,
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
    ].join(" ").toLowerCase();
    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;
    const matchesType = typeFilter === "all" || order.type === typeFilter;
    return matchesKeyword && matchesStatus && matchesType;
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
    const matchesStatus = statusFilter === "all" || reward.status === statusFilter;
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

function renderAll() {
  if (!state) return;
  updateAuthStatusClean();
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

document.querySelectorAll(".tabs").forEach((tabs) => {
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    const view = button.closest(".view");
    view.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    view.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    view.querySelector(`#${button.dataset.tab}`).classList.add("active");
  });
});

["#orderStatusFilter", "#orderTypeFilter", "#rewardStatusFilter", "#rewardTypeFilter", "#withdrawStatusFilter", "#userPackageFilter", "#userAccountFilter", "#logActionFilter", "#logLimitFilter"].forEach((selector) => {
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
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (typeFilter) typeFilter.value = "all";
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
    `amsystem-users-${new Date().toISOString().slice(0, 10)}.csv`,
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
    `amsystem-repeat-credit-logs-${new Date().toISOString().slice(0, 10)}.csv`,
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
    `amsystem-orders-${new Date().toISOString().slice(0, 10)}.csv`,
    ["订单号", "用户", "配套", "类型", "金额", "付款方式", "付款参考号", "状态", "时间"],
    filteredOrders().map((order) => {
      const user = findUser(order.userId);
      const plan = findPlan(order.planId);
      return [order.id, user?.name || "", plan?.name || "", order.type, order.amount, paymentMethodText(order.paymentMethod), order.paymentRef || "", labelStatus(order.status), order.createdAt];
    })
  );
});

document.querySelector("#exportRewardsBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-rewards-${new Date().toISOString().slice(0, 10)}.csv`,
    ["奖励ID", "奖励人", "来源用户", "订单", "类型", "比例", "金额", "状态", "可确认日"],
    filteredRewards().map((reward) => {
      const user = findUser(reward.userId);
      const sourceUser = findUser(reward.sourceUserId);
      return [reward.id, user?.name || "", sourceUser?.name || "", reward.orderId, rewardTypeText(reward), reward.rate, rewardAmountText(reward), labelStatus(reward.status), rewardNextDateText(reward)];
    })
  );
});

document.querySelector("#exportWithdrawsBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-withdraws-${new Date().toISOString().slice(0, 10)}.csv`,
    ["提现ID", "用户", "金额", "方式", "账号", "状态", "时间"],
    filteredWithdraws().map((item) => {
      const user = findUser(item.userId);
      return [item.id, user?.name || "", item.amount, item.method, item.account, labelStatus(item.status), item.createdAt];
    })
  );
});

document.querySelector("#exportLogsBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-admin-logs-${new Date().toISOString().slice(0, 10)}.csv`,
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
  const user = currentUser();
  const inviteCode = normalizeInviteCode(new FormData(event.currentTarget).get("inviteCode"));
  if (!inviteCode) return toast("请输入推荐码");
  if (user.referrerId) return toast("你已经绑定推荐人，不能更换");
  const inviteSnapshot = await getDoc(doc(db, INVITE_COLLECTION, inviteCode));
  if (!inviteSnapshot.exists()) return toast("推荐码不存在或尚未同步");
  const invite = inviteSnapshot.data();
  if (invite.userId === user.id) return toast("不能绑定自己");
  if (invite.frozen) return toast("推荐人账号暂不可绑定");
  user.referrerId = invite.userId;
  state.referrals = referralDocsForState(state);
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("推荐人已绑定");
});

document.querySelector("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAdmin()) return;
  const form = new FormData(event.currentTarget);
  state.plans.push({
    id: id("plan"),
    name: form.get("name").trim(),
    amount: Number(form.get("amount")),
    points: Number(form.get("points")),
    slots: Number(form.get("slots")),
    repeatCredits: Number(form.get("repeatCredits")),
    repeatCooldownHours: Number(form.get("repeatCooldownHours") || 24),
    validDays: Number(form.get("validDays")),
    firstRate: Number(form.get("firstRate")),
    repeatRate: Number(form.get("repeatRate")),
  });
  addAdminLog("新增配套", form.get("name").trim(), `金额 ${form.get("amount")} / 积分 ${form.get("points")}`);
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("配套规则已新增");
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
  state.withdraws.push({ id: id("wd"), userId: user.id, amount, method, account, status: "pending", createdAt: new Date().toISOString() });
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
    if (buyPlan.dataset.buyType === "repeat" && repeatCooldownRemaining(user) > 0) {
      return toast(`复购冷却中，请 ${repeatCooldownText(user)} 后再申请`);
    }
    if (buyPlan.dataset.buyType === "repeat" && state.orders.some((order) => order.userId === user.id && order.type === "repeat" && order.status === "pending")) {
      return toast("你已有待确认的复购订单，请先等待后台处理");
    }
    toast("正在提交配套申请...");
    const order = createOrder(state, user.id, buyPlan.dataset.buyPlan, buyPlan.dataset.buyType, "pending", new Date().toISOString(), paymentInfo);
    const proofFile = document.querySelector("#paymentInfoForm [name='paymentProof']").files[0];
    if (proofFile) {
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
    try {
      await callConfirmOrderFunction(order.id);
      state = await loadState();
      renderAll();
      toast("订单已由云函数确认，积分和奖励已生成");
    } catch (error) {
      console.error(error);
      applyPaidOrder(state, order);
      addAdminLog("确认付款", order.id, `金额 ${money(order.amount)} / 前端管理员确认`);
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
    order.status = "cancelled";
    addAdminLog("取消订单", order.id, `金额 ${money(order.amount)}`);
    await saveState();
    renderAll();
    toast("订单已取消");
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
    if (rewardAction.dataset.confirmReward) {
      if (Array.isArray(reward.releasePlan)) {
        releaseDueRewardParts(reward);
      } else {
        reward.status = "confirmed";
      }
    }
    if (rewardAction.dataset.cancelReward) reward.status = "cancelled";
    if (rewardAction.dataset.freezeReward) reward.status = "frozen";
    addAdminLog("更新奖励状态", reward.orderId, `${reward.status} / ${money(reward.amount)}`);
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
    if (withdrawAction.dataset.approveWithdraw) withdraw.status = "approved";
    if (withdrawAction.dataset.rejectWithdraw) withdraw.status = "rejected";
    if (withdrawAction.dataset.payWithdraw) withdraw.status = "paidout";
    addAdminLog("更新提现状态", withdraw.id, `${withdraw.status} / ${money(withdraw.amount)}`);
    await saveState();
    renderAll();
    toast("提现状态已更新");
  }
});

document.querySelector("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `amsystem-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#resetBtn").addEventListener("click", async () => {
  state = createSeedData();
  await saveState();
  renderAll();
  toast("演示数据已重置");
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




