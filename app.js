const STORAGE_KEY = "oneMinuteAffiliateSystem";

const seedData = {
  packages: [
    { id: "pkg_168", name: "体验配套", amount: 168, level1: 18, level2: 4 },
    { id: "pkg_888", name: "黄金配套", amount: 888, level1: 22, level2: 6 },
    { id: "pkg_2888", name: "钻石配套", amount: 2888, level1: 28, level2: 8 },
  ],
  affiliates: [
    { id: "aff_1001", name: "李明", phone: "13800000001", parentId: "" },
    { id: "aff_1002", name: "王芳", phone: "13800000002", parentId: "aff_1001" },
    { id: "aff_1003", name: "陈杰", phone: "13800000003", parentId: "aff_1001" },
  ],
  orders: [
    {
      id: "R20260614001",
      customer: "赵老板",
      affiliateId: "aff_1002",
      packageId: "pkg_888",
      status: "paid",
      createdAt: new Date().toISOString(),
    },
    {
      id: "R20260614002",
      customer: "小周",
      affiliateId: "aff_1003",
      packageId: "pkg_168",
      status: "pending",
      createdAt: new Date().toISOString(),
    },
  ],
  commissions: [],
};

let state = loadState();

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);
  const initial = structuredClone(seedData);
  initial.commissions = buildCommissions(initial.orders, initial.packages, initial.affiliates);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
}

function orderNo() {
  const date = new Date();
  const ymd = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `R${ymd}${String(state.orders.length + 1).padStart(3, "0")}`;
}

function findPackage(packageId) {
  return state.packages.find((item) => item.id === packageId);
}

function findAffiliate(affiliateId) {
  return state.affiliates.find((item) => item.id === affiliateId);
}

function buildCommissions(orders, packages, affiliates) {
  const commissions = [];
  orders.forEach((order) => {
    const pkg = packages.find((item) => item.id === order.packageId);
    const affiliate = affiliates.find((item) => item.id === order.affiliateId);
    if (!pkg || !affiliate || order.status !== "paid") return;

    commissions.push({
      id: id("com"),
      orderId: order.id,
      affiliateId: affiliate.id,
      level: "一级",
      amount: +(pkg.amount * (pkg.level1 / 100)).toFixed(2),
      status: "pending",
      createdAt: order.createdAt,
    });

    if (affiliate.parentId) {
      commissions.push({
        id: id("com"),
        orderId: order.id,
        affiliateId: affiliate.parentId,
        level: "二级",
        amount: +(pkg.amount * (pkg.level2 / 100)).toFixed(2),
        status: "pending",
        createdAt: order.createdAt,
      });
    }
  });
  return commissions;
}

function rebuildCommissions() {
  const previous = new Map(state.commissions.map((item) => [`${item.orderId}-${item.affiliateId}-${item.level}`, item.status]));
  state.commissions = buildCommissions(state.orders, state.packages, state.affiliates).map((item) => ({
    ...item,
    status: previous.get(`${item.orderId}-${item.affiliateId}-${item.level}`) || item.status,
  }));
}

function toast(message) {
  const toastEl = document.querySelector("#toast");
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function renderPackages() {
  const list = document.querySelector("#packageList");
  list.innerHTML = state.packages
    .map(
      (pkg) => `
        <article class="package-card">
          <strong>${pkg.name} · ${money(pkg.amount)}</strong>
          <span>一级 ${pkg.level1}% / 二级 ${pkg.level2}%</span>
        </article>
      `
    )
    .join("");
}

function renderSelects() {
  const affiliateOptions = state.affiliates
    .map((aff) => `<option value="${aff.id}">${aff.name}（${aff.phone}）</option>`)
    .join("");
  document.querySelector("[name='affiliateId']").innerHTML = affiliateOptions;

  const packageOptions = state.packages.map((pkg) => `<option value="${pkg.id}">${pkg.name} · ${money(pkg.amount)}</option>`).join("");
  document.querySelector("[name='packageId']").innerHTML = packageOptions;

  document.querySelector("[name='parentId']").innerHTML =
    `<option value="">无上级</option>` + state.affiliates.map((aff) => `<option value="${aff.id}">${aff.name}</option>`).join("");
}

function renderMetrics() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const paidOrders = state.orders.filter((order) => order.status === "paid");
  const totalFor = (predicate) =>
    paidOrders
      .filter(predicate)
      .reduce((sum, order) => sum + (findPackage(order.packageId)?.amount || 0), 0);

  document.querySelector("#metricToday").textContent = money(totalFor((order) => order.createdAt.slice(0, 10) === today));
  document.querySelector("#metricMonth").textContent = money(totalFor((order) => order.createdAt.slice(0, 7) === month));
  document.querySelector("#metricPending").textContent = money(
    state.commissions.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.amount, 0)
  );
  document.querySelector("#metricAffiliates").textContent = state.affiliates.length;
}

