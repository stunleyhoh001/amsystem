import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const STORAGE_KEY = "oneMinuteAffiliateFirebaseFallback";
const SYSTEM_DOC_PATH = ["affiliateSystems", "main"];
const CONFIRM_DAYS = 7;

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
const systemRef = doc(db, ...SYSTEM_DOC_PATH);

let firebaseReady = false;
let cloudAvailable = false;
let firebaseUser = null;
let state = null;

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
      { id: "plan_rm180", name: "RM180 启动配套", amount: 180, points: 18000, slots: 10, validDays: 30, firstRate: 20, repeatRate: 8 },
      { id: "plan_rm580", name: "RM580 进阶配套", amount: 580, points: 58000, slots: 35, validDays: 60, firstRate: 25, repeatRate: 10 },
    ],
    users: [
      { id: "u_1001", name: "李明", account: "liming@example.com", inviteCode: "LM1001", referrerId: "", level: "推广用户", points: 18000, slots: 10, packageUntil: futureDate(20), frozen: false },
      { id: "u_1002", name: "王芳", account: "13800000002", inviteCode: "WF1002", referrerId: "u_1001", level: "高级推广用户", points: 58000, slots: 35, packageUntil: futureDate(45), frozen: false },
      { id: "u_1003", name: "陈杰", account: "chenjie@example.com", inviteCode: "CJ1003", referrerId: "u_1001", level: "普通用户", points: 0, slots: 0, packageUntil: "", frozen: false },
    ],
    orders: [],
    pointLogs: [],
    rewards: [],
    withdraws: [],
  };
  createOrder(data, "u_1002", "plan_rm580", "first", "paid", pastDate(8));
  createOrder(data, "u_1003", "plan_rm180", "first", "paid", pastDate(1));
  return data;
}

async function loadState() {
  try {
    const snapshot = await getDoc(systemRef);
    if (snapshot.exists()) {
      cloudAvailable = true;
      return snapshot.data().state;
    }
    const seeded = createSeedData();
    await setDoc(systemRef, { state: seeded, updatedAt: serverTimestamp() });
    cloudAvailable = true;
    return seeded;
  } catch (error) {
    console.warn("Firestore unavailable, using local fallback.", error);
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : createSeedData();
  }
}

async function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!firebaseUser) return;
  try {
    await setDoc(systemRef, { state, updatedAt: serverTimestamp() }, { merge: true });
    cloudAvailable = true;
  } catch (error) {
    cloudAvailable = false;
    console.warn("Firestore save failed, fallback remains local.", error);
    toast("Firestore 保存失败，已暂存本地");
  }
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

function findUser(userId) {
  return state.users.find((item) => item.id === userId);
}

function findPlan(planId) {
  return state.plans.find((item) => item.id === planId);
}

function currentUser() {
  return findUser(state.currentUserId) || state.users[0];
}

function directReferralCount(userId, data = state) {
  return data.users.filter((user) => user.referrerId === userId).length;
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
    .filter((reward) => reward.userId === userId && reward.status === "confirmed")
    .reduce((sum, reward) => sum + reward.amount, 0);
  const requested = state.withdraws
    .filter((item) => item.userId === userId && item.status !== "rejected")
    .reduce((sum, item) => sum + item.amount, 0);
  return Math.max(confirmed - requested, 0);
}

function createOrder(data, userId, planId, type, status = "paid", createdAt = new Date().toISOString()) {
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
    points: status === "paid" ? plan.points : 0,
    createdAt,
  };
  data.orders.push(order);
  if (status === "paid") {
    user.points += plan.points;
    user.slots = Math.max(user.slots || 0, plan.slots);
    user.packageUntil = addDays(createdAt, plan.validDays);
    user.level = plan.amount >= 580 ? "高级推广用户" : "推广用户";
    data.pointLogs.push({ id: id("log"), userId, change: plan.points, balance: user.points, source: order.id, note: `${plan.name} 积分发放`, createdAt });
    createReward(data, order, user, plan);
  }
  return order;
}

function createReward(data, order, buyer, plan) {
  if (!buyer.referrerId) return;
  const referrer = data.users.find((item) => item.id === buyer.referrerId);
  if (!referrer || referrer.frozen) return;
  if (directReferralCount(referrer.id, data) > (referrer.slots || 0)) return;
  if (order.type === "repeat" && !isActivePackage(referrer)) return;
  const rate = order.type === "first" ? plan.firstRate : plan.repeatRate;
  data.rewards.push({
    id: id("rew"),
    userId: referrer.id,
    sourceUserId: buyer.id,
    orderId: order.id,
    type: order.type,
    rate,
    amount: +(order.amount * (rate / 100)).toFixed(2),
    status: "pending",
    confirmAfter: addDays(order.createdAt, CONFIRM_DAYS),
    createdAt: order.createdAt,
  });
}

