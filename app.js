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
  deleteDoc,
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
const APP_VERSION = "20260630-70";
const PUBLIC_SITE_URL = "https://stunleyhoh001.github.io/simplesystem/";
const TEST_CHECKLIST_KEY = "amsystemTestChecklist";
const DEPLOY_CHECKLIST_KEY = "amsystemDeployChecklist";
const TEST_INSTANT_MODE = false;
const PACKAGE_UNIT_AMOUNT = 180;
const PACKAGE_UNIT_POINTS = 18000;
const MAX_REPEAT_POOL_CREDITS = 10;
const LEGACY_DEMO_INVITE_CODES = new Set(["LM1001", "WF1002", "CJ1003"]);
const LEGACY_DEMO_ACCOUNTS = new Set(["liming@example.com", "13800000002", "chenjie@example.com"]);
const WITHDRAW_COOLDOWN_HOURS = TEST_INSTANT_MODE ? 0 : 24;
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
const EXTERNAL_ORDER_COLLECTION = "amsystemExternalOrders";
const REVERSAL_CASE_COLLECTION = "amsystemReversalCases";
const CONFIRM_DAYS = TEST_INSTANT_MODE ? 0 : 7;
const REPEAT_RELEASE_DAYS = TEST_INSTANT_MODE ? [0] : [7, 14, 30];
const MIN_WITHDRAW_AMOUNT = 50;
const PROOF_UPLOAD_TIMEOUT_MS = 60000;
const PROOF_STORAGE_ATTEMPT_MS = 12000;
const INLINE_PROOF_MAX_BYTES = 750 * 1024;
const ADMIN_EMAILS = [
  "stanleyhoh79@gmail.com",
];
const TEST_CHECKLIST = [
  "管理员账号登录后，确认后台指标、待办中心、配套设置可正常显示。",
  "用户 A 登录，填写手机和默认收款资料，确认资料完整提示消失。",
  "用户 A 复制推荐链接或推荐码，用户 B 用另一个 Google 账号打开并绑定推荐人。",
  "用户 B 提交首充订单，后台确认付款后，B 获得积分和配套，A 获得 20% 推荐奖励。",
  "用户 B 再提交复购订单，确认付款后，A 获得 10% 下线复购奖励，奖励池接收人扣 1 个资格。",
  "准备一个有奖励池资格的用户，确认奖励池奖励会派发给排队最早且不是买家的人，金额为 10%，并扣 1 个资格。",
  "到期后测试奖励确认或分期释放，确认只有已释放奖励进入可提现余额。",
  "用户申请提现，后台通过并标记打款，导出订单/奖励/提现/异常报告核对金额。",
];
const DEPLOY_CHECKLIST = [
  "GitHub Pages 或 Firebase Hosting 已发布最新 index.html / app.js / styles.css。",
  "Firebase Authentication 已加入当前访问域名为授权域名。",
  "Firebase Console 已发布最新 firestore.rules。",
  "Firebase Console 已发布最新 storage.rules。",
  "使用普通用户账号测试 Google 登录成功。",
  "普通用户可提交充值订单并保存到 Firestore。",
  "普通用户可上传或暂存付款凭证。",
  "手机浏览器打开页面，用户界面和后台界面排版正常。",
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
const externalOrdersRef = collection(db, EXTERNAL_ORDER_COLLECTION);
const reversalCasesRef = collection(db, REVERSAL_CASE_COLLECTION);

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

function sanitizeHtml(markup) {
  const template = document.createElement("template");
  template.innerHTML = String(markup ?? "");
  template.content.querySelectorAll("script, style, iframe, object, embed, link, meta, base").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      const normalizedUrl = value.replace(/[\u0000-\u0020]+/g, "");
      if (
        name.startsWith("on")
        || name === "srcdoc"
        || name === "style"
        || (["href", "src", "action", "formaction", "xlink:href"].includes(name)
          && (
            normalizedUrl.startsWith("javascript:")
            || normalizedUrl.startsWith("vbscript:")
            || normalizedUrl.startsWith("data:text/html")
          ))
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return template.innerHTML;
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

function testChecklistState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEST_CHECKLIST_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveTestChecklistState(items) {
  localStorage.setItem(TEST_CHECKLIST_KEY, JSON.stringify(items || {}));
}

function checklistReport(items, checked) {
  const reportItems = items.map((text, index) => {
    const value = checked[String(index)];
    const done = typeof value === "object" ? Boolean(value.done) : Boolean(value);
    return {
      index: index + 1,
      text,
      done,
      completedAt: done && typeof value === "object" ? value.completedAt || "" : "",
    };
  });
  return {
    total: reportItems.length,
    done: reportItems.filter((item) => item.done).length,
    lastCompletedAt: reportItems
      .filter((item) => item.completedAt)
      .map((item) => item.completedAt)
      .sort()
      .at(-1) || "",
    items: reportItems,
  };
}

function testChecklistReport() {
  return checklistReport(TEST_CHECKLIST, testChecklistState());
}

function deployChecklistState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEPLOY_CHECKLIST_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDeployChecklistState(items) {
  localStorage.setItem(DEPLOY_CHECKLIST_KEY, JSON.stringify(items || {}));
}

function deployChecklistReport() {
  return checklistReport(DEPLOY_CHECKLIST, deployChecklistState());
}

function renderTestChecklistRows() {
  const report = testChecklistReport();
  const complete = report.done === report.total;
  return [
    `<span class="test-progress ${complete ? "complete" : "pending"}">${complete ? "实机测试已完成" : `完成 ${report.done} / ${report.total}`}${report.lastCompletedAt ? ` · 最后完成：${new Date(report.lastCompletedAt).toLocaleString("zh-CN")}` : ""}</span>`,
    ...report.items.map((item, index) => `
      <label class="test-check">
        <input type="checkbox" data-test-check="${index}" ${item.done ? "checked" : ""} />
        <span>${item.index}. ${item.text}${item.completedAt ? `<small>完成时间：${new Date(item.completedAt).toLocaleString("zh-CN")}</small>` : ""}</span>
      </label>
    `),
    `<span class="test-actions"><button class="link" type="button" id="exportTestChecklistBtn">导出测试清单</button><button class="link" type="button" id="resetTestChecklistBtn">重置测试清单</button></span>`,
  ];
}

function renderDeployChecklistRows() {
  const report = deployChecklistReport();
  const complete = report.done === report.total;
  return [
    `<span class="test-progress ${complete ? "complete" : "pending"}">${complete ? "部署检查已完成" : `完成 ${report.done} / ${report.total}`}${report.lastCompletedAt ? ` · 最后完成：${new Date(report.lastCompletedAt).toLocaleString("zh-CN")}` : ""}</span>`,
    ...report.items.map((item, index) => `
      <label class="test-check">
        <input type="checkbox" data-deploy-check="${index}" ${item.done ? "checked" : ""} />
        <span>${item.index}. ${item.text}${item.completedAt ? `<small>完成时间：${new Date(item.completedAt).toLocaleString("zh-CN")}</small>` : ""}</span>
      </label>
    `),
    `<span class="test-actions"><button class="link" type="button" id="exportDeployChecklistBtn">导出部署清单</button><button class="link" type="button" id="resetDeployChecklistBtn">重置部署清单</button></span>`,
  ];
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

function defaultAffiliatePlans() {
  return [
    { id: "plan_rm180", name: "RM180 单位配套", amount: 180, points: 18000, slots: 10, repeatCredits: 10, repeatCooldownHours: 0, validDays: 30, firstRate: 20, directRepeatRate: 10, repeatRate: 10 },
    { id: "plan_rm360", name: "RM360 双单位配套", amount: 360, points: 36000, slots: 20, repeatCredits: 10, repeatCooldownHours: 0, validDays: 30, firstRate: 20, directRepeatRate: 10, repeatRate: 10 },
    { id: "plan_rm720", name: "RM720 四单位配套", amount: 720, points: 72000, slots: 40, repeatCredits: 10, repeatCooldownHours: 0, validDays: 30, firstRate: 20, directRepeatRate: 10, repeatRate: 10 },
  ];
}

function createSeedData() {
  return {
    currentUserId: "",
    testDataClearedAt: new Date().toISOString(),
    plans: defaultAffiliatePlans(),
    users: [],
    orders: [],
    pointLogs: [],
    rewards: [],
    withdraws: [],
    repeatCreditLogs: [],
    referrals: [],
    adminLogs: [],
    externalOrders: [],
    reversalCases: [],
  };
}

async function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const localState = saved ? JSON.parse(saved) : null;
  const finalize = (data) => prepareLoadedState(data || createSeedData());
  if (!firebaseUser) {
    return finalize(localState || createSeedData());
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
        externalOrders: snapshotDocs(await getDocs(externalOrdersRef)),
        reversalCases: snapshotDocs(await getDocs(reversalCasesRef)),
      };
      if (snapshot.exists() || !usersSnapshot.empty) {
        return finalize(mergeLocalPendingState(composeStateFromCloud(snapshot, usersSnapshot, seeded, records), localState, firebaseUser.uid));
      }
    }
    if (firebaseUser) {
      const userSnapshot = await getDoc(doc(db, USER_COLLECTION, firebaseUser.uid));
      const referralDocs = snapshotDocs(await getDocs(query(referralsRef, where("referrerId", "==", firebaseUser.uid))));
      const inviteeIds = referralDocs.map((referral) => referral.inviteeId).filter(Boolean);
      const inviteeOrders = [];
      for (const inviteeId of inviteeIds) {
        inviteeOrders.push(...snapshotDocs(await getDocs(query(ordersRef, where("userId", "==", inviteeId)))));
      }
      const records = {
        orders: mergeById(snapshotDocs(await getDocs(query(ordersRef, where("userId", "==", firebaseUser.uid)))), inviteeOrders),
        rewards: snapshotDocs(await getDocs(query(rewardsRef, where("userId", "==", firebaseUser.uid)))),
        withdraws: snapshotDocs(await getDocs(query(withdrawsRef, where("userId", "==", firebaseUser.uid)))),
        pointLogs: snapshotDocs(await getDocs(query(pointLogsRef, where("userId", "==", firebaseUser.uid)))),
        repeatCreditLogs: snapshotDocs(await getDocs(query(repeatCreditLogsRef, where("userId", "==", firebaseUser.uid)))),
        referrals: referralDocs,
      };
      return finalize(mergeLocalPendingState(composeStateFromUserDoc(snapshot, userSnapshot, seeded, records), localState, firebaseUser.uid));
    }
    if (snapshot.exists()) {
      return finalize({
        ...seeded,
        plans: Array.isArray(snapshot.data().plans) ? snapshot.data().plans : seeded.plans,
        adminLogs: [],
      });
    }
    return finalize(seeded);
  } catch (error) {
    console.warn("Firestore unavailable, using local fallback.", error);
    return finalize(localState || createSeedData());
  }
}

async function saveState() {
  if (firebaseUser) {
    normalizePendingOrderIdsForOwner(firebaseUser.uid);
  }
  normalizeWithdrawSources();
  normalizePendingOrderTypes();
  backfillOrderConfirmSummaries(state);
  const backfilledSnapshots = backfillOrderPlanSnapshots(state);
  if (backfilledSnapshots && isAdmin()) {
    addAdminLog("补齐订单快照", "系统", `自动补齐 ${backfilledSnapshots} 笔旧订单的配套快照`);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!firebaseUser) {
    syncMessage = "Firestore：未登录，暂存本地";
    return;
  }
  try {
    const cloudState = splitStateForCloud(state);
    if (isAdmin()) {
      await setDoc(systemRef, {
        plans: cloudState.plans,
        testDataClearedAt: cloudState.testDataClearedAt || "",
        updatedAt: serverTimestamp(),
      });
      await Promise.all([
        syncAdminCollection(usersRef, cloudState.users),
        syncAdminCollection(ordersRef, cloudState.orders),
        syncAdminCollection(rewardsRef, cloudState.rewards),
        syncAdminCollection(withdrawsRef, cloudState.withdraws),
        syncAdminCollection(pointLogsRef, cloudState.pointLogs),
        syncAdminCollection(repeatCreditLogsRef, cloudState.repeatCreditLogs),
        syncAdminCollection(invitesRef, cloudState.invites),
        syncAdminCollection(referralsRef, cloudState.referrals),
        syncAdminCollection(adminLogsRef, cloudState.adminLogs || []),
      ]);
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

async function syncAdminCollection(collectionRef, rows = []) {
  const desiredRows = rows.filter((row) => row?.id);
  const desiredIds = new Set(desiredRows.map((row) => row.id));
  const snapshot = await getDocs(collectionRef);
  await Promise.all([
    ...snapshot.docs
      .filter((item) => !desiredIds.has(item.id))
      .map((item) => deleteDoc(item.ref)),
    ...desiredRows.map((row) =>
      setDoc(doc(collectionRef, row.id), { ...row, updatedAt: serverTimestamp() })
    ),
  ]);
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

function latestIsoDate(...values) {
  return values
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || "";
}

function recordIsAfterTestClear(record, data = state) {
  if (!data?.testDataClearedAt) return true;
  const recordDate = record?.createdAt || record?.paidAt || record?.reviewedAt || record?.updatedAt || "";
  if (!recordDate) return false;
  return new Date(recordDate) > new Date(data.testDataClearedAt);
}

function filterBusinessRecordsAfterClear(data) {
  if (!data?.testDataClearedAt) return data;
  return {
    ...data,
    orders: (data.orders || []).filter((item) => recordIsAfterTestClear(item, data)),
    rewards: (data.rewards || []).filter((item) => recordIsAfterTestClear(item, data)),
    withdraws: (data.withdraws || []).filter((item) => recordIsAfterTestClear(item, data)),
    pointLogs: (data.pointLogs || []).filter((item) => recordIsAfterTestClear(item, data)),
    repeatCreditLogs: (data.repeatCreditLogs || []).filter((item) => recordIsAfterTestClear(item, data)),
  };
}

function mergeLocalPendingState(cloudState, localState, userId) {
  if (!cloudState || !localState || !userId) return cloudState;
  const testDataClearedAt = latestIsoDate(cloudState.testDataClearedAt, localState.testDataClearedAt);
  const mergedClearState = { testDataClearedAt };
  const localOwnerIds = new Set([userId]);
  const localUser = (localState.users || []).find((user) =>
    user.id === userId
    || user.firebaseUid === userId
    || (firebaseUser?.email && user.account === firebaseUser.email)
  );
  if (localUser?.id) localOwnerIds.add(localUser.id);
  const localPendingOrders = (localState.orders || [])
    .filter((order) =>
      localOwnerIds.has(order.userId)
      && order.status === "pending"
      && recordIsAfterTestClear(order, mergedClearState)
    )
    .map((order) => ({ ...order, userId }));
  const localPendingWithdraws = (localState.withdraws || [])
    .filter((withdraw) =>
      localOwnerIds.has(withdraw.userId)
      && withdraw.status === "pending"
      && recordIsAfterTestClear(withdraw, mergedClearState)
    )
    .map((withdraw) => ({ ...withdraw, userId }));
  const hasUser = (cloudState.users || []).some((user) => user.id === userId);
  return {
    ...cloudState,
    testDataClearedAt,
    currentUserId: userId,
    users: hasUser || !localUser ? cloudState.users : [...(cloudState.users || []), localUser],
    orders: mergeById(cloudState.orders || [], localPendingOrders),
    withdraws: mergeById(cloudState.withdraws || [], localPendingWithdraws),
  };
}

function composeStateFromCloud(systemSnapshot, usersSnapshot, fallback, records = {}) {
  if (systemSnapshot.exists() && systemSnapshot.data().state && usersSnapshot.empty) {
    return {
      ...systemSnapshot.data().state,
      externalOrders: records.externalOrders || [],
      reversalCases: records.reversalCases || [],
    };
  }
  const systemData = systemSnapshot.exists() ? systemSnapshot.data() : {};
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
    testDataClearedAt: systemData.testDataClearedAt || fallback.testDataClearedAt || "",
    plans,
    users: users.length ? users : fallback.users,
    orders: orders.length ? orders : fallback.orders,
    pointLogs: pointLogs.length ? pointLogs : fallback.pointLogs,
    repeatCreditLogs: repeatCreditLogs.length ? repeatCreditLogs : (fallback.repeatCreditLogs || []),
    rewards: rewards.length ? rewards : fallback.rewards,
    withdraws: withdraws.length ? withdraws : fallback.withdraws,
    referrals: referrals.length ? referrals : fallback.referrals,
    adminLogs: records.adminLogs || [],
    externalOrders: records.externalOrders || [],
    reversalCases: records.reversalCases || [],
  };
}

function composeStateFromUserDoc(systemSnapshot, userSnapshot, fallback, records = {}) {
  const systemData = systemSnapshot.exists() ? systemSnapshot.data() : {};
  const plans = systemSnapshot.exists() && Array.isArray(systemSnapshot.data().plans)
    ? systemSnapshot.data().plans
    : fallback.plans;

  if (!userSnapshot.exists()) {
    return {
      ...fallback,
      testDataClearedAt: systemData.testDataClearedAt || fallback.testDataClearedAt || "",
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
    testDataClearedAt: systemData.testDataClearedAt || fallback.testDataClearedAt || "",
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
    testDataClearedAt: data.testDataClearedAt || "",
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

function orderConfirmSummaryFromRecords(data, order) {
  const buyer = (data.users || []).find((item) => item.id === order.userId);
  const plan = orderPlan(order, data);
  if (!buyer || !plan || order.status !== "paid") return "";
  const rewards = (data.rewards || []).filter((reward) => reward.orderId === order.id);
  const summary = [
    `判定：${order.type === "repeat" ? "复购" : "首充"}`,
    `买家积分 +${points(order.points || plan.points)}`,
  ];
  if (buyer.packageUntil) summary.push(`配套有效至 ${new Date(buyer.packageUntil).toLocaleDateString("zh-CN")}`);
  if (order.type === "repeat") {
    const directRepeatReward = rewards.find((reward) => reward.type === "repeat" && reward.rewardMode === "direct");
    const poolRepeatReward = rewards.find((reward) => reward.type === "repeat" && reward.rewardMode === "pool")
      || rewards.find((reward) => reward.type === "repeat" && !reward.rewardMode);
    const directReceiver = directRepeatReward ? (data.users || []).find((user) => user.id === directRepeatReward.userId) : null;
    const poolReceiver = poolRepeatReward ? (data.users || []).find((user) => user.id === poolRepeatReward.userId) : null;
    summary.push(`买家奖励池资格不变，当前 ${buyer.repeatCredits || 0}`);
    if (buyer.repeatCooldownUntil) summary.push(`复购冷却至 ${new Date(buyer.repeatCooldownUntil).toLocaleString("zh-CN")}`);
    summary.push(directRepeatReward
      ? `下线复购奖励：${directReceiver?.name || directRepeatReward.userId} 获得 ${money(directRepeatReward.amount)}`
      : "下线复购奖励：未找到现有奖励记录");
    summary.push(poolRepeatReward
      ? `奖励池奖励：${poolReceiver?.name || poolRepeatReward.userId} 获得 ${money(poolRepeatReward.amount)}，扣 1 个资格`
      : "奖励池奖励：未找到现有奖励记录");
  } else {
    const firstReward = rewards.find((reward) => reward.type === "first");
    const receiver = firstReward ? (data.users || []).find((user) => user.id === firstReward.userId) : null;
    summary.push(firstReward
      ? `推荐奖励：${receiver?.name || firstReward.userId} 获得 ${money(firstReward.amount)}`
      : "推荐奖励：未找到现有奖励记录");
  }
  return summary.join(" / ");
}

function backfillOrderConfirmSummaries(data = state) {
  if (!data) return 0;
  let count = 0;
  (data.orders || []).forEach((order) => {
    if (order.status !== "paid" || order.confirmSummary) return;
    const summary = orderConfirmSummaryFromRecords(data, order);
    if (!summary) return;
    order.confirmSummary = summary;
    count += 1;
  });
  return count;
}

function money(value) {
  return `RM${Number(value || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}`;
}

function packageUnits(amount) {
  return Number(amount || 0) / PACKAGE_UNIT_AMOUNT;
}

function isValidPackageAmount(amount) {
  const value = Number(amount || 0);
  return value > 0 && value % PACKAGE_UNIT_AMOUNT === 0;
}

function packageUnitLabel(amount) {
  const units = packageUnits(amount);
  return isValidPackageAmount(amount)
    ? `${PACKAGE_UNIT_AMOUNT} × ${units} 单位`
    : `需为 RM${PACKAGE_UNIT_AMOUNT} 的整数倍`;
}

function points(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) throw new Error("empty-copy-text");
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      console.warn("Clipboard API failed, trying fallback.", error);
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy-command-failed");
}

function inviteMessage(user = currentUser()) {
  const inviteLink = document.querySelector("#inviteLink")?.textContent || `${location.origin}${location.pathname}?ref=${user.inviteCode}`;
  return [
    `${user.name || "朋友"} 邀请你加入简单的联盟营销系统。`,
    `推荐码：${user.inviteCode}`,
    `注册链接：${inviteLink}`,
    "注册后输入推荐码绑定推荐人，再申请充值配套。",
  ].join("\n");
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
  if (TEST_INSTANT_MODE) return 0;
  return Number(plan.repeatCooldownHours ?? 24);
}

function planDirectRepeatRate(plan) {
  return Number(plan?.directRepeatRate ?? 10);
}

function planPoolRepeatRate(plan) {
  return Number(plan?.repeatRate ?? 10);
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

function planSnapshot(plan) {
  return {
    id: plan.id,
    name: plan.name,
    amount: Number(plan.amount || 0),
    unitAmount: PACKAGE_UNIT_AMOUNT,
    unitCount: packageUnits(plan.amount),
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

function orderPlan(order, data = state) {
  const currentPlan = (data.plans || []).find((item) => item.id === order.planId);
  const snapshot = order.planSnapshot || {};
  if (!currentPlan && !Object.keys(snapshot).length) return null;
  return {
    ...(currentPlan || {}),
    ...snapshot,
    id: order.planId,
    name: snapshot.name || currentPlan?.name || "已删除配套",
  };
}

function backfillOrderPlanSnapshots(data = state) {
  if (!data) return 0;
  let count = 0;
  (data.orders || []).forEach((order) => {
    if (order.planSnapshot) return;
    const plan = (data.plans || []).find((item) => item.id === order.planId);
    if (!plan) return;
    order.planSnapshot = planSnapshot(plan);
    count += 1;
  });
  return count;
}

function looksLikeAffiliatePlan(plan) {
  return Boolean(plan)
    && Number(plan.amount || 0) > 0
    && Number(plan.points || 0) > 0
    && Number(plan.validDays || 0) > 0
    && plan.firstRate !== undefined;
}

function normalizeAffiliatePlans(plans = []) {
  const normalized = (plans || []).filter(looksLikeAffiliatePlan).map((plan) => ({
    ...plan,
    points: Number(plan.points || 0),
    repeatCredits: planRepeatCredits(plan),
    repeatCooldownHours: planRepeatCooldownHours(plan),
    firstRate: Number(plan.firstRate || 0),
    directRepeatRate: planDirectRepeatRate(plan),
    repeatRate: planPoolRepeatRate(plan),
  }));
  if (normalized.length) return normalized;
  return defaultAffiliatePlans();
}

function prepareLoadedState(data) {
  data.externalOrders = Array.isArray(data.externalOrders) ? data.externalOrders : [];
  data.reversalCases = Array.isArray(data.reversalCases) ? data.reversalCases : [];
  const originalPlans = data.plans || [];
  data.plans = normalizeAffiliatePlans(originalPlans);
  if (originalPlans.length && !originalPlans.some(looksLikeAffiliatePlan)) {
    data.planRulesResetAt = new Date().toISOString();
    data.planRulesResetReason = "检测到配套参数不完整，已恢复默认充值配套";
  }
  data = filterBusinessRecordsAfterClear(data);
  purgeLegacyDemoUsers(data);
  cleanupAutoRepeatCreditGrants(data);
  syncReferralPoolCredits(data);
  capRepeatPoolCredits(data);
  backfillOrderPlanSnapshots(data);
  return data;
}

function isLegacyDemoUser(user) {
  return LEGACY_DEMO_INVITE_CODES.has(normalizeInviteCode(user.inviteCode))
    || LEGACY_DEMO_ACCOUNTS.has(String(user.account || "").toLowerCase())
    || (user.name === "李明" && normalizeInviteCode(user.inviteCode) === "LM1001")
    || (user.name === "王芳" && normalizeInviteCode(user.inviteCode) === "WF1002")
    || (user.name === "陈杰" && normalizeInviteCode(user.inviteCode) === "CJ1003");
}

function purgeLegacyDemoUsers(data) {
  const demoIds = new Set((data.users || []).filter(isLegacyDemoUser).map((user) => user.id));
  if (!demoIds.size) return;
  if (demoIds.has(data.currentUserId)) data.currentUserId = "";
  data.users = (data.users || []).filter((user) => !demoIds.has(user.id));
  data.orders = (data.orders || []).filter((order) => !demoIds.has(order.userId));
  data.rewards = (data.rewards || []).filter((reward) =>
    !demoIds.has(reward.userId) && !demoIds.has(reward.sourceUserId)
  );
  data.withdraws = (data.withdraws || []).filter((withdraw) => !demoIds.has(withdraw.userId));
  data.pointLogs = (data.pointLogs || []).filter((log) => !demoIds.has(log.userId));
  data.repeatCreditLogs = (data.repeatCreditLogs || []).filter((log) => !demoIds.has(log.userId));
  data.referrals = (data.referrals || []).filter((referral) =>
    !demoIds.has(referral.referrerId) && !demoIds.has(referral.inviteeId)
  );
  data.legacyDemoUsersPurgedAt = data.legacyDemoUsersPurgedAt || new Date().toISOString();
}

function cleanupAutoRepeatCreditGrants(data) {
  const logs = Array.isArray(data.repeatCreditLogs) ? data.repeatCreditLogs : [];
  const obsoleteLogs = logs.filter((log) =>
    log.reason === "earned"
    && Number(log.change || 0) > 0
    && String(log.note || "").toLowerCase().includes("repeat purchase")
  );
  if (!obsoleteLogs.length) return;
  obsoleteLogs.forEach((log) => {
    const user = (data.users || []).find((item) => item.id === log.userId);
    if (!user) return;
    user.repeatCredits = Math.max(Number(user.repeatCredits || 0) - Number(log.change || 0), 0);
    if (user.repeatCredits <= 0) user.repeatCreditQueueAt = "";
  });
  const obsoleteIds = new Set(obsoleteLogs.map((log) => log.id));
  data.repeatCreditLogs = logs.filter((log) => !obsoleteIds.has(log.id));
  data.autoRepeatCreditCleanupAt = data.autoRepeatCreditCleanupAt || new Date().toISOString();
}

function syncReferralPoolCredits(data) {
  const referrals = referralDocsForState(data)
    .filter((referral) => referral.referrerId && referral.inviteeId)
    .sort((a, b) => new Date(a.createdAt || "9999-12-31") - new Date(b.createdAt || "9999-12-31"));
  referrals.forEach((referral) => {
    grantReferralPoolCredit(data, referral.referrerId, referral.inviteeId, referral.createdAt || new Date().toISOString());
  });
}

function capRepeatPoolCredits(data) {
  (data.users || []).forEach((user) => {
    user.repeatCredits = Math.max(Math.min(Number(user.repeatCredits || 0), MAX_REPEAT_POOL_CREDITS), 0);
    if (user.repeatCredits <= 0) user.repeatCreditQueueAt = "";
  });
}

function orderPlanSummary(plan) {
  if (!plan) return "-";
  return [
    `积分 ${points(plan.points)}`,
    `单位 ${packageUnitLabel(plan.amount)}`,
    `名额 ${Number(plan.slots || 0)}`,
    `有效 ${Number(plan.validDays || 0)} 天`,
    `推荐奖励 ${Number(plan.firstRate || 0)}%`,
    `下线复购 ${planDirectRepeatRate(plan)}%`,
    `奖励池 ${planPoolRepeatRate(plan)}%`,
    `奖励池资格每推荐 1 人解锁，上限 ${MAX_REPEAT_POOL_CREDITS} 个`,
    `冷却 ${planRepeatCooldownHours(plan)} 小时`,
  ].join(" / ");
}

function guestUser() {
  return {
    id: "__guest__",
    name: "未登录用户",
    account: "",
    phone: "",
    withdrawMethod: "",
    withdrawAccount: "",
    inviteCode: "",
    referrerId: "",
    level: "访客",
    points: 0,
    slots: 0,
    repeatCredits: 0,
    repeatCreditQueueAt: "",
    repeatCooldownUntil: "",
    packageUntil: "",
    frozen: false,
  };
}

function currentUser() {
  if (!firebaseUser) return guestUser();
  return findUser(firebaseUser.uid)
    || state.users.find((user) => user.firebaseUid === firebaseUser.uid || user.account === firebaseUser.email)
    || findUser(state.currentUserId)
    || guestUser();
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

function referralPoolCreditSource(referrerId, inviteeId) {
  return `referral:${referrerId}_${inviteeId}`;
}

function referralPoolUnlockCount(userId, data = state) {
  return (data.repeatCreditLogs || [])
    .filter((log) => log.userId === userId && log.reason === "referral" && Number(log.change || 0) > 0)
    .length;
}

function grantReferralPoolCredit(data, referrerId, inviteeId, createdAt = new Date().toISOString()) {
  const referrer = (data.users || []).find((user) => user.id === referrerId);
  const invitee = (data.users || []).find((user) => user.id === inviteeId);
  if (!referrer || referrer.id === inviteeId) return false;
  const source = referralPoolCreditSource(referrerId, inviteeId);
  const alreadyGranted = (data.repeatCreditLogs || []).some((log) =>
    log.userId === referrerId && log.reason === "referral" && log.source === source
  );
  if (alreadyGranted) return false;
  if (referralPoolUnlockCount(referrerId, data) >= MAX_REPEAT_POOL_CREDITS) return false;
  const before = Number(referrer.repeatCredits || 0);
  if (before >= MAX_REPEAT_POOL_CREDITS) return false;
  referrer.repeatCredits = Math.min(before + 1, MAX_REPEAT_POOL_CREDITS);
  if (referrer.repeatCredits > 0 && before <= 0) {
    referrer.repeatCreditQueueAt = createdAt;
  }
  addRepeatCreditLog(
    data,
    referrer.id,
    referrer.repeatCredits - before,
    referrer.repeatCredits,
    "referral",
    source,
    `直接推荐解锁：${invitee?.name || invitee?.account || invitee?.inviteCode || inviteeId}`,
    createdAt
  );
  return true;
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
  const missingFields = profileMissingFields(user);
  if (user.frozen) reasons.push("账户已冻结");
  if (!isActivePackage(user)) reasons.push("需要有效配套");
  if (missingFields.length) reasons.push(`请补完整资料：${missingFields.join("、")}`);
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
  return `规则：充值积分不可提现；只有已确认/已释放的推荐奖励和复购奖励可提现。提现申请冷却 ${WITHDRAW_COOLDOWN_HOURS} 小时。当前可提现奖励 ${money(available)}。`;
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
  if (TEST_INSTANT_MODE) return null;
  const normalized = String(ref || "").trim().toLowerCase();
  if (!normalized) return null;
  return (state.orders || []).find((order) =>
    order.status !== "cancelled"
    && recordIsAfterTestClear(order)
    && String(order.paymentRef || "").trim().toLowerCase() === normalized
    && (!userId || order.userId === userId)
  );
}

function duplicateProofName(fileName, userId = "") {
  if (TEST_INSTANT_MODE) return null;
  const normalized = String(fileName || "").trim().toLowerCase();
  if (!normalized) return null;
  return (state.orders || []).find((order) =>
    order.status !== "cancelled"
    && recordIsAfterTestClear(order)
    && String(order.proofName || "").trim().toLowerCase() === normalized
    && (!userId || order.userId === userId)
  );
}

function duplicateOrderRisks(data = state) {
  if (TEST_INSTANT_MODE) return [];
  const risks = [];
  const seenRefs = new Map();
  const seenProofs = new Map();
  (data.orders || [])
    .filter((order) => order.status !== "cancelled" && recordIsAfterTestClear(order, data))
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

function orderRiskIssues(data = state) {
  return (data.orders || []).flatMap((order) =>
    orderRiskLabels(order, data).map((issue) => `订单 ${order.id}：${issue}`)
  );
}

function orderRiskLabels(order, data = state) {
  const labels = [];
  const paymentRef = String(order.paymentRef || "").trim().toLowerCase();
  const proofName = String(order.proofName || "").trim().toLowerCase();
  const currentPlan = (data.plans || []).find((item) => item.id === order.planId);
  const lockedPlan = orderPlan(order, data);
  if (!currentPlan && lockedPlan) {
    labels.push("当前配套已删除，将按订单快照处理");
  }
  if (!isValidPackageAmount(order.amount)) {
    labels.push(`订单金额必须是 RM${PACKAGE_UNIT_AMOUNT} 的整数倍`);
  }
  if (currentPlan && !isValidPackageAmount(currentPlan.amount)) {
    labels.push(`当前配套金额不符合 RM${PACKAGE_UNIT_AMOUNT} 单位规则`);
  }
  if (lockedPlan && !isValidPackageAmount(lockedPlan.amount)) {
    labels.push(`订单配套快照金额不符合 RM${PACKAGE_UNIT_AMOUNT} 单位规则`);
  }
  if (currentPlan && Number(order.amount || 0) !== Number(currentPlan.amount || 0)) {
    labels.push(`订单金额 ${money(order.amount)} 与当前配套金额 ${money(currentPlan.amount)} 不一致`);
  }
  if (lockedPlan && Number(order.amount || 0) !== Number(lockedPlan.amount || 0)) {
    labels.push(`订单金额 ${money(order.amount)} 与订单配套快照 ${money(lockedPlan.amount)} 不一致`);
  }
  if (!TEST_INSTANT_MODE && paymentRef) {
      const duplicateRef = (data.orders || []).find((item) =>
        item.id !== order.id
        && item.userId === order.userId
        && item.status !== "cancelled"
        && recordIsAfterTestClear(item, data)
        && String(item.paymentRef || "").trim().toLowerCase() === paymentRef
    );
    if (duplicateRef) labels.push(`重复付款参考号：${duplicateRef.id}`);
  }
  if (!TEST_INSTANT_MODE && proofName) {
      const duplicateProof = (data.orders || []).find((item) =>
        item.id !== order.id
        && item.userId === order.userId
        && item.status !== "cancelled"
        && recordIsAfterTestClear(item, data)
        && String(item.proofName || "").trim().toLowerCase() === proofName
    );
    if (duplicateProof) labels.push(`重复凭证名：${duplicateProof.id}`);
  }
  return labels;
}

function withdrawRiskLabels(withdraw, data = state) {
  const labels = [];
  const account = String(withdraw.account || "").trim().toLowerCase();
  if (!account) return labels;
  const otherUsers = new Set((data.withdraws || [])
    .filter((item) =>
      item.id !== withdraw.id
      && item.userId !== withdraw.userId
      && item.status !== "rejected"
      && String(item.account || "").trim().toLowerCase() === account
    )
    .map((item) => item.userId));
  if (otherUsers.size) labels.push(`收款账号被 ${otherUsers.size} 个其他用户使用`);
  return labels;
}

function withdrawRiskIssues(data = state) {
  return (data.withdraws || []).flatMap((withdraw) =>
    withdrawRiskLabels(withdraw, data).map((issue) => `提现 ${withdraw.id}：${issue}`)
  );
}

function sharedWithdrawAccountUsers(account, currentUserId = "", data = state) {
  const normalized = String(account || "").trim().toLowerCase();
  if (!normalized) return [];
  const userIds = new Set();
  (data.withdraws || []).forEach((withdraw) => {
    if (withdraw.status === "rejected") return;
    if (String(withdraw.account || "").trim().toLowerCase() === normalized) userIds.add(withdraw.userId);
  });
  (data.users || []).forEach((user) => {
    if (String(user.withdrawAccount || "").trim().toLowerCase() === normalized) userIds.add(user.id);
  });
  return [...userIds]
    .filter((userId) => userId && userId !== currentUserId)
    .map((userId) => data.users.find((user) => user.id === userId))
    .filter(Boolean);
}

function payoutRiskUsers(data = state) {
  return (data.users || []).filter((user) => sharedWithdrawAccountUsers(user.withdrawAccount, user.id, data).length > 0);
}

function incompleteProfileUsers(data = state) {
  return (data.users || []).filter((user) => !profileComplete(user));
}

function rewardIntegrityIssues(data = state) {
  return (data.rewards || []).flatMap((reward) => rewardRiskLabels(reward, data));
}

function rewardRiskLabels(reward, data = state) {
  const issues = [];
  const users = data.users || [];
  const orders = data.orders || [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const label = reward.id || reward.orderId;
  const order = ordersById.get(reward.orderId);
  if (!usersById.has(reward.userId)) issues.push(`奖励 ${label} 的收款用户不存在`);
  if (!order) {
    issues.push(`奖励 ${label} 对应订单不存在`);
    return issues;
  }
  const buyer = usersById.get(order.userId);
  const expectedAmount = Number((Number(order.amount || 0) * (Number(reward.rate || 0) / 100)).toFixed(2));
  if (Math.abs(Number(reward.amount || 0) - expectedAmount) > 0.01) {
    issues.push(`奖励 ${label} 金额异常：记录 ${money(reward.amount)}，应为 ${money(expectedAmount)}`);
  }
  if (reward.type === "first") {
    if (order.type !== "first") issues.push(`推荐奖励 ${label} 对应订单不是首充`);
    if (buyer?.referrerId && reward.userId !== buyer.referrerId) issues.push(`推荐奖励 ${label} 没有发给订单买家的推荐人`);
    if (!buyer?.referrerId) issues.push(`推荐奖励 ${label} 对应买家没有推荐人`);
  }
  if (reward.type === "repeat") {
    if (order.type !== "repeat") issues.push(`复购奖励 ${label} 对应订单不是复购`);
    if (reward.userId === order.userId) issues.push(`复购奖励 ${label} 发给了买家本人`);
    if (!["direct", "pool"].includes(reward.rewardMode)) issues.push(`复购奖励 ${label} 缺少复购模式标记`);
    if (reward.rewardMode === "direct" && buyer?.referrerId && reward.userId !== buyer.referrerId) issues.push(`下线复购奖励 ${label} 没有发给买家的推荐人`);
    if (reward.rewardMode === "direct" && !buyer?.referrerId) issues.push(`下线复购奖励 ${label} 对应买家没有推荐人`);
    if (Array.isArray(reward.releasePlan)) {
      const released = reward.releasePlan.reduce((sum, part) => sum + (part.released ? Number(part.amount || 0) : 0), 0);
      const planned = reward.releasePlan.reduce((sum, part) => sum + Number(part.amount || 0), 0);
      if (Math.abs(planned - Number(reward.amount || 0)) > 0.01) issues.push(`复购奖励 ${label} 分期总额与奖励金额不一致`);
      if (Number(reward.releasedAmount || 0) !== released) issues.push(`复购奖励 ${label} 已释放金额与分期不一致`);
    }
  }
  return issues;
}

function dataIntegrityIssues(data = state, options = {}) {
  const includeProfileIssues = options.includeProfileIssues !== false;
  const includeOrderIssues = options.includeOrderIssues !== false;
  const includeRewardIssues = options.includeRewardIssues !== false;
  const includeWithdrawIssues = options.includeWithdrawIssues !== false;
  const issues = [];
  const users = data.users || [];
  const orders = data.orders || [];
  const rewards = data.rewards || [];
  const withdraws = data.withdraws || [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const inviteCodes = new Map();
  if (includeOrderIssues) issues.push(...duplicateOrderRisks(data));

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
    if (!(data.plans || []).some((plan) => plan.id === order.planId) && !order.planSnapshot && order.status !== "cancelled") issues.push(`订单 ${order.id} 的配套不存在或已删除`);
    if (order.status === "paid" && Number(order.points || 0) <= 0) issues.push(`已付款订单 ${order.id} 积分为 0`);
    if (includeOrderIssues) {
      orderRiskLabels(order, data).forEach((risk) => {
        if (risk.includes("金额") || risk.includes("配套")) issues.push(`订单 ${order.id}：${risk}`);
      });
    }
  });

  if (includeRewardIssues) issues.push(...rewardIntegrityIssues(data));

  withdraws.forEach((withdraw) => {
    if (!usersById.has(withdraw.userId)) issues.push(`提现 ${withdraw.id} 的用户不存在`);
    if (withdraw.source !== "reward") issues.push(`提现 ${withdraw.id} 不是奖励提现来源`);
    if (includeWithdrawIssues) withdrawRiskLabels(withdraw, data).forEach((risk) => issues.push(`提现 ${withdraw.id}：${risk}`));
  });

  users.forEach((user) => {
    const missingFields = profileMissingFields(user);
    if (includeProfileIssues && missingFields.length) issues.push(`用户 ${user.name || user.id} 资料不完整：${missingFields.join("、")}`);
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
    && recordIsAfterTestClear(order, data)
  );
}

function actualOrderType(data, userId, excludeOrderId = "") {
  return hasPaidOrder(data, userId, excludeOrderId) ? "repeat" : "first";
}

function createOrder(data, userId, planId, type, status = "paid", createdAt = new Date().toISOString(), paymentInfo = {}) {
  const user = data.users.find((item) => item.id === userId);
  const plan = data.plans.find((item) => item.id === planId);
  if (!user || !plan) return null;
  if (!isValidPackageAmount(plan.amount)) return null;
  const orderType = type || actualOrderType(data, userId);
  const order = {
    id: orderNo(data, userId),
    userId,
    planId,
    planSnapshot: planSnapshot(plan),
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
  const plan = orderPlan(order, data);
  if (!user || !plan || order.points > 0) return;
  const summary = [];
  order.type = actualOrderType(data, order.userId, order.id);
  order.status = "paid";
  order.points = plan.points;
  order.paidAt = paidAt;
  user.points += plan.points;
  user.slots = Math.max(user.slots || 0, plan.slots);
  user.packageUntil = addDays(paidAt, plan.validDays);
  user.level = plan.amount >= 720 ? "高级推广用户" : "推广用户";
  data.pointLogs.push({ id: id("log"), userId: user.id, change: plan.points, balance: user.points, source: order.id, note: `${plan.name} 积分发放`, createdAt: paidAt });
  summary.push(`判定：${order.type === "first" ? "首充" : "复购"}`);
  summary.push(`买家积分 +${points(plan.points)}`);
  summary.push(`配套有效至 ${new Date(user.packageUntil).toLocaleDateString("zh-CN")}`);
  if (order.type === "repeat") {
    user.repeatCooldownUntil = addHours(paidAt, planRepeatCooldownHours(plan));
    const directReward = createRepeatDirectReward(data, order, user, plan, paidAt);
    const poolReward = createRepeatPoolReward(data, order, user, plan, paidAt);
    summary.push(`买家奖励池资格不变，当前 ${user.repeatCredits || 0}`);
    summary.push(`复购冷却至 ${new Date(user.repeatCooldownUntil).toLocaleString("zh-CN")}`);
    summary.push(directReward
      ? `下线复购奖励：${directReward.receiverName} 获得 ${money(directReward.amount)}`
      : "下线复购奖励：无推荐人、推荐人未开通有效配套、冻结或比例为 0，未生成奖励");
    summary.push(poolReward
      ? `奖励池奖励：${poolReward.receiverName} 获得 ${money(poolReward.amount)}，扣 1 个资格`
      : "奖励池奖励：暂无接收人或比例为 0，未生成奖励");
  } else {
    const firstReward = createFirstReward(data, order, user, plan, paidAt);
    summary.push(firstReward
      ? `推荐奖励：${firstReward.receiverName} 获得 ${money(firstReward.amount)}`
      : "推荐奖励：无推荐人、推荐人冻结或比例为 0，未生成奖励");
  }
  order.confirmSummary = summary.join(" / ");
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
      released: TEST_INSTANT_MODE,
      releasedAt: TEST_INSTANT_MODE ? paidAt : "",
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

function settleRewardNow(reward, now = new Date()) {
  if (!reward || !["pending", "releasing"].includes(reward.status)) return false;
  if (Array.isArray(reward.releasePlan)) {
    reward.releasePlan = reward.releasePlan.map((part) => ({
      ...part,
      released: true,
      releasedAt: part.releasedAt || now.toISOString(),
    }));
    reward.releasedAmount = Number(reward.amount || 0);
  }
  reward.status = "confirmed";
  reward.confirmAfter = now.toISOString();
  reward.reviewedAt = now.toISOString();
  reward.reviewNote = [reward.reviewNote, TEST_INSTANT_MODE ? "测试即时模式手动结算" : "手动确认到期奖励"].filter(Boolean).join(" / ");
  return true;
}

function createFirstReward(data, order, buyer, plan, paidAt = order.createdAt) {
  if (!buyer.referrerId) return null;
  const referrer = data.users.find((item) => item.id === buyer.referrerId);
  if (!referrer || referrer.frozen) return null;
  const rate = Number(plan.firstRate || 0);
  if (rate <= 0) return null;
  const amount = +(order.amount * (rate / 100)).toFixed(2);
  const reward = {
    id: id("rew"),
    userId: referrer.id,
    sourceUserId: buyer.id,
    sourceUserName: buyer.name || "",
    sourceUserAccount: buyer.account || "",
    sourceUserInviteCode: buyer.inviteCode || "",
    orderId: order.id,
    type: "first",
    rate,
    amount,
    status: TEST_INSTANT_MODE ? "confirmed" : "pending",
    confirmAfter: addDays(paidAt, CONFIRM_DAYS),
    createdAt: paidAt,
    reviewedAt: TEST_INSTANT_MODE ? paidAt : "",
    reviewNote: TEST_INSTANT_MODE ? "测试即时模式自动确认" : "",
  };
  data.rewards.push(reward);
  return { reward, receiverName: referrer.name || referrer.account || referrer.id, amount };
}

function createRepeatDirectReward(data, order, buyer, plan, paidAt = order.createdAt) {
  if (!buyer.referrerId) return null;
  const referrer = data.users.find((item) => item.id === buyer.referrerId);
  if (!referrer || referrer.frozen || !isActivePackage(referrer)) return null;
  const rate = planDirectRepeatRate(plan);
  if (rate <= 0) return null;
  const amount = +(order.amount * (rate / 100)).toFixed(2);
  const reward = {
    id: id("rew"),
    userId: referrer.id,
    sourceUserId: buyer.id,
    sourceUserName: buyer.name || "",
    sourceUserAccount: buyer.account || "",
    sourceUserInviteCode: buyer.inviteCode || "",
    orderId: order.id,
    type: "repeat",
    rewardMode: "direct",
    rate,
    amount,
    status: TEST_INSTANT_MODE ? "confirmed" : "pending",
    releasedAmount: TEST_INSTANT_MODE ? amount : 0,
    releasePlan: createReleasePlan(amount, paidAt),
    confirmAfter: addDays(paidAt, CONFIRM_DAYS),
    createdAt: paidAt,
    reviewedAt: TEST_INSTANT_MODE ? paidAt : "",
    reviewNote: TEST_INSTANT_MODE ? "测试即时模式自动释放" : "",
  };
  data.rewards.push(reward);
  return { reward, receiverName: referrer.name || referrer.account || referrer.id, amount };
}

function createRepeatPoolReward(data, order, buyer, plan, paidAt = order.createdAt) {
  const receiver = nextRepeatReceiver(data, buyer.id);
  const rate = planPoolRepeatRate(plan);
  if (!receiver || rate <= 0) return null;
  receiver.repeatCredits = Math.max(Number(receiver.repeatCredits || 0) - 1, 0);
  if (receiver.repeatCredits <= 0) receiver.repeatCreditQueueAt = "";
  addRepeatCreditLog(data, receiver.id, -1, receiver.repeatCredits, "used", order.id, `Repeat pool reward from ${buyer.name || buyer.account}`, paidAt);
  const amount = +(order.amount * (rate / 100)).toFixed(2);
  const reward = {
    id: id("rew"),
    userId: receiver.id,
    sourceUserId: buyer.id,
    sourceUserName: buyer.name || "",
    sourceUserAccount: buyer.account || "",
    sourceUserInviteCode: buyer.inviteCode || "",
    orderId: order.id,
    type: "repeat",
    rewardMode: "pool",
    rate,
    amount,
    status: TEST_INSTANT_MODE ? "confirmed" : "pending",
    releasedAmount: TEST_INSTANT_MODE ? amount : 0,
    releasePlan: createReleasePlan(amount, paidAt),
    confirmAfter: addDays(paidAt, CONFIRM_DAYS),
    createdAt: paidAt,
    reviewedAt: TEST_INSTANT_MODE ? paidAt : "",
    reviewNote: TEST_INSTANT_MODE ? "测试即时模式自动释放" : "",
  };
  data.rewards.push(reward);
  return { reward, receiverName: receiver.name || receiver.account || receiver.id, amount };
}

function nextRepeatReceiver(data, buyerId) {
  return data.users
    .filter((user) => user.id !== buyerId && !user.frozen && Number(user.repeatCredits || 0) > 0)
    .sort((a, b) => new Date(a.repeatCreditQueueAt || "9999-12-31") - new Date(b.repeatCreditQueueAt || "9999-12-31"))[0];
}

function canRecalculateOrderRewards(order) {
  const rewards = (state.rewards || []).filter((reward) => reward.orderId === order.id);
  const risks = orderRiskLabels(order);
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
  const plan = orderPlan(order, data);
  if (!buyer || !plan) return { ok: false, message: "订单用户或配套不存在" };

  const removedRewards = (data.rewards || []).filter((reward) => reward.orderId === order.id).length;
  data.rewards = (data.rewards || []).filter((reward) => reward.orderId !== order.id);
  const reversedLogs = reverseRepeatCreditLogsForOrder(data, order.id);
  order.type = actualOrderType(data, order.userId, order.id);
  const paidAt = order.paidAt || order.createdAt || new Date().toISOString();
  if (order.type === "repeat") {
    createRepeatDirectReward(data, order, buyer, plan, paidAt);
    createRepeatPoolReward(data, order, buyer, plan, paidAt);
  } else {
    createFirstReward(data, order, buyer, plan, paidAt);
  }
  return {
    ok: true,
    message: `已重算为${order.type === "first" ? "首充" : "复购"}，移除 ${removedRewards} 笔旧奖励、${reversedLogs} 条奖励池资格流水`,
  };
}

function orderConfirmPreview(order) {
  const user = findUser(order.userId);
  const plan = orderPlan(order);
  if (!user || !plan) return "订单资料不完整，仍要继续确认吗？";
  const previewType = actualOrderType(state, order.userId, order.id);
  const risks = orderRiskLabels(order);
  const lines = [
    `确认订单：${order.id}`,
    `用户：${user.name} / ${user.account}`,
    `配套：${plan.name}，金额 ${money(order.amount)}`,
    `处理类型：${previewType === "first" ? "首充" : "复购"}`,
    `积分：+${points(plan.points)}`,
  ];
  if (risks.length) {
    lines.push("");
    lines.push("风控提醒：");
    risks.forEach((risk) => lines.push(`- ${risk}`));
    lines.push("请先确认不是重复付款或重复凭证。");
    lines.push("");
  }
  if (previewType === "repeat") {
    const receiver = nextRepeatReceiver(state, user.id);
    const referrer = findUser(user.referrerId);
    const directReward = +(order.amount * (planDirectRepeatRate(plan) / 100)).toFixed(2);
    const poolReward = +(order.amount * (planPoolRepeatRate(plan) / 100)).toFixed(2);
    lines.push("奖励池资格：买家不自动增加资格");
    lines.push(`复购冷却：${planRepeatCooldownHours(plan)} 小时`);
    lines.push(referrer && isActivePackage(referrer)
      ? `下线复购奖励：${referrer.name} 预计获得 ${money(directReward)}，分 ${REPEAT_RELEASE_DAYS.length} 期释放`
      : "下线复购奖励：没有有效推荐人，不产生下线复购奖励");
    lines.push(receiver
      ? `奖励池接收人：${receiver.name} / 当前资格 ${receiver.repeatCredits} 个，将扣 1 个，奖励 ${money(poolReward)} 分 ${REPEAT_RELEASE_DAYS.length} 期释放`
      : "奖励池接收人：暂无，当前复购只给买家增加资格，不产生奖励池奖励");
  } else {
    const referrer = findUser(user.referrerId);
    const reward = +(order.amount * (Number(plan.firstRate || 0) / 100)).toFixed(2);
    lines.push(referrer ? `推荐奖励：${referrer.name} 预计获得 ${money(reward)}` : "推荐奖励：没有绑定推荐人");
  }
  lines.push("确定要确认付款吗？");
  return lines.join("\n");
}

function orderDetailText(order) {
  const user = findUser(order.userId);
  const plan = orderPlan(order);
  if (!order || !user || !plan) return "订单资料不完整";
  const resolvedType = order.status === "pending" ? actualOrderType(state, order.userId, order.id) : order.type;
  const risks = orderRiskLabels(order);
  const rewards = (state.rewards || []).filter((reward) => reward.orderId === order.id);
  const rewardLines = rewards.length
    ? rewards.map((reward) => {
      const owner = findUser(reward.userId);
      return `- ${rewardTypeText(reward)}：${owner?.name || reward.userId} / ${rewardAmountText(reward)} / ${labelStatus(reward.status)} / 备注：${reward.reviewNote || "-"}`;
    })
    : ["- 暂无奖励记录"];
  const receiver = resolvedType === "repeat" ? nextRepeatReceiver(state, order.userId) : null;
  const referrer = resolvedType === "repeat" ? findUser(user.referrerId) : null;
  return [
    `订单：${order.id}`,
    `用户：${user.name} / ${user.account}`,
    `配套：${plan.name}`,
    `金额：${money(order.amount)}`,
    `锁定规则：${orderPlanSummary(plan)}`,
    `状态：${labelStatus(order.status)}`,
    `当前判定：${resolvedType === "first" ? "首充" : "复购"}`,
    `付款：${paymentMethodText(order.paymentMethod)} / ${order.paymentRef || "-"}`,
    `凭证：${proofStatusText(order)}`,
    `风控风险：${risks.length ? risks.join("；") : "无"}`,
    `处理备注：${order.reviewNote || "-"}`,
    `处理结果：${order.confirmSummary || "-"}`,
    `积分：${points(order.points || 0)} / 确认后应发 ${points(plan.points)}`,
    `确认时间：${order.reviewedAt ? new Date(order.reviewedAt).toLocaleString("zh-CN") : "-"}`,
    `取消时间：${order.cancelledAt ? new Date(order.cancelledAt).toLocaleString("zh-CN") : "-"}`,
    resolvedType === "first"
      ? `推荐奖励对象：${user.referrerId ? (findUser(user.referrerId)?.name || user.referrerId) : "无推荐人"}`
      : `下线复购对象：${referrer ? `${referrer.name}（${isActivePackage(referrer) ? "配套有效" : "配套无效"}）` : "无推荐人"}`,
    resolvedType === "repeat"
      ? `奖励池接收人：${receiver ? `${receiver.name}（资格 ${receiver.repeatCredits}）` : "暂无"}`
      : "",
    "现有奖励记录：",
    ...rewardLines,
  ].join("\n");
}

function rewardDetailText(reward) {
  const user = findUser(reward.userId);
  const sourceUser = findUser(reward.sourceUserId);
  const order = (state.orders || []).find((item) => item.id === reward.orderId);
  const plan = order ? orderPlan(order) : null;
  const risks = rewardRiskLabels(reward);
  const expectedAmount = order ? +(Number(order.amount || 0) * (Number(reward.rate || 0) / 100)).toFixed(2) : 0;
  const amountGap = order ? Number((Number(reward.amount || 0) - expectedAmount).toFixed(2)) : 0;
  return [
    `奖励：${reward.id}`,
    `奖励人：${user ? `${user.name} / ${user.account}` : reward.userId}`,
    `来源用户：${sourceUser ? `${sourceUser.name} / ${sourceUser.account}` : rewardSourceText(reward)}`,
    `订单：${reward.orderId}`,
    `订单金额：${order ? money(order.amount) : "-"}`,
    `配套快照：${plan ? `${plan.name} / ${orderPlanSummary(plan)}` : "-"}`,
    `类型：${rewardTypeText(reward)}`,
    `比例：${Number(reward.rate || 0)}%`,
    `奖励金额：${rewardAmountText(reward)}`,
    `按订单金额应得：${order ? money(expectedAmount) : "-"}`,
    `计算差额：${order ? money(amountGap) : "-"}`,
    `状态：${labelStatus(reward.status)}`,
    `风控风险：${risks.length ? risks.join("；") : "无"}`,
    `可处理日：${rewardNextDateText(reward)}`,
    `审核备注：${reward.reviewNote || "-"}`,
    `创建时间：${reward.createdAt ? new Date(reward.createdAt).toLocaleString("zh-CN") : "-"}`,
    `审核时间：${reward.reviewedAt ? new Date(reward.reviewedAt).toLocaleString("zh-CN") : "-"}`,
  ].join("\n");
}

function withdrawDetailText(withdraw) {
  const user = findUser(withdraw.userId);
  if (!withdraw || !user) return "提现资料不完整";
  const breakdown = withdrawBreakdown(user.id);
  const risks = withdrawRiskLabels(withdraw);
  const sharedUsers = sharedWithdrawAccountUsers(withdraw.account, withdraw.userId);
  return [
    `提现申请：${withdraw.id}`,
    `用户：${user.name} / ${user.account}`,
    `申请金额：${money(withdraw.amount)}`,
    `来源：${withdraw.source === "reward" ? "奖励提现" : withdraw.source || "-"}`,
    `状态：${labelStatus(withdraw.status)}`,
    `收款方式：${withdraw.method || "-"}`,
    `收款账号：${withdraw.account || "-"}`,
    `风控风险：${risks.length ? risks.join("；") : "无"}`,
    `共享账号用户：${sharedUsers.length ? sharedUsers.map((item) => `${item.name} / ${item.account}`).join("；") : "无"}`,
    `审核备注：${withdraw.reviewNote || "-"}`,
    `提交时间：${new Date(withdraw.createdAt).toLocaleString("zh-CN")}`,
    `审核时间：${withdraw.reviewedAt ? new Date(withdraw.reviewedAt).toLocaleString("zh-CN") : "-"}`,
    `打款时间：${withdraw.paidAt ? new Date(withdraw.paidAt).toLocaleString("zh-CN") : "-"}`,
    "",
    "当前奖励提现组成：",
    `推荐奖励可提现：${money(breakdown.first)}`,
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
  const sharedAccountUsers = sharedWithdrawAccountUsers(user.withdrawAccount, user.id);
  const missingFields = profileMissingFields(user);
  return [
    `用户：${user.name}`,
    `账号：${user.account}`,
    `手机：${user.phone || "-"}`,
    `邀请码：${user.inviteCode}`,
    `推荐人：${referrer ? `${referrer.name} / ${referrer.inviteCode}` : "无"}`,
    `配套状态：${statusLabel}`,
    `账号状态：${user.frozen ? "已冻结" : "正常"}`,
    `资料状态：${missingFields.length ? "资料不完整" : "资料完整"}`,
    `缺失资料：${missingFields.length ? missingFields.join("、") : "无"}`,
    `默认收款：${[user.withdrawMethod, user.withdrawAccount].filter(Boolean).join(" / ") || "-"}`,
    `共享收款账号：${sharedAccountUsers.length ? sharedAccountUsers.map((item) => `${item.name} / ${item.account}`).join("；") : "无"}`,
    "",
    "余额与资格：",
    `充值积分：${points(user.points)}`,
    `可提现奖励：${money(breakdown.available)}`,
    `奖励池资格：${points(user.repeatCredits || 0)}`,
    `直接推荐：${referrals} / 开放`,
    "",
    "业务统计：",
    `订单：${orders.length} 笔，其中已支付 ${paidOrders.length} 笔，累计 ${money(paidOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0))}`,
    `奖励：${rewards.length} 笔`,
    `提现：${withdraws.length} 笔`,
    "",
    "提现组成：",
    `推荐奖励可提现：${money(breakdown.first)}`,
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
    "reversal-review": "退款待复核",
    "review-required": "需要复核",
    confirmed: "已确认",
    cancelled: "已取消",
    frozen: "已冻结",
    approved: "已通过",
    rejected: "已拒绝",
    paidout: "已打款",
  }[status] || status;
}

function rewardTypeText(reward) {
  if (reward.type === "first") return "推荐奖励";
  if (reward.rewardMode === "direct") return "下线复购奖励";
  if (reward.rewardMode === "pool") return "奖励池奖励";
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
  const inviteLink = firebaseUser && user.inviteCode ? `${location.origin}${location.pathname}?ref=${user.inviteCode}` : "-";
  document.querySelector("#memberName").textContent = user.inviteCode ? `${user.name}（${user.inviteCode}）` : user.name;
  renderMemberProfileStatus(user);
  document.querySelector("#memberPoints").textContent = points(user.points);
  document.querySelector("#memberConfirmed").textContent = money(confirmedAvailable(user.id));
  document.querySelector("#memberPoints").closest("span").title = "充值积分不可提现";
  document.querySelector("#memberConfirmed").closest("span").title = "推荐奖励和复购奖励可提现";
  document.querySelector("#memberSlots").textContent = `${used} / 开放`;
  document.querySelector("#memberRepeatCredits").textContent = points(user.repeatCredits || 0);
  document.querySelector("#memberPlanStatus").textContent = statusLabel;
  document.querySelector("#memberPlanStatus").className = `tag ${statusClass}`;
  renderMemberAlerts(user);
  renderMemberTabBadges(user);
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

function profileComplete(user) {
  return Boolean(user.phone && user.withdrawMethod && user.withdrawAccount);
}

function profileMissingFields(user) {
  return [
    user.phone ? "" : "手机号码",
    user.withdrawMethod ? "" : "默认收款方式",
    user.withdrawAccount ? "" : "默认收款账号",
  ].filter(Boolean);
}

function renderMemberProfileStatus(user) {
  let status = document.querySelector("#memberProfileStatus");
  const name = document.querySelector("#memberName");
  if (!status && name) {
    status = document.createElement("span");
    status.id = "memberProfileStatus";
    name.insertAdjacentElement("afterend", status);
  }
  if (!status) return;
  const complete = profileComplete(user);
  status.className = `profile-status ${complete ? "complete" : "incomplete"}`;
  status.textContent = complete ? "资料完整" : "资料待完善";
  if (complete) {
    status.removeAttribute("data-member-action");
    status.removeAttribute("role");
  } else {
    status.dataset.memberAction = "profile";
    status.setAttribute("role", "button");
  }
}

function memberAlertStats(user) {
  const orders = state.orders || [];
  const rewards = state.rewards || [];
  const withdraws = state.withdraws || [];
  return {
    pendingOrders: orders.filter((order) => order.userId === user.id && order.status === "pending").length,
    failedProofs: orders.filter((order) => order.userId === user.id && order.status === "pending" && order.proofStatus === "failed").length,
    pendingRewards: rewards.filter((reward) => reward.userId === user.id && ["pending", "releasing"].includes(reward.status)).length,
    pendingWithdraws: withdraws.filter((withdraw) => withdraw.userId === user.id && ["pending", "approved"].includes(withdraw.status)).length,
    missingProfile: !profileComplete(user),
  };
}

function memberAlertItems(user) {
  const stats = memberAlertStats(user);
  return [
    stats.pendingOrders ? { text: `${stats.pendingOrders} 笔充值订单等待后台确认`, tab: "memberPlans" } : null,
    stats.failedProofs ? { text: `${stats.failedProofs} 个付款凭证需要补传`, tab: "memberPlans" } : null,
    stats.pendingRewards ? { text: `${stats.pendingRewards} 笔奖励等待确认或释放`, tab: "memberRewards" } : null,
    stats.pendingWithdraws ? { text: `${stats.pendingWithdraws} 笔提现正在处理中`, tab: "memberWithdraw" } : null,
    stats.missingProfile ? { text: "联系或默认收款资料还不完整", action: "profile" } : null,
  ].filter(Boolean);
}

function renderMemberAlerts(user) {
  let box = document.querySelector("#memberAlertBox");
  const accountCard = document.querySelector(".account-card");
  if (!box && accountCard) {
    box = document.createElement("div");
    box.id = "memberAlertBox";
    box.className = "member-alert-box";
    accountCard.appendChild(box);
  }
  if (!box) return;
  const items = memberAlertItems(user);
  box.innerHTML = sanitizeHtml(items.length
    ? `<strong>待处理提醒</strong>${items.map((item) => `<button class="member-alert-item" type="button" ${item.tab ? `data-open-member-tab="${item.tab}"` : `data-member-action="${item.action}"`}>${item.text}</button>`).join("")}`
    : `<strong>待处理提醒</strong><span>目前没有需要处理的事项。</span>`);
  box.classList.toggle("empty", items.length === 0);
}

function memberAlertCounts(user) {
  const stats = memberAlertStats(user);
  return {
    plans: stats.pendingOrders + stats.failedProofs,
    rewards: stats.pendingRewards,
    withdraws: stats.pendingWithdraws,
  };
}

function renderMemberTabBadges(user) {
  const counts = memberAlertCounts(user);
  setTabBadge("memberPlans", counts.plans, counts.plans ? "warn" : "ok");
  setTabBadge("memberRewards", counts.rewards, counts.rewards ? "warn" : "ok");
  setTabBadge("memberWithdraw", counts.withdraws, counts.withdraws ? "warn" : "ok");
  setTabBadge("memberReferral", 0);
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
  if (!firebaseUser || !user.inviteCode) {
    codeBox?.remove();
    return;
  }
  if (!codeBox) {
    codeBox = document.createElement("div");
    codeBox.id = "inviteCodeBox";
    codeBox.className = "referral-code-box";
    inviteLinkBox.insertAdjacentElement("beforebegin", codeBox);
  }
  codeBox.innerHTML = sanitizeHtml(`
    <span>我的推荐码</span>
    <strong>${user.inviteCode}</strong>
    <small>朋友也可以直接输入这个推荐码绑定。</small>
    <button class="button ghost compact-button" type="button" data-copy-invite-code="${user.inviteCode}">复制推荐码</button>
  `);
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
  box.innerHTML = sanitizeHtml(`
    <span>推荐奖励可提现 <strong>${money(breakdown.first)}</strong></span>
    <span>复购奖励已释放 <strong>${money(breakdown.repeatReleased)}</strong></span>
    <span>复购奖励待释放 <strong>${money(breakdown.pendingRelease)}</strong></span>
    <span>已申请/处理中 <strong>${money(breakdown.requested)}</strong></span>
  `);
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
  document.querySelector("#memberPlanCards").innerHTML = sanitizeHtml(state.plans.map((plan) => {
    const validAmount = isValidPackageAmount(plan.amount);
    return `
      <article class="plan-card">
        <strong>${plan.name} · ${money(plan.amount)}</strong>
        <span>配套单位：${packageUnitLabel(plan.amount)} / 发放积分：${points(plan.points)}</span>
        <span>直接推荐：开放 / 有效期：${plan.validDays} 天</span>
        <span>奖励池资格：每直接推荐 1 人解锁 1 个，最多 ${MAX_REPEAT_POOL_CREDITS} 个 / 冷却：${planRepeatCooldownHours(plan)} 小时</span>
        <span>奖励：推荐 ${plan.firstRate}% / 下线复购 ${planDirectRepeatRate(plan)}% / 奖励池 ${planPoolRepeatRate(plan)}%</span>
        ${validAmount
          ? `<button class="button primary" data-buy-plan="${plan.id}" data-buy-type="${nextType}">申请充值配套</button>`
          : `<button class="button ghost" type="button" disabled>金额需为 RM${PACKAGE_UNIT_AMOUNT} 整数倍</button>`}
      </article>
    `;
  }).join(""));
}

function renderMemberOrders(user) {
  const rows = state.orders.filter((order) => order.userId === user.id).slice().reverse().map((order) => {
    const plan = orderPlan(order);
    const noteText = order.reviewNote ? `<span class="muted-line">处理备注：${order.reviewNote}</span>` : "";
    const summaryText = order.confirmSummary ? `<span class="muted-line">处理结果：${order.confirmSummary}</span>` : "";
    return `<tr><td>${order.id}</td><td>${plan?.name || "-"}</td><td>${order.type === "first" ? "首充" : "复购"}</td><td>${money(order.amount)}</td><td>${points(order.points)}</td><td><span class="tag ${order.status}">${labelStatus(order.status)}</span>${noteText}${summaryText}</td><td>${new Date(order.createdAt).toLocaleString("zh-CN")}</td><td><button class="link" type="button" data-member-order-detail="${order.id}">详情</button></td></tr>`;
  }).join("");
  document.querySelector("#memberOrderTable").innerHTML = sanitizeHtml(rows || `<tr><td colspan="8">暂无订单</td></tr>`);
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
  document.querySelector("#memberReferralTable").innerHTML = sanitizeHtml(rows || `<tr><td colspan="5">暂无直接推荐用户</td></tr>`);
}

function rewardSourceText(reward) {
  const sourceUser = findUser(reward.sourceUserId);
  if (sourceUser) return sourceUser.name || sourceUser.account || sourceUser.inviteCode || sourceUser.id;
  const referral = (state.referrals || []).find((item) => item.inviteeId === reward.sourceUserId);
  return reward.sourceUserName
    || referral?.inviteeName
    || reward.sourceUserAccount
    || referral?.inviteeAccount
    || reward.sourceUserId
    || "-";
}

function renderRewardRules() {
  document.querySelector("#rewardRules").innerHTML = sanitizeHtml(state.plans.map((plan) => `
    <article class="rule-card">
      <strong>${plan.name}</strong>
      <span>配套单位：${packageUnitLabel(plan.amount)}，奖励按 RM${PACKAGE_UNIT_AMOUNT} 单位统一计算。</span>
      <span>推荐奖励：下线首次购买 ${money(plan.amount)}，推荐人获得 ${money(plan.amount * plan.firstRate / 100)}。</span>
      <span>下线复购奖励：下线复购时，原推荐人获得 ${money(plan.amount * planDirectRepeatRate(plan) / 100)}，需推荐人配套有效。</span>
      <span>奖励池资格：每直接推荐 1 人解锁 1 个，最多 ${MAX_REPEAT_POOL_CREDITS} 个；派发成功扣 1 个资格。</span>
      <span>奖励池奖励：后续复购订单会自动派发给奖励池用户，每次约 ${money(plan.amount * planPoolRepeatRate(plan) / 100)}，并扣 1 个资格。</span>
      <span>${TEST_INSTANT_MODE ? "测试期奖励即时确认/释放，方便连续测试。" : `奖励先待确认，${CONFIRM_DAYS} 天后由后台确认。`}</span>
    </article>
  `).join(""));
}

function renderMemberRewards(user) {
  const rows = state.rewards.filter((reward) => reward.userId === user.id).slice().reverse().map((reward) => {
    const noteText = reward.reviewNote ? `<span class="muted-line">审核备注：${reward.reviewNote}</span>` : "";
    return `<tr><td>${rewardSourceText(reward)}</td><td>${reward.orderId}</td><td>${rewardTypeText(reward)}</td><td>${reward.rate}%</td><td>${rewardAmountText(reward)}</td><td><span class="tag ${reward.status}">${labelStatus(reward.status)}</span>${noteText}</td><td>${rewardNextDateText(reward)}</td><td><button class="link" type="button" data-member-reward-detail="${reward.id}">详情</button></td></tr>`;
  }).join("");
  document.querySelector("#memberRewardTable").innerHTML = sanitizeHtml(rows || `<tr><td colspan="8">暂无奖励</td></tr>`);
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
  table.innerHTML = sanitizeHtml(rows || `<tr><td colspan="5">暂无奖励池资格流水</td></tr>`);
}

function renderMemberWithdraws(user) {
  const rows = state.withdraws.filter((item) => item.userId === user.id).slice().reverse().map((item) => {
    const paidText = item.paidAt ? new Date(item.paidAt).toLocaleString("zh-CN") : "-";
    const noteText = item.reviewNote ? `<span class="muted-line">备注：${item.reviewNote}</span>` : "";
    return `<tr><td>${item.id}</td><td>${money(item.amount)}</td><td>${item.source === "reward" ? "奖励提现" : item.source || "-"}</td><td>${item.method}</td><td>${item.account}</td><td><span class="tag ${item.status}">${labelStatus(item.status)}</span>${noteText}</td><td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td><td>${paidText}</td><td><button class="link" type="button" data-member-withdraw-detail="${item.id}">详情</button></td></tr>`;
  }).join("");
  document.querySelector("#memberWithdrawTable").innerHTML = sanitizeHtml(rows || `<tr><td colspan="9">暂无提现记录</td></tr>`);
}

function renderAdmin() {
  document.querySelector("#metricUsers").textContent = state.users.length;
  document.querySelector("#metricSales").textContent = money(state.orders.filter((order) => order.status === "paid").reduce((sum, order) => sum + order.amount, 0));
  document.querySelector("#metricPendingOrders").textContent = state.orders.filter((order) => order.status === "pending").length;
  document.querySelector("#metricPendingRewards").textContent = money(state.rewards.filter((reward) => ["pending", "releasing"].includes(reward.status)).reduce((sum, reward) => sum + (Number(reward.amount || 0) - Number(reward.releasedAmount || 0)), 0));
  document.querySelector("#metricWithdraws").textContent = money(state.withdraws.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.amount, 0));
  const summary = readinessSummary();
  const readinessMetric = document.querySelector("#metricReadiness");
  readinessMetric.textContent = summary.label;
  readinessMetric.className = summary.status === "ready" ? "metric-ok" : "metric-warn";
  ensurePlanCooldownField();
  ensurePlanCancelButton();
  ensureRewardStatusOptions();
  renderAdminTodos();
  renderAdminTabBadges();
  renderAdminPlans();
  renderAdminUsers();
  renderRepeatCreditLogs();
  renderAdminOrders();
  renderExternalIntegrationSummary();
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
  const orderRisks = orderRiskIssues(state);
  const withdrawRisks = withdrawRiskIssues(state);
  const duplicateRisks = duplicateOrderRisks(state);
  const rewardIssues = rewardIntegrityIssues(state);
  const integrityIssues = dataIntegrityIssues(state, { includeProfileIssues: false, includeOrderIssues: false, includeRewardIssues: false, includeWithdrawIssues: false });
  const failedExternalOrders = (state.externalOrders || []).filter((item) =>
    item.status === "confirmation-failed"
  );
  const reversalCases = (state.reversalCases || []).filter((item) =>
    item.status === "review-required"
  );

  return [
    {
      title: "POS 订单同步异常",
      count: failedExternalOrders.length,
      level: failedExternalOrders.length ? "danger" : "ok",
      detail: failedExternalOrders.length
        ? `${failedExternalOrders.length} 笔 POS 订单未能完成联盟确认。`
        : "POS 外部订单没有确认异常。",
      action: "到订单管理查看",
      tab: "adminOrders",
      focus: "externalOrders",
    },
    {
      title: "退款奖励待复核",
      count: reversalCases.length,
      level: reversalCases.length ? "danger" : "ok",
      detail: reversalCases.length
        ? `${reversalCases.length} 笔退款涉及已释放奖励或积分不足，相关奖励已冻结。`
        : "没有需要人工复核的退款奖励。",
      action: "到订单管理查看",
      tab: "adminOrders",
      focus: "reversalCases",
    },
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
      title: "订单风控风险",
      count: orderRisks.length,
      level: orderRisks.length ? "danger" : "ok",
      detail: orderRisks.length ? orderRisks.slice(0, 2).join("；") : "没有发现订单风控风险。",
      action: "到订单管理查看",
      tab: "adminOrders",
      focus: "orderRisks",
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
      title: "奖励发放异常",
      count: rewardIssues.length,
      level: rewardIssues.length ? "danger" : "ok",
      detail: rewardIssues.length ? rewardIssues.slice(0, 2).join("；") : "奖励发放规则正常。",
      action: "到奖励审核查看",
      tab: "adminRewards",
      focus: "rewardIssues",
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
      title: "提现风控风险",
      count: withdrawRisks.length,
      level: withdrawRisks.length ? "danger" : "ok",
      detail: withdrawRisks.length ? `${withdrawRisks.length} 项提现风控风险。` : "没有发现提现风控风险。",
      action: "到提现审核查看",
      tab: "adminWithdraws",
      focus: "withdrawRisks",
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
  ];
}

function renderAdminTodos() {
  const target = document.querySelector("#adminTodoList");
  if (!target) return;
  const items = adminTodoItems();
  const activeItems = items.filter((item) => Number(item.count || 0) > 0);
  if (!activeItems.length) {
    target.innerHTML = `
      <article class="todo-card ok">
        <span>业务待办</span>
        <strong>0</strong>
        <p>没有待审核订单、奖励、提现或业务风控风险。用户资料和上线自检请到风控规则页查看。</p>
        <button class="link" type="button" data-open-admin-tab="adminRisk" data-todo-focus="readiness">到风控规则查看</button>
      </article>
    `;
    return;
  }
  target.innerHTML = sanitizeHtml(activeItems.map((item) => `
    <article class="todo-card ${item.level}">
      <span>${item.title}</span>
      <strong>${item.count}</strong>
      <p>${item.detail}</p>
      <button class="link" type="button" data-open-admin-tab="${item.tab}" data-todo-focus="${item.focus}">${item.action}</button>
    </article>
  `).join(""));
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
  field.innerHTML = `复购冷却小时<input name="repeatCooldownHours" type="number" min="0" step="1" value="0" required />`;
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

function syncPlanUnitFields() {
  const form = document.querySelector("#planForm");
  if (!form) return;
  const amountInput = form.querySelector("[name='amount']");
  const pointsInput = form.querySelector("[name='points']");
  if (!amountInput || !pointsInput) return;
  const amount = Number(amountInput.value || 0);
  if (isValidPackageAmount(amount)) {
    pointsInput.value = packageUnits(amount) * PACKAGE_UNIT_POINTS;
    amountInput.setCustomValidity("");
  } else {
    if (amount > 0) amountInput.setCustomValidity(`充值金额必须是 RM${PACKAGE_UNIT_AMOUNT} 的整数倍`);
    if (!pointsInput.value) pointsInput.value = "";
  }
}

function planUsed(planId) {
  return (state.orders || []).some((order) =>
    order.planId === planId
    && ["pending", "paid"].includes(order.status)
    && recordIsAfterTestClear(order)
  );
}

function planFromForm(form) {
  const amount = Number(form.get("amount"));
  const units = isValidPackageAmount(amount) ? packageUnits(amount) : 0;
  return {
    name: form.get("name").trim(),
    amount,
    unitAmount: PACKAGE_UNIT_AMOUNT,
    unitCount: units,
    points: units ? units * PACKAGE_UNIT_POINTS : Number(form.get("points")),
    slots: Number(form.get("slots")),
    repeatCredits: Math.min(Number(form.get("repeatCredits")), MAX_REPEAT_POOL_CREDITS),
    repeatCooldownHours: Number(form.get("repeatCooldownHours") || 0),
    validDays: Number(form.get("validDays")),
    firstRate: Number(form.get("firstRate")),
    directRepeatRate: Number(form.get("directRepeatRate") || 10),
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
  form.querySelector("[name='directRepeatRate']").value = planDirectRepeatRate(plan);
  form.querySelector("[name='repeatRate']").value = planPoolRepeatRate(plan);
  const button = form.querySelector("button[type='submit']");
  if (button) button.textContent = "保存配套";
  const cancelButton = form.querySelector("#cancelPlanEditBtn");
  if (cancelButton) cancelButton.hidden = false;
  syncPlanUnitFields();
}

function resetPlanForm() {
  const form = document.querySelector("#planForm");
  if (!form) return;
  form.reset();
  editingPlanId = "";
  syncPlanUnitFields();
  const button = form.querySelector("button[type='submit']");
  if (button) button.textContent = "新增配套";
  const cancelButton = form.querySelector("#cancelPlanEditBtn");
  if (cancelButton) cancelButton.hidden = true;
}

function renderAdminPlans() {
  document.querySelector("#adminPlanList").innerHTML = sanitizeHtml(state.plans.map((plan) => `
    <article class="plan-card">
      <strong>${plan.name} · ${money(plan.amount)}</strong>
      <span>单位 ${packageUnitLabel(plan.amount)} / 积分 ${points(plan.points)} / 直接推荐开放 / 奖励池资格上限 ${MAX_REPEAT_POOL_CREDITS} 个</span>
      <span>冷却 ${planRepeatCooldownHours(plan)} 小时 / 有效期 ${plan.validDays} 天 / 推荐 ${plan.firstRate}% / 下线复购 ${planDirectRepeatRate(plan)}% / 奖励池 ${planPoolRepeatRate(plan)}%</span>
      <div class="actions">
        <button class="link" type="button" data-edit-plan="${plan.id}">编辑</button>
        ${planUsed(plan.id) ? `<span class="muted-line">已有待处理或已付款订单，不能删除</span>` : `<button class="link danger-link" type="button" data-delete-plan="${plan.id}">删除</button>`}
      </div>
    </article>
  `).join(""));
}

function renderAdminUsers() {
  const userOptions = state.users.map((user) => `<option value="${user.id}">${user.name}（${user.inviteCode}）</option>`).join("");
  document.querySelector("#pointsForm [name='userId']").innerHTML = sanitizeHtml(userOptions);
  document.querySelector("#repeatCreditsForm [name='userId']").innerHTML = sanitizeHtml(userOptions);
  const users = filteredUsers();
  document.querySelector("#adminUserTable").innerHTML = sanitizeHtml(users.map((user) => {
    const referrer = findUser(user.referrerId);
    const [statusClass, statusLabel] = packageStatus(user);
    const sharedUsers = sharedWithdrawAccountUsers(user.withdrawAccount, user.id);
    const payoutRisk = sharedUsers.length ? `<span class="risk-line">共享账号 ${sharedUsers.length}</span>` : "-";
    const missingFields = profileMissingFields(user);
    const profileRisk = missingFields.length ? `<span class="profile-line">缺：${missingFields.join("、")}</span>` : "";
    return `<tr><td>${user.name}${profileRisk}</td><td>${user.account}</td><td>${user.phone || "-"}</td><td>${user.inviteCode}</td><td>${referrer?.name || "无"}</td><td>${points(user.points)}</td><td><span class="tag ${statusClass}">${statusLabel}</span></td><td>${directReferralCount(user.id)} / 开放</td><td>${points(user.repeatCredits || 0)}</td><td>${payoutRisk}</td><td><span class="tag ${user.frozen ? "frozen" : "active"}">${user.frozen ? "已冻结" : "正常"}</span></td><td><button class="link" data-user-detail="${user.id}">详情</button><button class="link" data-export-user-records="${user.id}">导出</button><button class="link" data-freeze-user="${user.id}">${user.frozen ? "解冻" : "冻结"}</button></td></tr>`;
  }).join("") || `<tr><td colspan="12">没有符合条件的用户</td></tr>`);
}

function repeatCreditReasonText(reason) {
  return {
    earned: "资格获得",
    referral: "推荐解锁",
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
        <option value="earned">资格获得</option>
        <option value="referral">推荐解锁</option>
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
  select.innerHTML = sanitizeHtml([`<option value="all">全部用户</option>`, ...options].join(""));
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
  table.innerHTML = sanitizeHtml(rows || `<tr><td colspan="6">暂无奖励池资格流水</td></tr>`);
}

function renderExternalIntegrationSummary() {
  const target = document.querySelector("#externalIntegrationSummary");
  if (!target) return;
  const externalOrders = state.externalOrders || [];
  const reversalCases = state.reversalCases || [];
  const paid = externalOrders.filter((item) => item.status === "paid").length;
  const failed = externalOrders.filter((item) => item.status === "confirmation-failed").length;
  const reversed = externalOrders.filter((item) => item.status === "reversed").length;
  const reviews = reversalCases.filter((item) => item.status === "review-required").length;
  target.textContent = `POS 外部订单 ${externalOrders.length} 笔：已确认 ${paid}、确认异常 ${failed}、已撤销 ${reversed}、退款待复核 ${reviews}`;
  target.classList.toggle("risk-line", failed > 0 || reviews > 0);
}

function renderAdminOrders() {
  const orders = filteredOrders();
  const rows = orders.slice().reverse().map((order) => {
    const user = findUser(order.userId);
    const plan = orderPlan(order);
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
    const riskText = orderRiskLabels(order).map((label) => `<span class="risk-line">${label}</span>`).join("");
    const summaryText = order.confirmSummary ? `<span class="muted-line">处理结果：${order.confirmSummary}</span>` : "";
    const paymentText = `${paymentMethodText(order.paymentMethod)} ${order.paymentRef || ""}${order.paymentNote ? ` / ${order.paymentNote}` : ""}${proofText}${proofLink}${riskText}${summaryText}`.trim() || "-";
    return `<tr><td>${order.id}</td><td>${user?.name || "-"}</td><td>${plan?.name || "-"}</td><td>${resolvedType === "first" ? "首充" : "复购"}${typeWarning}</td><td>${money(order.amount)}</td><td>${paymentText}</td><td>${points(order.points)}</td><td><span class="tag ${order.status}">${labelStatus(order.status)}</span></td><td>${new Date(order.createdAt).toLocaleString("zh-CN")}</td><td class="actions">${detailAction}${actions}</td></tr>`;
  }).join("");
  document.querySelector("#adminOrderTable").innerHTML = sanitizeHtml(rows || `<tr><td colspan="10">没有符合条件的订单</td></tr>`);
}

function renderAdminRewards() {
  const rewards = filteredRewards();
  const rows = rewards.slice().reverse().map((reward) => {
    const user = findUser(reward.userId);
    const sourceUser = findUser(reward.sourceUserId);
    const canConfirm = ["pending", "releasing"].includes(reward.status) && new Date(reward.confirmAfter) <= new Date();
    const detailAction = `<button class="link" data-reward-detail="${reward.id}">详情</button>`;
    const riskText = rewardRiskLabels(reward).map((label) => `<span class="risk-line">${label}</span>`).join("");
    return `<tr><td>${user?.name || "-"}</td><td>${sourceUser?.name || "-"}</td><td>${reward.orderId}</td><td>${rewardTypeText(reward)}</td><td>${rewardAmountText(reward)}${reward.reviewNote ? `<span class="muted-line">备注：${reward.reviewNote}</span>` : ""}${riskText}</td><td><span class="tag ${reward.status}">${labelStatus(reward.status)}</span></td><td>${rewardNextDateText(reward)}</td><td class="actions">${detailAction}${canConfirm ? `<button class="link" data-confirm-reward="${reward.id}">确认</button>` : ""}${["pending", "releasing"].includes(reward.status) ? `<button class="link" data-cancel-reward="${reward.id}">取消</button><button class="link" data-freeze-reward="${reward.id}">冻结</button>` : ""}</td></tr>`;
  }).join("");
  document.querySelector("#adminRewardTable").innerHTML = sanitizeHtml(rows || `<tr><td colspan="8">没有符合条件的奖励</td></tr>`);
}

function renderAdminWithdraws() {
  const withdraws = filteredWithdraws();
  const rows = withdraws.slice().reverse().map((item) => {
    const user = findUser(item.userId);
    const detailAction = `<button class="link" data-withdraw-detail="${item.id}">详情</button>`;
    const riskText = withdrawRiskLabels(item).map((label) => `<span class="risk-line">${label}</span>`).join("");
    return `<tr><td>${item.id}</td><td>${user?.name || "-"}</td><td>${money(item.amount)}</td><td>${item.source === "reward" ? "奖励提现" : item.source || "-"}</td><td>${item.method}</td><td>${item.account}${riskText}</td><td><span class="tag ${item.status}">${labelStatus(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td><td class="actions">${detailAction}${item.status === "pending" ? `<button class="link" data-approve-withdraw="${item.id}">通过</button><button class="link" data-reject-withdraw="${item.id}">拒绝</button>` : ""}${item.status === "approved" ? `<button class="link" data-pay-withdraw="${item.id}">标记打款</button>` : ""}</td></tr>`;
  }).join("");
  document.querySelector("#adminWithdrawTable").innerHTML = sanitizeHtml(rows || `<tr><td colspan="9">没有符合条件的提现申请</td></tr>`);
}

function readinessChecks() {
  const usablePlans = (state.plans || []).filter((plan) =>
    Number(plan.amount || 0) > 0
    && isValidPackageAmount(plan.amount)
    && Number(plan.points || 0) > 0
    && Number(plan.validDays || 0) > 0
    && Number(plan.firstRate || 0) >= 0
    && planDirectRepeatRate(plan) >= 0
    && planPoolRepeatRate(plan) >= 0
  );
  const users = state.users || [];
  const paidOrders = (state.orders || []).filter((order) => order.status === "paid");
  const adminUsers = users.filter((user) => ADMIN_EMAILS.includes(user.email));
  const incompleteProfiles = incompleteProfileUsers(state);
  const pendingOrders = (state.orders || []).filter((order) => order.status === "pending");
  const orderRisks = orderRiskIssues(state);
  const pendingWithdraws = (state.withdraws || []).filter((withdraw) => withdraw.status === "pending");
  const withdrawRisks = withdrawRiskIssues(state);
  const pendingRewards = (state.rewards || []).filter((reward) => reward.status === "pending" || reward.status === "releasing");
  const rewardIssues = rewardIntegrityIssues(state);
  const integrityIssues = dataIntegrityIssues(state, { includeProfileIssues: false, includeOrderIssues: false, includeRewardIssues: false, includeWithdrawIssues: false });
  const testChecklist = testChecklistReport();

  return [
    {
      ok: usablePlans.length > 0,
      label: "至少 1 个可用配套",
      detail: usablePlans.length ? `当前可用 ${usablePlans.length} 个配套` : "请先在左侧新增完整配套规则",
    },
    {
      ok: adminUsers.length > 0 || isAdmin(),
      label: "管理员账号可识别",
      detail: adminUsers.length ? `已识别 ${adminUsers.length} 个管理员用户` : `当前管理员邮箱：${ADMIN_EMAILS.join(" / ")}`,
    },
    {
      ok: users.length === 0 || incompleteProfiles.length === 0,
      label: "用户联系与收款资料",
      detail: incompleteProfiles.length ? `${incompleteProfiles.length} 个用户还未填写完整手机或默认收款资料` : "用户联系与收款资料完整",
    },
    {
      ok: pendingOrders.length === 0,
      label: "待处理充值订单",
      detail: pendingOrders.length ? `${pendingOrders.length} 笔订单等待审核` : "没有待处理充值订单",
    },
    {
      ok: orderRisks.length === 0,
      label: "订单风控风险",
      detail: orderRisks.length ? `${orderRisks.length} 项订单风控风险` : "没有订单风控风险",
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
      ok: withdrawRisks.length === 0,
      label: "提现风控风险",
      detail: withdrawRisks.length ? `${withdrawRisks.length} 项提现风控风险` : "没有提现风控风险",
    },
    {
      ok: paidOrders.every((order) => Number(order.points || 0) > 0),
      label: "已付款订单积分",
      detail: paidOrders.some((order) => Number(order.points || 0) <= 0)
        ? "存在已付款但积分为 0 的订单，请查看订单详情"
        : "已付款订单积分正常",
    },
    {
      ok: paidOrders.every((order) => order.confirmSummary),
      label: "订单处理结果摘要",
      detail: paidOrders.some((order) => !order.confirmSummary)
        ? "存在已付款订单缺少处理结果摘要，请保存一次数据或查看订单详情"
        : "已付款订单处理结果可追踪",
    },
    {
      ok: rewardIssues.length === 0,
      label: "奖励发放规则",
      detail: rewardIssues.length
        ? `${rewardIssues.length} 项奖励异常：${rewardIssues.slice(0, 2).join("；")}${rewardIssues.length > 2 ? "；..." : ""}`
        : "推荐奖励、下线复购奖励、奖励池奖励、金额和分期释放正常",
    },
    {
      ok: integrityIssues.length === 0,
      label: "数据一致性",
      detail: integrityIssues.length
        ? `${integrityIssues.length} 项异常：${integrityIssues.slice(0, 3).join("；")}${integrityIssues.length > 3 ? "；..." : ""}`
        : "推荐、订单、奖励、提现关系正常",
    },
    {
      ok: testChecklist.done === testChecklist.total,
      label: "实机测试清单",
      detail: testChecklist.done === testChecklist.total
        ? `已完成 ${testChecklist.done}/${testChecklist.total} 项实机测试`
        : `还有 ${testChecklist.total - testChecklist.done} 项未完成，建议上线前逐项勾选`,
    },
  ];
}

function readinessSummary() {
  const checks = readinessChecks();
  const failedChecks = checks.filter((check) => !check.ok);
  const testCheck = checks.find((check) => check.label === "实机测试清单");
  const deployChecklist = deployChecklistReport();
  const pendingDeployCount = deployChecklist.total - deployChecklist.done;
  const nonTestFailures = failedChecks.filter((check) => check.label !== "实机测试清单");
  if (nonTestFailures.length) {
    return {
      status: "blocked",
      label: `待处理 ${failedChecks.length}`,
      detail: `${nonTestFailures.length} 项基础自检未通过`,
      failedChecks,
    };
  }
  if (testCheck && !testCheck.ok) {
    return {
      status: "testing",
      label: "待测试",
      detail: testCheck.detail,
      failedChecks,
    };
  }
  if (pendingDeployCount > 0) {
    return {
      status: "deploying",
      label: "待部署检查",
      detail: `还有 ${pendingDeployCount} 项部署检查未完成`,
      failedChecks,
    };
  }
  return {
    status: "ready",
    label: "可准备上线",
    detail: "基础自检、实机测试和部署检查已完成",
    failedChecks,
  };
}

function cloudFunctionStatusReport() {
  return {
    status: "deferred",
    label: "后置阶段",
    requiredForMvp: false,
    callable: "confirmOrder",
    detail: "Cloud Functions 代码已准备，但当前仍允许管理员前端确认作为 MVP 回退；正式扩大使用前建议启用服务端确认。",
  };
}

function rulesStatusReport() {
  return {
    status: "manual-check",
    label: "需手动确认",
    firestoreRules: "firestore.rules",
    storageRules: "storage.rules",
    detail: "上线前请在 Firebase Console 发布最新 firestore.rules 与 storage.rules，然后用普通用户账号提交订单、上传凭证、申请提现做实测。",
  };
}

function deploymentStatusReport() {
  return {
    status: "manual-check",
    label: "需手动确认",
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    publicSiteUrl: PUBLIC_SITE_URL,
    hostingPublic: ".",
    detail: `部署网址：${PUBLIC_SITE_URL}。请确认 Firebase Authentication 已授权当前域名，并确认 app.js 版本参数已更新。`,
  };
}

function renderAdminRiskRules() {
  const target = document.querySelector("#adminRiskList");
  if (!target) return;
  const planCooldowns = state.plans.map((plan) => `${plan.name}: ${planRepeatCooldownHours(plan)} 小时`).join(" / ");
  const orderIssues = orderRiskIssues(state);
  const rewardIssues = rewardIntegrityIssues(state);
  const withdrawIssues = withdrawRiskIssues(state);
  const checks = readinessChecks();
  const summary = readinessSummary();
  const cloudFunctions = cloudFunctionStatusReport();
  const rulesStatus = rulesStatusReport();
  const deploymentStatus = deploymentStatusReport();
  target.innerHTML = sanitizeHtml([
    {
      title: "上线前自检",
      rows: [
        summary.status === "ready" ? "基础自检、实机测试和部署检查已完成，可准备上线。" : `${summary.label}：${summary.detail}`,
        `页面前端版本：${APP_VERSION}。`,
        ...checks.map((check) => `<b class="${check.ok ? "check-ok" : "check-warn"}">${check.ok ? "通过" : "待处理"}</b> ${check.label}：${check.detail}`),
      ],
    },
    {
      title: "复购冷却",
      rows: [
        TEST_INSTANT_MODE ? "测试即时模式已开启：复购付款确认后冷却为 0 小时。" : "复购付款确认后，用户进入冷却期。",
        `当前配套冷却：${planCooldowns || "暂无配套"}`,
        "冷却期内不能再次提交复购订单；已有待确认复购订单也不能重复提交。",
      ],
    },
    {
      title: "复购奖励分期",
      rows: [
        TEST_INSTANT_MODE ? "测试即时模式已开启：下线复购奖励和奖励池奖励会即时释放。" : `下线复购奖励和奖励池奖励分 ${REPEAT_RELEASE_DAYS.length} 期释放。`,
        `释放日：第 ${REPEAT_RELEASE_DAYS.join(" / 第 ")} 天。`,
        "只有已释放金额会计入用户可提现余额。",
      ],
    },
    {
      title: "奖励池派发规则",
      rows: [
        `用户每直接推荐 1 人解锁 1 个奖励池资格，最多 ${MAX_REPEAT_POOL_CREDITS} 个；买家不会接收自己这笔复购的奖励池奖励。`,
        "系统优先派发给奖励池中排队最早且未冻结的用户。",
        "派发成功后接收人扣 1 个奖励池资格。",
      ],
    },
    {
      title: "奖励发放自检",
      rows: rewardIssues.length
        ? [
          `<b class="check-warn">发现 ${rewardIssues.length} 项奖励异常</b>`,
          ...rewardIssues.slice(0, 6),
          rewardIssues.length > 6 ? `还有 ${rewardIssues.length - 6} 项，请导出异常报告查看。` : "",
        ].filter(Boolean)
        : [
          `<b class="check-ok">奖励发放规则正常</b>`,
          "推荐奖励、下线复购奖励、奖励池奖励、金额和分期释放未发现异常。",
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
      title: "订单风控自检",
      rows: orderIssues.length
        ? [
          `<b class="check-warn">发现 ${orderIssues.length} 项订单风控风险</b>`,
          ...orderIssues.slice(0, 6),
          orderIssues.length > 6 ? `还有 ${orderIssues.length - 6} 项，请导出异常报告查看。` : "",
        ].filter(Boolean)
        : [
          `<b class="check-ok">订单风控正常</b>`,
          "没有发现重复付款参考号、重复凭证、金额或配套异常。",
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
      title: "提现风控自检",
      rows: withdrawIssues.length
        ? [
          `<b class="check-warn">发现 ${withdrawIssues.length} 项提现风控风险</b>`,
          ...withdrawIssues.slice(0, 6),
          withdrawIssues.length > 6 ? `还有 ${withdrawIssues.length - 6} 项，请导出异常报告查看。` : "",
        ].filter(Boolean)
        : [
          `<b class="check-ok">提现风控正常</b>`,
          "没有发现共享收款账号等提现风险。",
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
    {
      title: "管理员上线顺序",
      rows: [
        "1. 发布最新 index.html、app.js、styles.css。",
        "2. 到 Firebase Console 发布最新 firestore.rules 和 storage.rules。",
        "3. 用管理员账号登录，确认后台指标、待办中心、风控页正常。",
        "4. 用普通用户账号完成首充、复购、提现全流程实测。",
        "5. 风控页没有未处理异常后，再对外开放链接。",
      ],
    },
    {
      title: "Rules 发布状态",
      rows: [
        `Firestore：${rulesStatus.firestoreRules}。`,
        `Storage：${rulesStatus.storageRules}。`,
        rulesStatus.detail,
      ],
    },
    {
      title: "部署环境状态",
      className: "wide-card",
      rows: [
        `Firebase 项目：${deploymentStatus.projectId}。`,
        `Auth 域名：${deploymentStatus.authDomain}。`,
        `Hosting public：${deploymentStatus.hostingPublic}。`,
        deploymentStatus.detail,
        ...renderDeployChecklistRows(),
      ],
    },
    {
      title: "Cloud Functions 状态",
      rows: [
        `当前状态：${cloudFunctions.label}。`,
        `调用函数：${cloudFunctions.callable}。`,
        cloudFunctions.detail,
      ],
    },
    {
      title: "实机测试清单",
      className: "wide-card",
      rows: renderTestChecklistRows(),
    },
  ].map((card) => `
    <article class="risk-card ${card.className || ""}">
      <strong>${card.title}</strong>
      ${card.rows.map((row) => `<span>${row}</span>`).join("")}
    </article>
  `).join(""));
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
  document.querySelector("#adminLogTable").innerHTML = sanitizeHtml(rows || `<tr><td colspan="5">没有符合条件的操作日志</td></tr>`);
}

function renderLogActionOptions() {
  const select = document.querySelector("#logActionFilter");
  if (!select) return;
  const currentValue = select.value || "all";
  const actions = [...new Set((state.adminLogs || []).map((log) => log.action).filter(Boolean))].sort();
  select.innerHTML = sanitizeHtml([
    `<option value="all">全部动作</option>`,
    ...actions.map((action) => `<option value="${action}">${action}</option>`),
  ].join(""));
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
  const orderIssues = orderRiskIssues(state);
  const rewardIssues = rewardIntegrityIssues(state);
  const withdrawIssues = withdrawRiskIssues(state);
  const integrityIssues = dataIntegrityIssues(state, { includeOrderIssues: false, includeRewardIssues: false, includeWithdrawIssues: false });
  const testChecklist = testChecklistReport();
  const deployChecklist = deployChecklistReport();
  const readinessStatus = readinessSummary();
  const cloudFunctions = cloudFunctionStatusReport();
  const rulesStatus = rulesStatusReport();
  const deploymentStatus = deploymentStatusReport();
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
      orderIssues: orderIssues.length,
      rewardIssues: rewardIssues.length,
      withdrawIssues: withdrawIssues.length,
      integrityIssues: integrityIssues.length,
      testChecklistDone: testChecklist.done,
      testChecklistTotal: testChecklist.total,
      deployChecklistDone: deployChecklist.done,
      deployChecklistTotal: deployChecklist.total,
      readinessStatus: readinessStatus.status,
      readinessLabel: readinessStatus.label,
      readinessDetail: readinessStatus.detail,
      cloudFunctionsStatus: cloudFunctions.status,
      cloudFunctionsRequiredForMvp: cloudFunctions.requiredForMvp,
      rulesStatus: rulesStatus.status,
      deploymentStatus: deploymentStatus.status,
    },
    riskReport: {
      summary: readinessStatus,
      cloudFunctions,
      rulesStatus,
      deploymentStatus,
      checks: readiness,
      orderIssues,
      rewardIssues,
      withdrawIssues,
      integrityIssues,
      testChecklist,
      deployChecklist,
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
  const issues = dataIntegrityIssues(state, { includeOrderIssues: false, includeRewardIssues: false, includeWithdrawIssues: false });
  const orderIssues = orderRiskIssues(state);
  const rewardIssues = rewardIntegrityIssues(state);
  const withdrawIssues = withdrawRiskIssues(state);
  const testChecklist = testChecklistReport();
  const deployChecklist = deployChecklistReport();
  const readinessStatus = readinessSummary();
  const cloudFunctions = cloudFunctionStatusReport();
  const rulesStatus = rulesStatusReport();
  const deploymentStatus = deploymentStatusReport();
  downloadCsv(
    `amsystem-risk-report-${exportStamp()}.csv`,
    ["类型", "状态", "项目", "详情", "完成时间"],
    [
      ["上线状态", readinessStatus.label, readinessStatus.status, readinessStatus.detail, ""],
      ["Cloud Functions", cloudFunctions.label, cloudFunctions.status, cloudFunctions.detail, ""],
      ["Rules", rulesStatus.label, rulesStatus.status, rulesStatus.detail, ""],
      ["部署环境", deploymentStatus.label, deploymentStatus.status, deploymentStatus.detail, ""],
      ...checks.map((check) => ["自检", check.ok ? "通过" : "待处理", check.label, check.detail, ""]),
      ...testChecklist.items.map((item) => ["实机测试", item.done ? "完成" : "未完成", `步骤 ${item.index}`, item.text, item.completedAt || ""]),
      ...deployChecklist.items.map((item) => ["部署检查", item.done ? "完成" : "未完成", `步骤 ${item.index}`, item.text, item.completedAt || ""]),
      ...orderIssues.map((issue) => ["订单风控", "异常", "明细", issue, ""]),
      ...rewardIssues.map((issue) => ["奖励发放", "异常", "明细", issue, ""]),
      ...withdrawIssues.map((issue) => ["提现风控", "异常", "明细", issue, ""]),
      ...issues.map((issue) => ["数据一致性", "异常", "明细", issue, ""]),
    ]
  );
}

function exportTestChecklistReport() {
  const report = testChecklistReport();
  downloadCsv(
    `amsystem-test-checklist-${exportStamp()}.csv`,
    ["步骤", "状态", "测试内容", "完成时间", "导出人", "导出时间"],
    report.items.map((item) => [
      item.index,
      item.done ? "完成" : "未完成",
      item.text,
      item.completedAt || "",
      firebaseUser?.email || "",
      new Date().toISOString(),
    ])
  );
}

function exportDeployChecklistReport() {
  const report = deployChecklistReport();
  downloadCsv(
    `amsystem-deploy-checklist-${exportStamp()}.csv`,
    ["步骤", "状态", "部署检查内容", "完成时间", "导出人", "导出时间"],
    report.items.map((item) => [
      item.index,
      item.done ? "完成" : "未完成",
      item.text,
      item.completedAt || "",
      firebaseUser?.email || "",
      new Date().toISOString(),
    ])
  );
}

function exportTodoReport() {
  downloadCsv(
    `amsystem-todos-${exportStamp()}.csv`,
    ["项目", "数量", "等级", "详情", "处理模块", "处理动作"],
    adminTodoItems().map((item) => [
      item.title,
      item.count,
      item.level,
      item.detail,
      item.tab,
      item.action,
    ])
  );
}

function sumRows(rows, pick) {
  return rows.reduce((sum, row) => sum + Number(pick(row) || 0), 0);
}

function exportFinanceSummary() {
  const orders = state.orders || [];
  const rewards = state.rewards || [];
  const withdraws = state.withdraws || [];
  const users = state.users || [];
  const paidOrders = orders.filter((order) => order.status === "paid");
  const pendingOrders = orders.filter((order) => order.status === "pending");
  const cancelledOrders = orders.filter((order) => ["cancelled", "refunded"].includes(order.status));
  const confirmedFirstRewards = rewards.filter((reward) => reward.type === "first" && reward.status === "confirmed");
  const repeatRewards = rewards.filter((reward) => reward.type === "repeat");
  const pendingRewards = rewards.filter((reward) => reward.status === "pending");
  const releasingRewards = rewards.filter((reward) => reward.status === "releasing");
  const cancelledRewards = rewards.filter((reward) => ["cancelled", "frozen"].includes(reward.status));
  const pendingWithdraws = withdraws.filter((withdraw) => withdraw.status === "pending");
  const approvedWithdraws = withdraws.filter((withdraw) => withdraw.status === "approved");
  const paidoutWithdraws = withdraws.filter((withdraw) => withdraw.status === "paidout");
  const rejectedWithdraws = withdraws.filter((withdraw) => withdraw.status === "rejected");
  const userBreakdowns = users.map((user) => withdrawBreakdown(user.id));
  downloadCsv(
    `amsystem-finance-summary-${exportStamp()}.csv`,
    ["分类", "项目", "数量", "金额", "说明"],
    [
      ["充值订单", "已支付充值", paidOrders.length, sumRows(paidOrders, (order) => order.amount), "已确认付款的订单总额"],
      ["充值订单", "待审核充值", pendingOrders.length, sumRows(pendingOrders, (order) => order.amount), "用户已提交但后台未确认"],
      ["充值订单", "已取消/退款", cancelledOrders.length, sumRows(cancelledOrders, (order) => order.amount), "不计入有效充值"],
      ["奖励", "已确认推荐奖励", confirmedFirstRewards.length, sumRows(confirmedFirstRewards, (reward) => reward.amount), "可进入提现余额"],
      ["奖励", "已释放复购奖励", repeatRewards.length, sumRows(repeatRewards, (reward) => reward.releasedAmount || (reward.status === "confirmed" ? reward.amount : 0)), "已释放部分可提现"],
      ["奖励", "待确认奖励", pendingRewards.length, sumRows(pendingRewards, (reward) => reward.amount), "等待确认日或管理员处理"],
      ["奖励", "分期中待释放", releasingRewards.length, sumRows(releasingRewards, (reward) => Number(reward.amount || 0) - Number(reward.releasedAmount || 0)), "复购奖励剩余未释放"],
      ["奖励", "已取消/冻结奖励", cancelledRewards.length, sumRows(cancelledRewards, (reward) => reward.amount), "不进入可提现余额"],
      ["提现", "待审核提现", pendingWithdraws.length, sumRows(pendingWithdraws, (withdraw) => withdraw.amount), "等待管理员审核"],
      ["提现", "已通过待打款", approvedWithdraws.length, sumRows(approvedWithdraws, (withdraw) => withdraw.amount), "已审核通过但未标记打款"],
      ["提现", "已打款提现", paidoutWithdraws.length, sumRows(paidoutWithdraws, (withdraw) => withdraw.amount), "已经标记打款"],
      ["提现", "已拒绝提现", rejectedWithdraws.length, sumRows(rejectedWithdraws, (withdraw) => withdraw.amount), "不扣除可提现余额"],
      ["用户余额", "当前全体可提现余额", users.length, sumRows(userBreakdowns, (item) => item.available), "推荐奖励可提现 + 复购奖励已释放 - 申请/处理中"],
      ["用户余额", "复购奖励待释放", users.length, sumRows(userBreakdowns, (item) => item.pendingRelease), "未来可能释放的复购奖励"],
    ]
  );
}

function exportMyRecords(user = currentUser()) {
  const referrer = findUser(user.referrerId);
  const [, statusLabel] = packageStatus(user);
  const breakdown = withdrawBreakdown(user.id);
  const rows = [
    ["用户资料", "用户ID", user.id, ""],
    ["用户资料", "显示名称", user.name || "", ""],
    ["用户资料", "账号", user.account || "", ""],
    ["用户资料", "手机", user.phone || "", ""],
    ["用户资料", "推荐码", user.inviteCode || "", ""],
    ["用户资料", "推荐人", referrer ? `${referrer.name} / ${referrer.inviteCode}` : "无", ""],
    ["用户资料", "配套状态", statusLabel, ""],
    ["用户资料", "充值积分", user.points || 0, "充值积分不可提现"],
    ["用户资料", "可提现奖励", breakdown.available, "仅包含已确认/已释放奖励"],
    ["用户资料", "奖励池资格", user.repeatCredits || 0, ""],
    ["订单", "订单号", "配套/类型/金额", "状态/时间/处理结果"],
    ...(state.orders || []).filter((order) => order.userId === user.id).map((order) => {
      const plan = orderPlan(order);
      return [
        "订单",
        order.id,
        `${plan?.name || "-"} / ${order.type === "first" ? "首充" : "复购"} / ${money(order.amount)}`,
        `${labelStatus(order.status)} / ${order.createdAt || ""} / ${order.confirmSummary || order.reviewNote || "-"}`,
      ];
    }),
    ["奖励", "奖励ID", "类型/金额/比例", "状态/可处理日/来源订单"],
    ...(state.rewards || []).filter((reward) => reward.userId === user.id).map((reward) => [
      "奖励",
      reward.id,
      `${rewardTypeText(reward)} / ${rewardAmountText(reward)} / ${Number(reward.rate || 0)}%`,
      `${labelStatus(reward.status)} / ${rewardNextDateText(reward)} / ${reward.orderId}`,
    ]),
    ["提现", "提现ID", "金额/方式/账号", "状态/申请时间/打款时间"],
    ...(state.withdraws || []).filter((withdraw) => withdraw.userId === user.id).map((withdraw) => [
      "提现",
      withdraw.id,
      `${money(withdraw.amount)} / ${withdraw.method || "-"} / ${withdraw.account || "-"}`,
      `${labelStatus(withdraw.status)} / ${withdraw.createdAt || ""} / ${withdraw.paidAt || "-"}`,
    ]),
    ["奖励池资格流水", "流水ID", "变动/余额/原因", "时间/来源/备注"],
    ...(state.repeatCreditLogs || []).filter((log) => log.userId === user.id).map((log) => [
      "奖励池资格流水",
      log.id,
      `${Number(log.change || 0)} / ${Number(log.balance || 0)} / ${repeatCreditReasonText(log.reason)}`,
      `${log.createdAt || ""} / ${log.source || "-"} / ${log.note || "-"}`,
    ]),
  ];
  downloadCsv(
    `amsystem-my-records-${normalizeInviteCode(user.inviteCode || user.id)}-${exportStamp()}.csv`,
    ["分类", "项目", "内容", "备注"],
    rows
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
  const riskFilter = getSelectValue("#orderRiskFilter", "all");

  return state.orders.filter((order) => {
    const user = findUser(order.userId);
    const plan = orderPlan(order);
    const hasRisk = orderRiskLabels(order).length > 0;
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
    const matchesRisk = riskFilter === "all"
      || (riskFilter === "risk" && hasRisk)
      || (riskFilter === "normal" && !hasRisk);
    return matchesKeyword && matchesStatus && matchesType && matchesProof && matchesRisk;
  });
}

function filteredUsers() {
  const keyword = getInputValue("#userSearchInput").toLowerCase();
  const packageFilter = getSelectValue("#userPackageFilter", "all");
  const accountFilter = getSelectValue("#userAccountFilter", "all");
  const payoutRiskFilter = getSelectValue("#userPayoutRiskFilter", "all");
  const profileFilter = getSelectValue("#userProfileFilter", "all");

  return state.users.filter((user) => {
    const referrer = findUser(user.referrerId);
    const hasPayoutRisk = sharedWithdrawAccountUsers(user.withdrawAccount, user.id).length > 0;
    const isProfileComplete = profileComplete(user);
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
    const matchesPayoutRisk = payoutRiskFilter === "all"
      || (payoutRiskFilter === "shared" && hasPayoutRisk)
      || (payoutRiskFilter === "clean" && !hasPayoutRisk);
    const matchesProfile = profileFilter === "all"
      || (profileFilter === "complete" && isProfileComplete)
      || (profileFilter === "incomplete" && !isProfileComplete);
    return matchesKeyword && matchesPackage && matchesAccount && matchesPayoutRisk && matchesProfile;
  });
}

function filteredRewards() {
  const keyword = getInputValue("#rewardSearchInput").toLowerCase();
  const statusFilter = getSelectValue("#rewardStatusFilter", "all");
  const typeFilter = getSelectValue("#rewardTypeFilter", "all");
  const riskFilter = getSelectValue("#rewardRiskFilter", "all");

  return state.rewards.filter((reward) => {
    const user = findUser(reward.userId);
    const sourceUser = findUser(reward.sourceUserId);
    const hasRisk = rewardRiskLabels(reward).length > 0;
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
    const matchesType = typeFilter === "all"
      || reward.type === typeFilter
      || (typeFilter === "repeatDirect" && reward.type === "repeat" && reward.rewardMode === "direct")
      || (typeFilter === "repeatPool" && reward.type === "repeat" && reward.rewardMode === "pool");
    const matchesRisk = riskFilter === "all"
      || (riskFilter === "risk" && hasRisk)
      || (riskFilter === "normal" && !hasRisk);
    return matchesKeyword && matchesStatus && matchesType && matchesRisk;
  });
}

function filteredWithdraws() {
  const keyword = getInputValue("#withdrawSearchInput").toLowerCase();
  const statusFilter = getSelectValue("#withdrawStatusFilter", "all");
  const riskFilter = getSelectValue("#withdrawRiskFilter", "all");
  const minAmount = Number(getInputValue("#withdrawMinAmount") || 0);

  return state.withdraws.filter((item) => {
    const user = findUser(item.userId);
    const hasRisk = withdrawRiskLabels(item).length > 0;
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
    const matchesRisk = riskFilter === "all"
      || (riskFilter === "risk" && hasRisk)
      || (riskFilter === "normal" && !hasRisk);
    const matchesAmount = !minAmount || Number(item.amount || 0) >= minAmount;
    return matchesKeyword && matchesStatus && matchesRisk && matchesAmount;
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

function clearSignedOutSensitiveFields() {
  state.currentUserId = "";
  ["#profileForm", "#paymentInfoForm", "#withdrawForm", "#registerForm"].forEach((selector) => {
    const form = document.querySelector(selector);
    if (form) form.reset();
  });
  document.querySelector("#inviteLink")?.replaceChildren(document.createTextNode("-"));
  document.querySelector("#inviteCodeBox")?.remove();
  const localHint = document.querySelector("#localSyncHint");
  if (localHint) {
    localHint.textContent = "";
    localHint.hidden = true;
  }
}

function renderAdminLocked() {
  document.querySelector("#metricUsers").textContent = "-";
  document.querySelector("#metricSales").textContent = "-";
  document.querySelector("#metricPendingOrders").textContent = "-";
  document.querySelector("#metricPendingRewards").textContent = "-";
  document.querySelector("#metricWithdraws").textContent = "-";
  document.querySelector("#metricReadiness").textContent = "-";
  document.querySelector("#adminPlanList").innerHTML = `<article class="plan-card"><strong>后台已锁定</strong><span>请使用管理员 Google 邮箱登录。</span></article>`;
  document.querySelector("#adminUserTable").innerHTML = `<tr><td colspan="12">无管理员权限</td></tr>`;
  document.querySelector("#repeatCreditLogTable").innerHTML = `<tr><td colspan="6">无管理员权限</td></tr>`;
  document.querySelector("#adminOrderTable").innerHTML = `<tr><td colspan="10">无管理员权限</td></tr>`;
  document.querySelector("#adminRewardTable").innerHTML = `<tr><td colspan="8">无管理员权限</td></tr>`;
  document.querySelector("#adminWithdrawTable").innerHTML = `<tr><td colspan="8">无管理员权限</td></tr>`;
  if (document.querySelector("#adminRiskList")) {
    document.querySelector("#adminRiskList").innerHTML = `<article class="risk-card"><strong>后台已锁定</strong><span>请使用管理员 Google 邮箱登录后查看风控规则。</span></article>`;
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
  const restoreBackupBtn = document.querySelector("#restoreBackupBtn");
  const clearTestDataBtn = document.querySelector("#clearTestDataBtn");
  const resetBtn = document.querySelector("#resetBtn");
  if (exportBtn) {
    exportBtn.disabled = !canAdmin;
    exportBtn.title = canAdmin ? "导出完整 JSON 备份包" : "请使用管理员账号登录";
  }
  if (restoreBackupBtn) {
    restoreBackupBtn.disabled = !canAdmin;
    restoreBackupBtn.title = canAdmin ? "从系统导出的 JSON 备份包恢复数据" : "请使用管理员账号登录";
  }
  if (clearTestDataBtn) {
    clearTestDataBtn.disabled = !canAdmin;
    clearTestDataBtn.title = canAdmin ? "清空测试订单、奖励、提现和流水，保留用户与配套" : "请使用管理员账号登录";
  }
  if (resetBtn) {
    resetBtn.disabled = !canAdmin;
    resetBtn.title = canAdmin ? "清空演示订单、奖励、提现和流水，并移除旧演示用户" : "请使用管理员账号登录";
  }
}

function renderAll() {
  if (!state) return;
  updateAuthStatusClean();
  renderAppVersion();
  renderAdminActionButtons();
  if (!firebaseUser) clearSignedOutSensitiveFields();
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
    setValue("#orderRiskFilter", "all");
    setValue("#orderSearchInput", "");
  }
  if (focus === "paidOrders") {
    setValue("#orderStatusFilter", "paid");
    setValue("#orderTypeFilter", "all");
    setValue("#orderProofFilter", "all");
    setValue("#orderRiskFilter", "all");
    setValue("#orderSearchInput", "");
  }
  if (focus === "failedProofs") {
    setValue("#orderStatusFilter", "pending");
    setValue("#orderTypeFilter", "all");
    setValue("#orderProofFilter", "failed");
    setValue("#orderRiskFilter", "all");
    setValue("#orderSearchInput", "");
  }
  if (focus === "orderRisks") {
    setValue("#orderStatusFilter", "all");
    setValue("#orderTypeFilter", "all");
    setValue("#orderProofFilter", "all");
    setValue("#orderRiskFilter", "risk");
    setValue("#orderSearchInput", "");
  }
  if (focus === "pendingRewards") {
    setValue("#rewardStatusFilter", "pending");
    setValue("#rewardTypeFilter", "all");
    setValue("#rewardRiskFilter", "all");
    setValue("#rewardSearchInput", "");
  }
  if (focus === "dueRewards") {
    setValue("#rewardStatusFilter", "due");
    setValue("#rewardTypeFilter", "all");
    setValue("#rewardRiskFilter", "all");
    setValue("#rewardSearchInput", "");
  }
  if (focus === "rewardIssues") {
    setValue("#rewardStatusFilter", "all");
    setValue("#rewardTypeFilter", "all");
    setValue("#rewardRiskFilter", "risk");
    setValue("#rewardSearchInput", "");
  }
  if (focus === "pendingWithdraws") {
    setValue("#withdrawStatusFilter", "pending");
    setValue("#withdrawRiskFilter", "all");
    setValue("#withdrawSearchInput", "");
    setValue("#withdrawMinAmount", "");
  }
  if (focus === "withdrawRisks") {
    setValue("#withdrawStatusFilter", "all");
    setValue("#withdrawRiskFilter", "risk");
    setValue("#withdrawSearchInput", "");
    setValue("#withdrawMinAmount", "");
  }
  if (focus === "payoutRiskUsers") {
    setValue("#userPackageFilter", "all");
    setValue("#userAccountFilter", "all");
    setValue("#userPayoutRiskFilter", "shared");
    setValue("#userProfileFilter", "all");
    setValue("#userSearchInput", "");
  }
  if (focus === "incompleteProfiles") {
    setValue("#userPackageFilter", "all");
    setValue("#userAccountFilter", "all");
    setValue("#userPayoutRiskFilter", "all");
    setValue("#userProfileFilter", "incomplete");
    setValue("#userSearchInput", "");
  }
  if (focus === "allUsers") {
    setValue("#userPackageFilter", "all");
    setValue("#userAccountFilter", "all");
    setValue("#userPayoutRiskFilter", "all");
    setValue("#userProfileFilter", "all");
    setValue("#userSearchInput", "");
  }
}

function scrollToAdminFocus(tabId, focus) {
  const panel = document.querySelector(`#${tabId}`);
  if (!panel) return;
  const targets = {
    pendingOrders: "#adminOrderTable",
    paidOrders: "#adminOrderTable",
    failedProofs: "#adminOrderTable",
    orderRisks: "#adminOrderTable",
    pendingRewards: "#adminRewardTable",
    dueRewards: "#adminRewardTable",
    pendingWithdraws: "#adminWithdrawTable",
    withdrawRisks: "#adminWithdrawTable",
    payoutRiskUsers: "#adminUserTable",
    incompleteProfiles: "#adminUserTable",
    allUsers: "#adminUserTable",
    duplicateOrders: "#adminRiskList",
    rewardIssues: "#adminRewardTable",
    integrityIssues: "#adminRiskList",
    readiness: "#adminRiskList",
  };
  const target = document.querySelector(targets[focus]) || panel;
  const scrollTarget = target.closest(".table-wrap") || target.closest(".panel") || target;
  scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
  scrollTarget.classList.remove("attention-pulse");
  window.setTimeout(() => scrollTarget.classList.add("attention-pulse"), 0);
  window.setTimeout(() => scrollTarget.classList.remove("attention-pulse"), 1400);
  panel.querySelector(".filter-bar input, .filter-bar select")?.focus({ preventScroll: true });
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
  event.preventDefault();
  openTab(openAdminTab.dataset.openAdminTab);
  applyTodoFocus(openAdminTab.dataset.todoFocus);
  renderAll();
  window.setTimeout(() => {
    scrollToAdminFocus(openAdminTab.dataset.openAdminTab, openAdminTab.dataset.todoFocus);
  }, 0);
});

document.addEventListener("click", (event) => {
  const openMemberTab = event.target.closest("[data-open-member-tab]");
  if (!openMemberTab) return;
  openTab(openMemberTab.dataset.openMemberTab);
});

document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-test-check]");
  if (!checkbox) return;
  const checked = testChecklistState();
  if (checkbox.checked) {
    checked[checkbox.dataset.testCheck] = {
      done: true,
      completedAt: new Date().toISOString(),
    };
  } else {
    delete checked[checkbox.dataset.testCheck];
  }
  saveTestChecklistState(checked);
  renderAdminRiskRules();
});

document.addEventListener("click", (event) => {
  if (event.target?.id === "exportTestChecklistBtn") {
    exportTestChecklistReport();
    toast("测试清单已导出");
    return;
  }
  if (event.target?.id !== "resetTestChecklistBtn") return;
  saveTestChecklistState({});
  renderAdminRiskRules();
  toast("测试清单已重置");
});

document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-deploy-check]");
  if (!checkbox) return;
  const checked = deployChecklistState();
  if (checkbox.checked) {
    checked[checkbox.dataset.deployCheck] = {
      done: true,
      completedAt: new Date().toISOString(),
    };
  } else {
    delete checked[checkbox.dataset.deployCheck];
  }
  saveDeployChecklistState(checked);
  renderAdminRiskRules();
});

document.addEventListener("click", (event) => {
  if (event.target?.id === "exportDeployChecklistBtn") {
    exportDeployChecklistReport();
    toast("部署清单已导出");
    return;
  }
  if (event.target?.id !== "resetDeployChecklistBtn") return;
  saveDeployChecklistState({});
  renderAdminRiskRules();
  toast("部署清单已重置");
});

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-member-action]");
  if (!action || action.dataset.memberAction !== "profile") return;
  const form = document.querySelector("#profileForm");
  form?.scrollIntoView({ behavior: "smooth", block: "center" });
  const firstEmpty = [...(form?.querySelectorAll("input") || [])].find((input) => !input.value.trim());
  firstEmpty?.focus();
});

["#orderStatusFilter", "#orderTypeFilter", "#orderProofFilter", "#orderRiskFilter", "#rewardStatusFilter", "#rewardTypeFilter", "#rewardRiskFilter", "#withdrawStatusFilter", "#withdrawRiskFilter", "#userPackageFilter", "#userAccountFilter", "#userPayoutRiskFilter", "#userProfileFilter", "#logActionFilter", "#logLimitFilter"].forEach((selector) => {
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
  const payoutRiskFilter = document.querySelector("#userPayoutRiskFilter");
  const profileFilter = document.querySelector("#userProfileFilter");
  if (searchInput) searchInput.value = "";
  if (packageFilter) packageFilter.value = "all";
  if (accountFilter) accountFilter.value = "all";
  if (payoutRiskFilter) payoutRiskFilter.value = "all";
  if (profileFilter) profileFilter.value = "all";
  renderAll();
});

document.querySelector("#clearOrderFiltersBtn")?.addEventListener("click", () => {
  const searchInput = document.querySelector("#orderSearchInput");
  const statusFilter = document.querySelector("#orderStatusFilter");
  const typeFilter = document.querySelector("#orderTypeFilter");
  const proofFilter = document.querySelector("#orderProofFilter");
  const riskFilter = document.querySelector("#orderRiskFilter");
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (typeFilter) typeFilter.value = "all";
  if (proofFilter) proofFilter.value = "all";
  if (riskFilter) riskFilter.value = "all";
  renderAll();
});

document.querySelector("#clearRewardFiltersBtn")?.addEventListener("click", () => {
  const searchInput = document.querySelector("#rewardSearchInput");
  const statusFilter = document.querySelector("#rewardStatusFilter");
  const typeFilter = document.querySelector("#rewardTypeFilter");
  const riskFilter = document.querySelector("#rewardRiskFilter");
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (typeFilter) typeFilter.value = "all";
  if (riskFilter) riskFilter.value = "all";
  renderAll();
});

document.querySelector("#clearWithdrawFiltersBtn")?.addEventListener("click", () => {
  const searchInput = document.querySelector("#withdrawSearchInput");
  const statusFilter = document.querySelector("#withdrawStatusFilter");
  const riskFilter = document.querySelector("#withdrawRiskFilter");
  const minAmountInput = document.querySelector("#withdrawMinAmount");
  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (riskFilter) riskFilter.value = "all";
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

document.querySelector("#exportMyRecordsBtn")?.addEventListener("click", () => {
  if (!firebaseUser) return toast("请先使用 Google 登录");
  exportMyRecords(currentUser());
  toast("我的记录已导出");
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
    ["用户ID", "姓名", "账号", "手机", "邀请码", "推荐人", "积分", "推荐名额记录", "直接推荐数", "奖励池资格", "默认收款方式", "默认收款账号", "资料状态", "缺失资料", "共享账号数量", "共享账号用户", "配套状态", "账号状态"],
    filteredUsers().map((user) => {
      const referrer = findUser(user.referrerId);
      const [, statusLabel] = packageStatus(user);
      const sharedUsers = sharedWithdrawAccountUsers(user.withdrawAccount, user.id);
      const missingFields = profileMissingFields(user);
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
        user.withdrawMethod || "",
        user.withdrawAccount || "",
        missingFields.length ? "资料不完整" : "资料完整",
        missingFields.join("；"),
        sharedUsers.length,
        sharedUsers.map((item) => `${item.name} / ${item.account}`).join("；"),
        statusLabel,
        user.frozen ? "已冻结" : "正常",
      ];
    })
  );
});

function referralExportRows() {
  const usersById = new Map((state.users || []).map((user) => [user.id, user]));
  const rows = new Map();
  (state.users || []).filter((user) => user.referrerId).forEach((user) => {
    const referral = referralDocForUser(user);
    rows.set(referral.id, referral);
  });
  (state.referrals || []).forEach((referral) => {
    if (!referral.referrerId || !referral.inviteeId) return;
    const key = referral.id || `${referral.referrerId}_${referral.inviteeId}`;
    rows.set(key, { ...(rows.get(key) || {}), ...referral, id: key });
  });
  return [...rows.values()].map((referral) => {
    const referrer = usersById.get(referral.referrerId);
    const invitee = usersById.get(referral.inviteeId);
    const [, statusLabel] = invitee ? packageStatus(invitee) : ["neutral", "用户不存在"];
    const paidTotal = (state.orders || [])
      .filter((order) => order.userId === referral.inviteeId && order.status === "paid")
      .reduce((sum, order) => sum + Number(order.amount || 0), 0);
    return [
      referral.id,
      referral.referrerId,
      referrer?.name || referral.referrerName || "",
      referrer?.account || "",
      referrer?.inviteCode || "",
      referral.inviteeId,
      invitee?.name || referral.inviteeName || "",
      invitee?.account || referral.inviteeAccount || "",
      invitee?.inviteCode || "",
      statusLabel,
      paidTotal,
      invitee ? "是" : "否",
      referral.createdAt || "",
    ];
  });
}

document.querySelector("#exportReferralsBtn")?.addEventListener("click", async () => {
  if (!requireAdmin()) return;
  const rows = referralExportRows();
  downloadCsv(
    `amsystem-referrals-${exportStamp()}.csv`,
    ["关系ID", "推荐人ID", "推荐人", "推荐人账号", "推荐人邀请码", "下线ID", "下线", "下线账号", "下线邀请码", "下线配套状态", "下线累计充值", "下线用户是否存在", "绑定时间"],
    rows
  );
  addAdminLog("导出推荐关系", "用户管理", `导出 ${rows.length} 条推荐关系`);
  await saveState();
  renderAll();
  toast("推荐关系已导出");
});

document.querySelector("#exportPlansBtn")?.addEventListener("click", async () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-plans-${exportStamp()}.csv`,
    ["配套ID", "配套名称", "金额", "单位金额", "单位数", "发放积分", "推荐名额", "奖励池资格记录", "复购冷却小时", "有效期天数", "推荐奖励%", "下线复购奖励%", "奖励池奖励%", "是否已有订单使用"],
    (state.plans || []).map((plan) => [
      plan.id,
      plan.name,
      plan.amount,
      PACKAGE_UNIT_AMOUNT,
      isValidPackageAmount(plan.amount) ? packageUnits(plan.amount) : "",
      plan.points,
      plan.slots,
      planRepeatCredits(plan),
      planRepeatCooldownHours(plan),
      plan.validDays,
      plan.firstRate,
      planDirectRepeatRate(plan),
      planPoolRepeatRate(plan),
      planUsed(plan.id) ? "是" : "否",
    ])
  );
  addAdminLog("导出配套规则", "配套设置", `导出 ${state.plans.length} 个配套`);
  await saveState();
  renderAll();
  toast("配套规则已导出");
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
    ["订单号", "用户", "配套", "类型", "金额", "锁定积分", "锁定推荐名额记录", "锁定有效天数", "锁定推荐奖励比例", "锁定下线复购比例", "锁定奖励池比例", "锁定奖励池资格记录", "锁定冷却小时", "付款方式", "付款参考号", "凭证状态", "风险提示", "状态", "处理备注", "处理结果", "申请时间", "确认时间", "取消时间"],
    filteredOrders().map((order) => {
      const user = findUser(order.userId);
      const plan = orderPlan(order);
      return [
        order.id,
        user?.name || "",
        plan?.name || "",
        order.type,
        order.amount,
        plan?.points || 0,
        plan?.slots || 0,
        plan?.validDays || 0,
        plan?.firstRate || 0,
        plan ? planDirectRepeatRate(plan) : 0,
        plan ? planPoolRepeatRate(plan) : 0,
        plan ? planRepeatCredits(plan) : 0,
        plan ? planRepeatCooldownHours(plan) : 0,
        paymentMethodText(order.paymentMethod),
        order.paymentRef || "",
        proofStatusText(order),
        orderRiskLabels(order).join("；"),
        labelStatus(order.status),
        order.reviewNote || "",
        order.confirmSummary || "",
        order.createdAt,
        order.reviewedAt || order.paidAt || "",
        order.cancelledAt || "",
      ];
    })
  );
});

document.querySelector("#exportRewardsBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-rewards-${exportStamp()}.csv`,
    ["奖励ID", "奖励人", "来源用户", "订单", "订单金额", "配套快照", "类型", "比例", "金额", "按比例应得", "计算差额", "风控风险", "状态", "可确认日", "审核备注", "审核时间"],
    filteredRewards().map((reward) => {
      const user = findUser(reward.userId);
      const sourceUser = findUser(reward.sourceUserId);
      const order = (state.orders || []).find((item) => item.id === reward.orderId);
      const plan = order ? orderPlan(order) : null;
      const expectedAmount = order ? +(Number(order.amount || 0) * (Number(reward.rate || 0) / 100)).toFixed(2) : 0;
      const amountGap = order ? Number((Number(reward.amount || 0) - expectedAmount).toFixed(2)) : 0;
      const risks = rewardRiskLabels(reward).join("；");
      return [
        reward.id,
        user?.name || "",
        sourceUser?.name || "",
        reward.orderId,
        order?.amount || "",
        plan ? `${plan.name} / ${orderPlanSummary(plan)}` : "",
        rewardTypeText(reward),
        reward.rate,
        rewardAmountText(reward),
        order ? expectedAmount : "",
        order ? amountGap : "",
        risks,
        labelStatus(reward.status),
        rewardNextDateText(reward),
        reward.reviewNote || "",
        reward.reviewedAt || "",
      ];
    })
  );
});

document.querySelector("#exportWithdrawsBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  downloadCsv(
    `amsystem-withdraws-${exportStamp()}.csv`,
    ["提现ID", "用户", "金额", "来源", "方式", "账号", "推荐奖励可提现", "复购奖励已释放", "复购奖励待释放", "已申请/处理中", "当前可提现余额", "风险提示", "状态", "审核备注", "申请时间", "审核时间", "打款时间"],
    filteredWithdraws().map((item) => {
      const user = findUser(item.userId);
      const breakdown = user ? withdrawBreakdown(user.id) : {};
      return [
        item.id,
        user?.name || "",
        item.amount,
        item.source === "reward" ? "奖励提现" : item.source || "",
        item.method,
        item.account,
        breakdown.first || 0,
        breakdown.repeatReleased || 0,
        breakdown.pendingRelease || 0,
        breakdown.requested || 0,
        breakdown.available || 0,
        withdrawRiskLabels(item).join("；"),
        labelStatus(item.status),
        item.reviewNote || "",
        item.createdAt,
        item.reviewedAt || "",
        item.paidAt || "",
      ];
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
  const unlocked = grantReferralPoolCredit(state, invite.userId, user.id);
  await saveState();
  formEl.reset();
  renderAll();
  toast(unlocked ? "推荐人已绑定，推荐人已解锁 1 个奖励池资格" : "推荐人已绑定");
});

document.querySelector("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAdmin()) return;
  const form = new FormData(event.currentTarget);
  const data = planFromForm(form);
  if (!data.name || data.amount <= 0 || data.validDays <= 0) return toast("请填写完整配套资料");
  if (!isValidPackageAmount(data.amount)) return toast(`充值金额必须是 RM${PACKAGE_UNIT_AMOUNT} 的整数倍，例如 RM180、RM360、RM720`);
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

document.querySelector("#planForm [name='amount']")?.addEventListener("input", syncPlanUnitFields);

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
  if (!user || Number.isNaN(change)) return toast("奖励池资格调整无效");
  const before = Number(user.repeatCredits || 0);
  user.repeatCredits = Math.max(Math.min(before + change, MAX_REPEAT_POOL_CREDITS), 0);
  if (user.repeatCredits > 0 && before <= 0) {
    user.repeatCreditQueueAt = new Date().toISOString();
  }
  if (user.repeatCredits <= 0) {
    user.repeatCreditQueueAt = "";
  }
  const actualChange = user.repeatCredits - before;
  addAdminLog("调整奖励池资格", user.name, `申请变动 ${change}，实际变动 ${actualChange}，当前 ${user.repeatCredits}，备注：${form.get("note").trim()}`);
  if (actualChange !== 0) {
    addRepeatCreditLog(state, user.id, actualChange, user.repeatCredits, "admin", "admin", form.get("note").trim());
  }
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast(user.repeatCredits === MAX_REPEAT_POOL_CREDITS && before + change > MAX_REPEAT_POOL_CREDITS
    ? `奖励池资格已调整，最多只能保留 ${MAX_REPEAT_POOL_CREDITS} 个`
    : "奖励池资格已调整");
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
  const dueRewards = state.rewards.filter((reward) =>
    ["pending", "releasing"].includes(reward.status)
    && (TEST_INSTANT_MODE || new Date(reward.confirmAfter) <= new Date())
  );
  const dueAmount = dueRewards.reduce((sum, reward) => {
    if (TEST_INSTANT_MODE) return sum + Math.max(Number(reward.amount || 0) - Number(reward.releasedAmount || 0), 0);
    if (Array.isArray(reward.releasePlan)) {
      return sum + reward.releasePlan
        .filter((part) => !part.released && new Date(part.releaseAt) <= new Date())
        .reduce((partSum, part) => partSum + Number(part.amount || 0), 0);
    }
    return sum + Number(reward.amount || 0);
  }, 0);
  if (!dueRewards.length) return toast("暂无到期可确认奖励");
  if (!window.confirm(`${TEST_INSTANT_MODE ? "测试即时模式：确定强制结算全部待处理奖励？" : "确定批量处理到期奖励？"}\n\n数量：${dueRewards.length} 笔\n预计释放/确认：${money(dueAmount)}`)) return;
  let count = 0;
  const now = new Date();
  state.rewards.forEach((reward) => {
    if (TEST_INSTANT_MODE && settleRewardNow(reward, now)) {
      count += 1;
      addAdminLog("测试即时结算奖励", reward.orderId, `奖励 ${money(reward.amount)}`);
      return;
    }
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
  const memberOrderDetail = event.target.closest("[data-member-order-detail]");
  if (memberOrderDetail) {
    const user = currentUser();
    const order = state.orders.find((item) => item.id === memberOrderDetail.dataset.memberOrderDetail && item.userId === user.id);
    if (!order) return toast("找不到订单");
    window.alert(orderDetailText(order));
    return;
  }

  const memberRewardDetail = event.target.closest("[data-member-reward-detail]");
  if (memberRewardDetail) {
    const user = currentUser();
    const reward = state.rewards.find((item) => item.id === memberRewardDetail.dataset.memberRewardDetail && item.userId === user.id);
    if (!reward) return toast("找不到奖励记录");
    window.alert(rewardDetailText(reward));
    return;
  }

  const memberWithdrawDetail = event.target.closest("[data-member-withdraw-detail]");
  if (memberWithdrawDetail) {
    const user = currentUser();
    const withdraw = state.withdraws.find((item) => item.id === memberWithdrawDetail.dataset.memberWithdrawDetail && item.userId === user.id);
    if (!withdraw) return toast("找不到提现申请");
    window.alert(withdrawDetailText(withdraw));
    return;
  }

  const orderDetail = event.target.closest("[data-order-detail]");
  if (orderDetail) {
    if (!requireAdmin()) return;
    const order = state.orders.find((item) => item.id === orderDetail.dataset.orderDetail);
    if (!order) return toast("找不到订单");
    window.alert(orderDetailText(order));
    return;
  }

  const rewardDetail = event.target.closest("[data-reward-detail]");
  if (rewardDetail) {
    if (!requireAdmin()) return;
    const reward = state.rewards.find((item) => item.id === rewardDetail.dataset.rewardDetail);
    if (!reward) return toast("找不到奖励记录");
    window.alert(rewardDetailText(reward));
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

  const exportUserRecords = event.target.closest("[data-export-user-records]");
  if (exportUserRecords) {
    if (!requireAdmin()) return;
    const user = findUser(exportUserRecords.dataset.exportUserRecords);
    if (!user) return toast("找不到用户");
    exportMyRecords(user);
    addAdminLog("导出用户记录", user.name || user.id, `导出 ${user.account || user.id} 的个人记录`);
    await saveState();
    renderAll();
    toast("用户记录已导出");
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
    if (planUsed(plan.id)) return toast("已有待处理或已付款订单使用这个配套，不能删除");
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
    try {
      await copyText(copyInviteCode.dataset.copyInviteCode);
      toast("推荐码已复制");
    } catch (error) {
      toast("复制失败，请手动长按推荐码复制");
    }
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
    if (!order) return toast(`配套金额不符合 RM${PACKAGE_UNIT_AMOUNT} 单位规则，请联系管理员更新配套`);
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
    try {
      await copyText(document.querySelector("#inviteLink").textContent);
      toast("推荐链接已复制");
    } catch (error) {
      toast("复制失败，请手动长按推荐链接复制");
    }
    return;
  }

  if (event.target.closest("#copyInviteTextBtn")) {
    try {
      await copyText(inviteMessage(currentUser()));
      toast("邀请文案已复制");
    } catch (error) {
      toast("复制失败，请手动复制推荐码和链接");
    }
    return;
  }

  const confirmOrder = event.target.closest("[data-confirm-order]");
  if (confirmOrder) {
    if (!requireAdmin()) return;
    const order = state.orders.find((item) => item.id === confirmOrder.dataset.confirmOrder);
    if (!order || order.status !== "pending") return toast("订单状态不可确认");
    if (!window.confirm(orderConfirmPreview(order))) return;
    const risks = orderRiskLabels(order);
    const riskNote = risks.length ? "已核对风控风险：" : "";
    const note = window.prompt("请输入确认付款备注（可留空）", order.reviewNote || riskNote);
    if (note === null) return;
    if (risks.length && note.trim().length <= riskNote.length) return toast("有风控风险的订单必须填写审核备注");
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
      addAdminLog("确认付款", order.id, `金额 ${money(order.amount)} / 前端管理员确认 / ${order.confirmSummary || "无处理摘要"} / ${order.reviewNote || "无备注"}`);
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
    if (!reward) return toast("找不到奖励记录");
    const actionLabel = rewardAction.dataset.confirmReward ? "确认" : rewardAction.dataset.cancelReward ? "取消" : "冻结";
    const note = window.prompt(`请输入奖励${actionLabel}备注（可留空）`, reward.reviewNote || "");
    if (note === null) return;
    if (!window.confirm(`确定${actionLabel}这笔奖励？\n\n订单：${reward.orderId}\n金额：${money(reward.amount)}\n备注：${note.trim() || "无"}`)) return;
    if (rewardAction.dataset.confirmReward) {
      if (TEST_INSTANT_MODE) {
        settleRewardNow(reward);
      } else if (Array.isArray(reward.releasePlan)) {
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
    if (!withdraw) return toast("找不到提现申请");
    const actionLabel = withdrawAction.dataset.approveWithdraw ? "通过" : withdrawAction.dataset.rejectWithdraw ? "拒绝" : "标记打款";
    const risks = withdrawRiskLabels(withdraw);
    const riskNote = risks.length && !withdrawAction.dataset.rejectWithdraw ? "已核对提现风控风险：" : "";
    const note = window.prompt(`请输入提现${actionLabel}备注（可留空）`, withdraw.reviewNote || riskNote);
    if (note === null) return;
    if (risks.length && !withdrawAction.dataset.rejectWithdraw && note.trim().length <= riskNote.length) return toast("有风控风险的提现必须填写审核备注");
    if (!window.confirm(`确定${actionLabel}这笔提现吗？\n\n编号：${withdraw.id}\n金额：${money(withdraw.amount)}\n收款：${withdraw.method} / ${withdraw.account}\n备注：${note.trim() || "无"}`)) return;
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

function backupStateFromJson(text) {
  const parsed = JSON.parse(text);
  const data = parsed?.data || parsed;
  if (!data || !Array.isArray(data.users) || !Array.isArray(data.plans)) {
    throw new Error("invalid-amsystem-backup");
  }
  return prepareLoadedState(data);
}

document.querySelector("#restoreBackupBtn")?.addEventListener("click", () => {
  if (!requireAdmin()) return;
  document.querySelector("#restoreBackupInput")?.click();
});

document.querySelector("#restoreBackupInput")?.addEventListener("change", async (event) => {
  if (!requireAdmin()) return;
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const restoredState = backupStateFromJson(await file.text());
    const answer = window.prompt("导入备份包会先导出当前状态，然后用备份内容覆盖云端数据。\n\n如果确定继续，请输入 RESTORE");
    if (answer !== "RESTORE") {
      toast("已取消导入");
      return;
    }
    exportBundle();
    state = restoredState;
    addAdminLog("导入备份包", file.name, `用户 ${state.users.length} / 订单 ${state.orders.length} / 奖励 ${state.rewards.length}`);
    await saveState();
    renderAll();
    toast("备份包已导入，导入前状态已下载");
  } catch (error) {
    console.warn("Restore backup failed.", error);
    toast("导入失败：请选择系统导出的 JSON 备份包");
  }
});

function clearBusinessTestData() {
  editingPlanId = "";
  state.testDataClearedAt = new Date().toISOString();
  state.orders = [];
  state.rewards = [];
  state.withdraws = [];
  state.pointLogs = [];
  state.repeatCreditLogs = [];
  state.adminLogs = [];
  state.users = (state.users || []).map((user) => ({
    ...user,
    points: 0,
    slots: 0,
    repeatCredits: 0,
    repeatCreditQueueAt: "",
    repeatCooldownUntil: "",
    packageUntil: "",
    level: "普通用户",
  }));
  state.referrals = referralDocsForState(state);
}

document.querySelector("#clearTestDataBtn")?.addEventListener("click", async () => {
  if (!requireAdmin()) return;
  const answer = window.prompt("清理测试数据会先导出备份包，然后清空订单、奖励、提现、积分流水、奖励池资格流水和操作日志；会保留用户、推荐关系和配套规则。\n\n如果确定继续，请输入 CLEAR");
  if (answer !== "CLEAR") {
    toast("已取消清理");
    return;
  }
  exportBundle();
  clearBusinessTestData();
  resetPlanForm();
  addAdminLog("清理测试数据", "系统", "保留用户、推荐关系和配套规则；清空订单、奖励、提现和流水");
  await saveState();
  renderAll();
  toast("测试数据已清理，清理前备份包已下载");
});

document.querySelector("#exportRiskReportBtn")?.addEventListener("click", async () => {
  if (!requireAdmin()) return;
  exportRiskReport();
  addAdminLog("导出异常报告", "风控规则", "导出上线自检与数据一致性报告");
  await saveState();
  renderAll();
  toast("异常报告已导出");
});

document.querySelector("#exportTodosBtn")?.addEventListener("click", async () => {
  if (!requireAdmin()) return;
  exportTodoReport();
  addAdminLog("导出待办清单", "待办中心", "导出当前后台待办事项");
  await saveState();
  renderAll();
  toast("待办清单已导出");
});

document.querySelector("#exportFinanceSummaryBtn")?.addEventListener("click", async () => {
  if (!requireAdmin()) return;
  exportFinanceSummary();
  addAdminLog("导出财务汇总", "待办中心", "导出充值、奖励、提现与可提现余额汇总");
  await saveState();
  renderAll();
  toast("财务汇总已导出");
});

document.querySelector("#resetBtn").addEventListener("click", async () => {
  if (!requireAdmin()) return;
  const answer = window.prompt("清空演示数据会先导出备份包，然后清空订单、奖励、提现、积分流水、奖励池资格流水、操作日志，并移除旧演示用户（李明、王芳、陈杰）；会保留真实用户、推荐关系和配套规则。\n\n如果确定继续，请输入 CLEAR");
  if (answer !== "CLEAR") {
    toast("已取消清空");
    return;
  }
  exportBundle();
  purgeLegacyDemoUsers(state);
  clearBusinessTestData();
  resetPlanForm();
  addAdminLog("清空演示数据", "系统", "移除旧演示用户；保留真实用户、推荐关系和配套规则；清空订单、奖励、提现和流水");
  await saveState();
  renderAll();
  toast("演示数据已清空，清空前备份包已下载");
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