function renderOrders() {
  const filter = document.querySelector("#orderFilter").value;
  const rows = state.orders
    .filter((order) => filter === "all" || order.status === filter)
    .map((order) => {
      const pkg = findPackage(order.packageId);
      const affiliate = findAffiliate(order.affiliateId);
      const commissions = state.commissions.filter((item) => item.orderId === order.id);
      const commissionTotal = commissions.reduce((sum, item) => sum + item.amount, 0);
      return `
        <tr>
          <td>${order.id}</td>
          <td>${order.customer}</td>
          <td>${affiliate?.name || "已删除"}</td>
          <td>${pkg?.name || "已删除"}</td>
          <td>${money(pkg?.amount)}</td>
          <td>${money(commissionTotal)}</td>
          <td><span class="tag ${order.status}">${statusText(order.status)}</span></td>
          <td>${order.status === "pending" ? `<button class="link" data-pay="${order.id}">标记支付</button>` : "—"}</td>
        </tr>
      `;
    })
    .join("");
  document.querySelector("#orderTable").innerHTML = rows || `<tr><td colspan="8">暂无订单</td></tr>`;
}

function renderAffiliates() {
  const rows = state.affiliates
    .map((aff) => {
      const directOrders = state.orders.filter((order) => order.affiliateId === aff.id && order.status === "paid");
      const turnover = directOrders.reduce((sum, order) => sum + (findPackage(order.packageId)?.amount || 0), 0);
      const pending = state.commissions
        .filter((item) => item.affiliateId === aff.id && item.status === "pending")
        .reduce((sum, item) => sum + item.amount, 0);
      const parent = findAffiliate(aff.parentId);
      const link = `${location.origin}${location.pathname}?ref=${aff.id}`;
      return `
        <tr>
          <td>${aff.name}</td>
          <td>${aff.phone}</td>
          <td>${parent?.name || "无"}</td>
          <td><button class="link" data-copy="${link}">复制链接</button></td>
          <td>${money(turnover)}</td>
          <td>${money(pending)}</td>
        </tr>
      `;
    })
    .join("");
  document.querySelector("#affiliateTable").innerHTML = rows || `<tr><td colspan="6">暂无推广员</td></tr>`;
}

function renderCommissions() {
  const rows = state.commissions
    .slice()
    .reverse()
    .map((item) => {
      const affiliate = findAffiliate(item.affiliateId);
      return `
        <tr>
          <td>${affiliate?.name || "已删除"}</td>
          <td>${item.orderId}</td>
          <td>${item.level}</td>
          <td>${money(item.amount)}</td>
          <td><span class="tag ${item.status}">${item.status === "settled" ? "已结算" : "待结算"}</span></td>
          <td>${new Date(item.createdAt).toLocaleString("zh-CN")}</td>
        </tr>
      `;
    })
    .join("");
  document.querySelector("#commissionTable").innerHTML = rows || `<tr><td colspan="6">暂无佣金</td></tr>`;
}

function statusText(status) {
  return {
    paid: "已支付",
    pending: "待支付",
    refunded: "已退款",
  }[status];
}

function render() {
  renderPackages();
  renderSelects();
  renderMetrics();
  renderOrders();
  renderAffiliates();
  renderCommissions();
}

document.querySelector("#packageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.packages.push({
    id: id("pkg"),
    name: form.get("name").trim(),
    amount: Number(form.get("amount")),
    level1: Number(form.get("level1")),
    level2: Number(form.get("level2")),
  });
  event.currentTarget.reset();
  saveState();
  render();
  toast("充值配套已新增");
});

document.querySelector("#affiliateForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.affiliates.push({
    id: id("aff"),
    name: form.get("name").trim(),
    phone: form.get("phone").trim(),
    parentId: form.get("parentId"),
  });
  event.currentTarget.reset();
  saveState();
  render();
  toast("推广员已新增");
});

document.querySelector("#orderForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.orders.push({
    id: orderNo(),
    customer: form.get("customer").trim(),
    affiliateId: form.get("affiliateId"),
    packageId: form.get("packageId"),
    status: form.get("status"),
    createdAt: new Date().toISOString(),
  });
  rebuildCommissions();
  event.currentTarget.reset();
  saveState();
  render();
  toast("订单已生成");
});

document.querySelector("#orderFilter").addEventListener("change", renderOrders);

document.querySelector("#orderTable").addEventListener("click", (event) => {
  const button = event.target.closest("[data-pay]");
  if (!button) return;
  const order = state.orders.find((item) => item.id === button.dataset.pay);
  order.status = "paid";
  rebuildCommissions();
  saveState();
  render();
  toast("订单已标记为支付");
});

document.querySelector("#settleAllBtn").addEventListener("click", () => {
  let count = 0;
  state.commissions = state.commissions.map((item) => {
    if (item.status !== "pending") return item;
    count += 1;
    return { ...item, status: "settled" };
  });
  saveState();
  render();
  toast(count ? `已结算 ${count} 笔佣金` : "没有待结算佣金");
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

document.querySelector("#resetBtn").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  render();
  toast("演示数据已重置");
});

document.querySelector(".tabs").addEventListener("click", (event) => {
  const button = event.target.closest(".tab");
  if (!button) return;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  button.classList.add("active");
  document.querySelector(`#${button.dataset.tab}`).classList.add("active");
});

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  await navigator.clipboard.writeText(button.dataset.copy);
  toast("推广链接已复制");
});

render();