function labelStatus(status) {
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
      photoURL: googleUser.photoURL || "",
      inviteCode: `${(googleUser.displayName || "G").slice(0, 1).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`,
      referrerId: "",
      level: "普通用户",
      points: 0,
      slots: 0,
      packageUntil: "",
      frozen: false,
    };
    state.users.push(user);
  } else {
    user.firebaseUid = googleUser.uid;
    user.name = googleUser.displayName || user.name;
    user.account = account;
    user.photoURL = googleUser.photoURL || user.photoURL || "";
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
  document.querySelector("#memberPlanStatus").textContent = statusLabel;
  document.querySelector("#memberPlanStatus").className = `tag ${statusClass}`;
  document.querySelector("#inviteLink").textContent = inviteLink;
  renderMemberPlans(user);
  renderMemberOrders(user);
  renderMemberReferrals(user);
  renderRewardRules();
  renderMemberRewards(user);
  renderMemberWithdraws(user);
}

function renderMemberPlans(user) {
  document.querySelector("#memberPlanCards").innerHTML = state.plans.map((plan) => `
    <article class="plan-card">
      <strong>${plan.name} · ${money(plan.amount)}</strong>
      <span>发放积分：${points(plan.points)}</span>
      <span>推荐权限：${plan.slots} 人 / 有效期：${plan.validDays} 天</span>
      <span>首充奖励：${plan.firstRate}% / 下线复购奖励：${plan.repeatRate}%</span>
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

function renderMemberReferrals(user) {
  const rows = state.users.filter((item) => item.referrerId === user.id).map((item) => {
    const [statusClass, statusLabel] = packageStatus(item);
    const sales = state.orders.filter((order) => order.userId === item.id && order.status === "paid").reduce((sum, order) => sum + order.amount, 0);
    return `<tr><td>${item.name}</td><td>${item.account}</td><td><span class="tag ${statusClass}">${statusLabel}</span></td><td>${money(sales)}</td><td>是</td></tr>`;
  }).join("");
  document.querySelector("#memberReferralTable").innerHTML = rows || `<tr><td colspan="5">暂无直接推荐用户</td></tr>`;
}

function renderRewardRules() {
  document.querySelector("#rewardRules").innerHTML = state.plans.map((plan) => `
    <article class="rule-card">
      <strong>${plan.name}</strong>
      <span>首充奖励：下线首次购买 ${money(plan.amount)}，推荐人获得 ${money(plan.amount * plan.firstRate / 100)}。</span>
      <span>下线复购奖励：下线复购时，推荐人配套有效才获得 ${money(plan.amount * plan.repeatRate / 100)}。</span>
      <span>奖励先待确认，${CONFIRM_DAYS} 天后由后台确认。</span>
    </article>
  `).join("");
}

function renderMemberRewards(user) {
  const rows = state.rewards.filter((reward) => reward.userId === user.id).slice().reverse().map((reward) => {
    const sourceUser = findUser(reward.sourceUserId);
    return `<tr><td>${sourceUser?.name || "-"}</td><td>${reward.orderId}</td><td>${reward.type === "first" ? "首充奖励" : "下线复购奖励"}</td><td>${reward.rate}%</td><td>${money(reward.amount)}</td><td><span class="tag ${reward.status}">${labelStatus(reward.status)}</span></td><td>${new Date(reward.confirmAfter).toLocaleDateString("zh-CN")}</td></tr>`;
  }).join("");
  document.querySelector("#memberRewardTable").innerHTML = rows || `<tr><td colspan="7">暂无奖励</td></tr>`;
}

function renderMemberWithdraws(user) {
  const rows = state.withdraws.filter((item) => item.userId === user.id).slice().reverse().map((item) => `<tr><td>${item.id}</td><td>${money(item.amount)}</td><td>${item.method}</td><td>${item.account}</td><td><span class="tag ${item.status}">${labelStatus(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td></tr>`).join("");
  document.querySelector("#memberWithdrawTable").innerHTML = rows || `<tr><td colspan="6">暂无提现记录</td></tr>`;
}

function renderAdmin() {
  document.querySelector("#metricUsers").textContent = state.users.length;
  document.querySelector("#metricSales").textContent = money(state.orders.filter((order) => order.status === "paid").reduce((sum, order) => sum + order.amount, 0));
  document.querySelector("#metricPendingRewards").textContent = money(state.rewards.filter((reward) => reward.status === "pending").reduce((sum, reward) => sum + reward.amount, 0));
  document.querySelector("#metricWithdraws").textContent = money(state.withdraws.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.amount, 0));
  renderAdminPlans();
  renderAdminUsers();
  renderAdminOrders();
  renderAdminRewards();
  renderAdminWithdraws();
}

function renderAdminPlans() {
  document.querySelector("#adminPlanList").innerHTML = state.plans.map((plan) => `
    <article class="plan-card">
      <strong>${plan.name} · ${money(plan.amount)}</strong>
      <span>积分 ${points(plan.points)} / 名额 ${plan.slots} / 有效期 ${plan.validDays} 天</span>
      <span>首充 ${plan.firstRate}% / 复购 ${plan.repeatRate}%</span>
    </article>
  `).join("");
}

function renderAdminUsers() {
  const userOptions = state.users.map((user) => `<option value="${user.id}">${user.name}（${user.inviteCode}）</option>`).join("");
  document.querySelector("#pointsForm [name='userId']").innerHTML = userOptions;
  document.querySelector("#adminUserTable").innerHTML = state.users.map((user) => {
    const referrer = findUser(user.referrerId);
    const [statusClass, statusLabel] = packageStatus(user);
    return `<tr><td>${user.name}</td><td>${user.account}</td><td>${user.inviteCode}</td><td>${referrer?.name || "无"}</td><td>${points(user.points)}</td><td><span class="tag ${statusClass}">${statusLabel}</span></td><td>${directReferralCount(user.id)} / ${user.slots || 0}</td><td><span class="tag ${user.frozen ? "frozen" : "active"}">${user.frozen ? "已冻结" : "正常"}</span></td><td><button class="link" data-freeze-user="${user.id}">${user.frozen ? "解冻" : "冻结"}</button></td></tr>`;
  }).join("");
}

function renderAdminOrders() {
  document.querySelector("#adminOrderTable").innerHTML = state.orders.slice().reverse().map((order) => {
    const user = findUser(order.userId);
    const plan = findPlan(order.planId);
    return `<tr><td>${order.id}</td><td>${user?.name || "-"}</td><td>${plan?.name || "-"}</td><td>${order.type === "first" ? "首充" : "复购"}</td><td>${money(order.amount)}</td><td>${points(order.points)}</td><td><span class="tag ${order.status}">${labelStatus(order.status)}</span></td><td>${new Date(order.createdAt).toLocaleString("zh-CN")}</td></tr>`;
  }).join("");
}

function renderAdminRewards() {
  const rows = state.rewards.slice().reverse().map((reward) => {
    const user = findUser(reward.userId);
    const sourceUser = findUser(reward.sourceUserId);
    const canConfirm = reward.status === "pending" && new Date(reward.confirmAfter) <= new Date();
    return `<tr><td>${user?.name || "-"}</td><td>${sourceUser?.name || "-"}</td><td>${reward.orderId}</td><td>${reward.type === "first" ? "首充" : "复购"}</td><td>${money(reward.amount)}</td><td><span class="tag ${reward.status}">${labelStatus(reward.status)}</span></td><td>${new Date(reward.confirmAfter).toLocaleDateString("zh-CN")}</td><td class="actions">${canConfirm ? `<button class="link" data-confirm-reward="${reward.id}">确认</button>` : ""}${reward.status === "pending" ? `<button class="link" data-cancel-reward="${reward.id}">取消</button><button class="link" data-freeze-reward="${reward.id}">冻结</button>` : ""}</td></tr>`;
  }).join("");
  document.querySelector("#adminRewardTable").innerHTML = rows || `<tr><td colspan="8">暂无奖励</td></tr>`;
}

function renderAdminWithdraws() {
  const rows = state.withdraws.slice().reverse().map((item) => {
    const user = findUser(item.userId);
    return `<tr><td>${item.id}</td><td>${user?.name || "-"}</td><td>${money(item.amount)}</td><td>${item.method}</td><td>${item.account}</td><td><span class="tag ${item.status}">${labelStatus(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td><td class="actions">${item.status === "pending" ? `<button class="link" data-approve-withdraw="${item.id}">通过</button><button class="link" data-reject-withdraw="${item.id}">拒绝</button>` : ""}${item.status === "approved" ? `<button class="link" data-pay-withdraw="${item.id}">标记打款</button>` : ""}</td></tr>`;
  }).join("");
  document.querySelector("#adminWithdrawTable").innerHTML = rows || `<tr><td colspan="8">暂无提现申请</td></tr>`;
}

function renderAll() {
  if (!state) return;
  updateAuthStatus();
  renderMember();
  renderAdmin();
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
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

document.querySelector("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = currentUser();
  const inviteCode = new FormData(event.currentTarget).get("inviteCode").trim();
  if (!inviteCode) return toast("请输入推荐码");
  if (user.referrerId) return toast("你已经绑定推荐人，不能更换");
  const referrer = state.users.find((item) => item.inviteCode === inviteCode);
  if (!referrer) return toast("推荐码不存在");
  if (referrer.id === user.id) return toast("不能绑定自己");
  if (directReferralCount(referrer.id) >= (referrer.slots || 0)) return toast("推荐人名额已满");
  user.referrerId = referrer.id;
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("推荐人已绑定");
});

document.querySelector("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.plans.push({
    id: id("plan"),
    name: form.get("name").trim(),
    amount: Number(form.get("amount")),
    points: Number(form.get("points")),
    slots: Number(form.get("slots")),
    validDays: Number(form.get("validDays")),
    firstRate: Number(form.get("firstRate")),
    repeatRate: Number(form.get("repeatRate")),
  });
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("配套规则已新增");
});

document.querySelector("#pointsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const user = findUser(form.get("userId"));
  const change = Number(form.get("points"));
  user.points += change;
  state.pointLogs.push({ id: id("log"), userId: user.id, change, balance: user.points, source: "admin", note: form.get("note").trim(), createdAt: new Date().toISOString() });
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("积分已调整");
});

document.querySelector("#withdrawForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = currentUser();
  const form = new FormData(event.currentTarget);
  const amount = Number(form.get("amount"));
  if (amount > confirmedAvailable(user.id)) return toast("可提现奖励不足");
  state.withdraws.push({ id: id("wd"), userId: user.id, amount, method: form.get("method").trim(), account: form.get("account").trim(), status: "pending", createdAt: new Date().toISOString() });
  event.currentTarget.reset();
  await saveState();
  renderAll();
  toast("提现申请已提交，等待后台审核");
});

document.querySelector("#confirmDueBtn").addEventListener("click", async () => {
  let count = 0;
  state.rewards.forEach((reward) => {
    if (reward.status === "pending" && new Date(reward.confirmAfter) <= new Date()) {
      reward.status = "confirmed";
      count += 1;
    }
  });
  await saveState();
  renderAll();
  toast(count ? `已确认 ${count} 笔奖励` : "暂无到期可确认奖励");
});

document.body.addEventListener("click", async (event) => {
  const buyPlan = event.target.closest("[data-buy-plan]");
  if (buyPlan) {
    if (!firebaseUser) return toast("请先使用 Google 登录");
    createOrder(state, currentUser().id, buyPlan.dataset.buyPlan, buyPlan.dataset.buyType, "paid");
    await saveState();
    renderAll();
    toast("配套申请已模拟支付成功");
    return;
  }

  if (event.target.closest("#copyInviteBtn")) {
    await navigator.clipboard.writeText(document.querySelector("#inviteLink").textContent);
    toast("推荐链接已复制");
    return;
  }

  const freezeUser = event.target.closest("[data-freeze-user]");
  if (freezeUser) {
    const user = findUser(freezeUser.dataset.freezeUser);
    user.frozen = !user.frozen;
    await saveState();
    renderAll();
    toast(user.frozen ? "用户已冻结" : "用户已解冻");
    return;
  }

  const rewardAction = event.target.closest("[data-confirm-reward], [data-cancel-reward], [data-freeze-reward]");
  if (rewardAction) {
    const rewardId = rewardAction.dataset.confirmReward || rewardAction.dataset.cancelReward || rewardAction.dataset.freezeReward;
    const reward = state.rewards.find((item) => item.id === rewardId);
    if (rewardAction.dataset.confirmReward) reward.status = "confirmed";
    if (rewardAction.dataset.cancelReward) reward.status = "cancelled";
    if (rewardAction.dataset.freezeReward) reward.status = "frozen";
    await saveState();
    renderAll();
    toast("奖励状态已更新");
    return;
  }

  const withdrawAction = event.target.closest("[data-approve-withdraw], [data-reject-withdraw], [data-pay-withdraw]");
  if (withdrawAction) {
    const withdrawId = withdrawAction.dataset.approveWithdraw || withdrawAction.dataset.rejectWithdraw || withdrawAction.dataset.payWithdraw;
    const withdraw = state.withdraws.find((item) => item.id === withdrawId);
    if (withdrawAction.dataset.approveWithdraw) withdraw.status = "approved";
    if (withdrawAction.dataset.rejectWithdraw) withdraw.status = "rejected";
    if (withdrawAction.dataset.payWithdraw) withdraw.status = "paidout";
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
  link.download = `affiliate-system-${new Date().toISOString().slice(0, 10)}.json`;
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
  if (!state) state = await loadState();
  if (user) {
    try {
      const snapshot = await getDoc(systemRef);
      if (snapshot.exists()) {
        state = snapshot.data().state;
        cloudAvailable = true;
      }
    } catch (error) {
      console.warn("Could not reload cloud state after login.", error);
    }
    upsertFirebaseUser(user);
    await saveState();
  }
  renderAll();
});

state = await loadState();
renderAll();
