const STORAGE_KEYS = {
  products: "simple-herbal-pos-products",
  sales: "simple-herbal-pos-sales",
  adminEmail: "simple-herbal-pos-admin-email",
  branchId: "simple-herbal-pos-branch-id",
  branches: "simple-herbal-pos-branches",
  authorizedUsers: "simple-herbal-pos-authorized-users",
  operatorEmail: "simple-herbal-pos-operator-email",
  paymentMethod: "simple-herbal-pos-payment-method",
  currentShift: "simple-herbal-pos-current-shift",
  shifts: "simple-herbal-pos-shifts",
  pendingSales: "simple-herbal-pos-pending-sales",
  pendingSaleUpdates: "simple-herbal-pos-pending-sale-updates",
  pendingProducts: "simple-herbal-pos-pending-products",
  pendingStockAdjustments: "simple-herbal-pos-pending-stock-adjustments",
  pendingAuditLogs: "simple-herbal-pos-pending-audit-logs",
  pendingManagement: "simple-herbal-pos-pending-management",
  stockAdjustments: "simple-herbal-pos-stock-adjustments",
  auditLogs: "simple-herbal-pos-local-audit-logs",
  settings: "simple-herbal-pos-settings",
  printerSettings: "simple-herbal-pos-printer-settings"
};

const ADMIN_EMAIL_HASH = "967c8833b2067bcf8ad711b817f9662dc8fd48e79e82992bfd56d5af919a6915";
const APP_VERSION = "v0.94";
const AUTHORIZATION_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const OFFLINE_PASSWORD_ITERATIONS = 210000;
const defaultBranches = [
  { id: "hq", name: "总店" },
  { id: "branch-1", name: "分行 1" },
  { id: "branch-2", name: "分行 2" }
];
const defaultAuthorizedUsers = [];
const defaultSettings = {
  businessName: "简单POS",
  defaultServiceName: "一般销售",
  serviceDays: 1,
  lowStockThreshold: 5,
  receiptFooter: "谢谢惠顾"
};
const defaultPrinterSettings = {
  paperWidth: "58",
  autoPrint: false,
  deviceId: "",
  deviceName: ""
};

const storageReadIssues = [];
const protectedCorruptStorageKeys = new Set();
let storageErrorAlertShown = false;
let lastStorageWriteError = "";

const sampleProducts = [
  { id: createId(), name: "3星期跟进服务", barcode: "SLIM-COACH-3W", category: "服务", price: 0, stock: 99, branchStock: { hq: 99, "branch-1": 99, "branch-2": 99 } },
  { id: "affiliate-plan-rm180", name: "简单联盟 RM180 配套", barcode: "AFF-PLAN-RM180", category: "联盟配套", price: 180, stock: 99, branchStock: { hq: 99, "branch-1": 99, "branch-2": 99 }, affiliatePlanId: "plan_rm180" }
];

const LEGACY_DEMO_PRODUCT_BARCODES = new Set([
  "SLIM-P1-3W",
  "SLIM-P1-REFILL"
]);

let products = load(STORAGE_KEYS.products, sampleProducts);
let sales = load(STORAGE_KEYS.sales, []).map(normalizeSaleExternalReferences);
let branches = load(STORAGE_KEYS.branches, defaultBranches);
let authorizedUsers = load(STORAGE_KEYS.authorizedUsers, defaultAuthorizedUsers);
let pendingSales = load(STORAGE_KEYS.pendingSales, []).map(normalizeSaleExternalReferences);
let pendingSaleUpdates = load(STORAGE_KEYS.pendingSaleUpdates, []).map(normalizeSaleExternalReferences);
let pendingProducts = load(STORAGE_KEYS.pendingProducts, []);
let pendingStockAdjustments = load(STORAGE_KEYS.pendingStockAdjustments, []);
let pendingAuditLogs = load(STORAGE_KEYS.pendingAuditLogs, []);
let pendingManagement = normalizePendingManagement(
  load(STORAGE_KEYS.pendingManagement, { branches: [], users: [], settings: null })
);
let stockAdjustments = load(STORAGE_KEYS.stockAdjustments, []);
let auditLogs = load(STORAGE_KEYS.auditLogs, []);
let appSettings = load(STORAGE_KEYS.settings, defaultSettings);
let printerSettings = {
  ...defaultPrinterSettings,
  ...load(STORAGE_KEYS.printerSettings, defaultPrinterSettings)
};
let cart = [];
let deferredInstallPrompt = null;
let adminEmail = readSessionEmail(STORAGE_KEYS.adminEmail);
let currentBranchId = localStorage.getItem(STORAGE_KEYS.branchId) || "hq";
let operatorEmail = readSessionEmail(STORAGE_KEYS.operatorEmail);
let preferredPaymentMethod = localStorage.getItem(STORAGE_KEYS.paymentMethod) || "现金";
let currentShift = load(STORAGE_KEYS.currentShift, null);
let shifts = load(STORAGE_KEYS.shifts, []);
let cloudSessionActive = false;
let currentCloudUser = null;
let reportRangeInitialized = false;
let autoFillPaid = true;
let currentView = "order";
let paymentMethodInitialized = false;
let showMoreSales = false;
let lastReceiptSale = null;
let editingProductId = "";
let editingIntegrationSaleId = "";
let showAllSalesDates = false;
let returnToSettlementAfterCashMovement = false;
let lastAuthorizationCheckAt = 0;
let authorizationRefreshInFlight = false;
let pendingSyncPromise = null;
let cloudDataLoadPromise = null;
let checkoutInProgress = false;
let cashMovementInProgress = false;
let integrationJobs = [];
let integrationJobsLoadedAt = "";
let integrationJobsLoading = false;
let integrationConnectionStatus = null;
let integrationConnectionLoading = false;
let integrationTraceStatus = null;
let integrationTraceLoading = false;

const VIEW_META = {
  order: { title: "下单", subtitle: "选择商品并完成当前订单" },
  menu: { title: "菜单", subtitle: "查看本分行可售商品与当前售价" },
  inventory: { title: "库存", subtitle: "查看库存流水和低库存提醒" },
  transactions: { title: "转账记录", subtitle: "查看销售记录、客户跟进和收款状态" },
  report: { title: "报告", subtitle: "查看销售指标、商品表现和付款趋势" },
  settings: { title: "设置", subtitle: "管理分行、员工、同步、备份和业务设置" }
};

function setAppView(view) {
  if (isAdmin() && !["report", "settings"].includes(view)) view = "report";
  if (!isAdmin() && getOperator() && view === "settings") view = "order";
  currentView = view;
  document.body.dataset.view = view;
  for (const button of document.querySelectorAll("[data-app-view]")) {
    button.classList.toggle("active", button.dataset.appView === view);
  }
  els.appMenu.classList.remove("open");
  els.menuToggleBtn.setAttribute("aria-expanded", "false");
  updateViewHeadings();
  renderAdminAccess();
  renderInventoryBranchFilter();
  renderSalesBranchFilter();
  renderInventoryOverview();
  renderSales();
  if (!canAccessView(view)) {
    els.adminLoginMessage.textContent = `请先登录有权限的账号，才能查看「${VIEW_META[view]?.title || "这个功能"}」。`;
    els.adminLoginMessage.classList.remove("error");
  }
}

function updateViewHeadings() {
  const meta = VIEW_META[currentView] || VIEW_META.order;
  if (els.adminTitle) {
    els.adminTitle.textContent = currentView === "report"
      ? (isAdmin() ? "全局总览" : "分行报告")
      : meta.title;
  }
  if (els.adminSubtitle) {
    els.adminSubtitle.textContent = currentView === "report" && !isAdmin() && getOperator()
      ? `${getBranchName(getOperationalBranchId())} · 仅显示授权分行资料`
      : meta.subtitle;
  }
}

const els = {
  networkStatus: document.querySelector("#networkStatus"),
  cloudStatus: document.querySelector("#cloudStatus"),
  branchStatus: document.querySelector("#branchStatus"),
  operatorStatus: document.querySelector("#operatorStatus"),
  adminStatus: document.querySelector("#adminStatus"),
  versionStatus: document.querySelector("#versionStatus"),
  adminTitle: document.querySelector("#adminTitle"),
  adminSubtitle: document.querySelector("#adminSubtitle"),
  appMenu: document.querySelector("#appMenu"),
  menuToggleBtn: document.querySelector("#menuToggleBtn"),
  cashierMenu: document.querySelector("#cashierMenu"),
  cashierToggleBtn: document.querySelector("#cashierToggleBtn"),
  cashierOperatorText: document.querySelector("#cashierOperatorText"),
  shiftStatusText: document.querySelector("#shiftStatusText"),
  quickCheckoutBtn: document.querySelector("#quickCheckoutBtn"),
  closeShiftBtn: document.querySelector("#closeShiftBtn"),
  cashMovementBtn: document.querySelector("#cashMovementBtn"),
  shiftOpeningCashPanel: document.querySelector("#shiftOpeningCashPanel"),
  shiftOpeningCashInput: document.querySelector("#shiftOpeningCashInput"),
  installBtn: document.querySelector("#installBtn"),
  seedBtn: document.querySelector("#seedBtn"),
  searchInput: document.querySelector("#searchInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  categoryRail: document.querySelector("#categoryRail"),
  branchSelect: document.querySelector("#branchSelect"),
  refreshCloudBtn: document.querySelector("#refreshCloudBtn"),
  productGrid: document.querySelector("#productGrid"),
  cartHint: document.querySelector("#cartHint"),
  cartItems: document.querySelector("#cartItems"),
  clearCartBtn: document.querySelector("#clearCartBtn"),
  orderOptionsToggle: document.querySelector("#orderOptionsToggle"),
  orderOptionsPanel: document.querySelector("#orderOptionsPanel"),
  operatorLoginForm: document.querySelector("#operatorLoginForm"),
  operatorEmailInput: document.querySelector("#operatorEmailInput"),
  operatorPasswordInput: document.querySelector("#operatorPasswordInput"),
  googleLoginBtn: document.querySelector("#googleLoginBtn"),
  operatorLogoutBtn: document.querySelector("#operatorLogoutBtn"),
  operatorMessage: document.querySelector("#operatorMessage"),
  customerNameInput: document.querySelector("#customerNameInput"),
  customerPhoneInput: document.querySelector("#customerPhoneInput"),
  affiliateReferralCodeInput: document.querySelector("#affiliateReferralCodeInput"),
  discountInput: document.querySelector("#discountInput"),
  customPaidPanel: document.querySelector("#customPaidPanel"),
  paidInput: document.querySelector("#paidInput"),
  quickPaidButtons: document.querySelector("#quickPaidButtons"),
  paymentMethodInput: document.querySelector("#paymentMethodInput"),
  quickPaymentButtons: document.querySelector("#quickPaymentButtons"),
  paymentReferenceInput: document.querySelector("#paymentReferenceInput"),
  subtotalText: document.querySelector("#subtotalText"),
  totalText: document.querySelector("#totalText"),
  changeText: document.querySelector("#changeText"),
  checkoutBtn: document.querySelector("#checkoutBtn"),
  paymentDialog: document.querySelector("#paymentDialog"),
  paymentDueText: document.querySelector("#paymentDueText"),
  paymentChangePreview: document.querySelector("#paymentChangePreview"),
  confirmPaymentBtn: document.querySelector("#confirmPaymentBtn"),
  closePaymentBtn: document.querySelector("#closePaymentBtn"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminEmailInput: document.querySelector("#adminEmailInput"),
  adminPasswordInput: document.querySelector("#adminPasswordInput"),
  adminGoogleLoginBtn: document.querySelector("#adminGoogleLoginBtn"),
  adminLoginMessage: document.querySelector("#adminLoginMessage"),
  adminLogoutBtn: document.querySelector("#adminLogoutBtn"),
  adminContent: document.querySelector("#adminContent"),
  productForm: document.querySelector("#productForm"),
  nameInput: document.querySelector("#nameInput"),
  barcodeInput: document.querySelector("#barcodeInput"),
  categoryInput: document.querySelector("#categoryInput"),
  priceInput: document.querySelector("#priceInput"),
  saveProductBtn: document.querySelector("#saveProductBtn"),
  cancelProductEditBtn: document.querySelector("#cancelProductEditBtn"),
  initCloudBtn: document.querySelector("#initCloudBtn"),
  syncPendingBtn: document.querySelector("#syncPendingBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  exportSummaryBtn: document.querySelector("#exportSummaryBtn"),
  exportPaymentSummaryBtn: document.querySelector("#exportPaymentSummaryBtn"),
  exportProductSalesBtn: document.querySelector("#exportProductSalesBtn"),
  exportInventoryBtn: document.querySelector("#exportInventoryBtn"),
  exportCustomersBtn: document.querySelector("#exportCustomersBtn"),
  exportAuditBtn: document.querySelector("#exportAuditBtn"),
  exportStockBtn: document.querySelector("#exportStockBtn"),
  exportShiftsBtn: document.querySelector("#exportShiftsBtn"),
  backupBtn: document.querySelector("#backupBtn"),
  restoreBtn: document.querySelector("#restoreBtn"),
  restoreInput: document.querySelector("#restoreInput"),
  resetDataBtn: document.querySelector("#resetDataBtn"),
  reportStartInput: document.querySelector("#reportStartInput"),
  reportEndInput: document.querySelector("#reportEndInput"),
  reportTodayBtn: document.querySelector("#reportTodayBtn"),
  reportMonthBtn: document.querySelector("#reportMonthBtn"),
  reportAllBtn: document.querySelector("#reportAllBtn"),
  globalRevenueText: document.querySelector("#globalRevenueText"),
  globalOrdersText: document.querySelector("#globalOrdersText"),
  reportRevenueLabel: document.querySelector("#reportRevenueLabel"),
  reportOrdersLabel: document.querySelector("#reportOrdersLabel"),
  globalCustomersText: document.querySelector("#globalCustomersText"),
  globalStockText: document.querySelector("#globalStockText"),
  branchOverview: document.querySelector("#branchOverview"),
  topProductsList: document.querySelector("#topProductsList"),
  dailyTrendList: document.querySelector("#dailyTrendList"),
  paymentSummaryList: document.querySelector("#paymentSummaryList"),
  menuSearchInput: document.querySelector("#menuSearchInput"),
  menuProductList: document.querySelector("#menuProductList"),
  inventoryBranchFilter: document.querySelector("#inventoryBranchFilter"),
  inventorySearchInput: document.querySelector("#inventorySearchInput"),
  inventoryOverviewList: document.querySelector("#inventoryOverviewList"),
  syncOverview: document.querySelector("#syncOverview"),
  integrationOverview: document.querySelector("#integrationOverview"),
  integrationConnectionOverview: document.querySelector("#integrationConnectionOverview"),
  checkIntegrationConnectionsBtn: document.querySelector("#checkIntegrationConnectionsBtn"),
  integrationTraceOrderInput: document.querySelector("#integrationTraceOrderInput"),
  traceIntegrationOrderBtn: document.querySelector("#traceIntegrationOrderBtn"),
  integrationTraceOverview: document.querySelector("#integrationTraceOverview"),
  integrationJobOverview: document.querySelector("#integrationJobOverview"),
  checkIntegrationJobsBtn: document.querySelector("#checkIntegrationJobsBtn"),
  refreshAffiliateCatalogBtn: document.querySelector("#refreshAffiliateCatalogBtn"),
  runDiagnosticsBtn: document.querySelector("#runDiagnosticsBtn"),
  diagnosticsOverview: document.querySelector("#diagnosticsOverview"),
  shiftList: document.querySelector("#shiftList"),
  auditList: document.querySelector("#auditList"),
  stockAdjustmentList: document.querySelector("#stockAdjustmentList"),
  followUpList: document.querySelector("#followUpList"),
  lowStockList: document.querySelector("#lowStockList"),
  settingsForm: document.querySelector("#settingsForm"),
  adminOfflinePasswordForm: document.querySelector("#adminOfflinePasswordForm"),
  adminOfflinePasswordInput: document.querySelector("#adminOfflinePasswordInput"),
  adminOfflinePasswordConfirm: document.querySelector("#adminOfflinePasswordConfirm"),
  adminOfflinePasswordStatus: document.querySelector("#adminOfflinePasswordStatus"),
  businessNameInput: document.querySelector("#businessNameInput"),
  defaultServiceNameInput: document.querySelector("#defaultServiceNameInput"),
  serviceDaysInput: document.querySelector("#serviceDaysInput"),
  lowStockThresholdInput: document.querySelector("#lowStockThresholdInput"),
  receiptFooterInput: document.querySelector("#receiptFooterInput"),
  branchForm: document.querySelector("#branchForm"),
  branchNameInput: document.querySelector("#branchNameInput"),
  branchSimplePayMerchantIdInput: document.querySelector("#branchSimplePayMerchantIdInput"),
  branchList: document.querySelector("#branchList"),
  userForm: document.querySelector("#userForm"),
  userNameInput: document.querySelector("#userNameInput"),
  userEmailInput: document.querySelector("#userEmailInput"),
  userPasswordInput: document.querySelector("#userPasswordInput"),
  userBranchSelect: document.querySelector("#userBranchSelect"),
  userList: document.querySelector("#userList"),
  salesSummary: document.querySelector("#salesSummary"),
  salesDateInput: document.querySelector("#salesDateInput"),
  salesSearchInput: document.querySelector("#salesSearchInput"),
  salesBranchFilter: document.querySelector("#salesBranchFilter"),
  salesPaymentFilter: document.querySelector("#salesPaymentFilter"),
  salesIntegrationFilter: document.querySelector("#salesIntegrationFilter"),
  dailyPaymentSummaryList: document.querySelector("#dailyPaymentSummaryList"),
  exportDailySettlementBtn: document.querySelector("#exportDailySettlementBtn"),
  exportIntegrationQueueBtn: document.querySelector("#exportIntegrationQueueBtn"),
  toggleSalesLimitBtn: document.querySelector("#toggleSalesLimitBtn"),
  todaySalesBtn: document.querySelector("#todaySalesBtn"),
  allSalesDatesBtn: document.querySelector("#allSalesDatesBtn"),
  salesList: document.querySelector("#salesList"),
  receiptDialog: document.querySelector("#receiptDialog"),
  receiptTitle: document.querySelector("#receiptTitle"),
  receiptNo: document.querySelector("#receiptNo"),
  receiptText: document.querySelector("#receiptText"),
  receiptSimplePayPanel: document.querySelector("#receiptSimplePayPanel"),
  receiptSimplePayQr: document.querySelector("#receiptSimplePayQr"),
  receiptSimplePayIntent: document.querySelector("#receiptSimplePayIntent"),
  receiptPaymentStatus: document.querySelector("#receiptPaymentStatus"),
  receiptCheckPaymentBtn: document.querySelector("#receiptCheckPaymentBtn"),
  closeReceiptBtn: document.querySelector("#closeReceiptBtn"),
  printReceiptBtn: document.querySelector("#printReceiptBtn"),
  bluetoothPrintReceiptBtn: document.querySelector("#bluetoothPrintReceiptBtn"),
  receiptPrinterStatus: document.querySelector("#receiptPrinterStatus"),
  printerPaperWidth: document.querySelector("#printerPaperWidth"),
  printerAutoPrint: document.querySelector("#printerAutoPrint"),
  printerConnectBtn: document.querySelector("#printerConnectBtn"),
  printerPairBtn: document.querySelector("#printerPairBtn"),
  printerTestBtn: document.querySelector("#printerTestBtn"),
  printerForgetBtn: document.querySelector("#printerForgetBtn"),
  printerStatus: document.querySelector("#printerStatus"),
  integrationDialog: document.querySelector("#integrationDialog"),
  integrationForm: document.querySelector("#integrationForm"),
  integrationOrderNo: document.querySelector("#integrationOrderNo"),
  integrationPosOrderId: document.querySelector("#integrationPosOrderId"),
  integrationSimplePayReference: document.querySelector("#integrationSimplePayReference"),
  integrationSimplePayStatus: document.querySelector("#integrationSimplePayStatus"),
  integrationAffiliateReferralCode: document.querySelector("#integrationAffiliateReferralCode"),
  integrationAffiliateOrderId: document.querySelector("#integrationAffiliateOrderId"),
  integrationAffiliateStatus: document.querySelector("#integrationAffiliateStatus"),
  closeIntegrationBtn: document.querySelector("#closeIntegrationBtn"),
  copyIntegrationOrderIdBtn: document.querySelector("#copyIntegrationOrderIdBtn"),
  shiftSettlementDialog: document.querySelector("#shiftSettlementDialog"),
  shiftSettlementForm: document.querySelector("#shiftSettlementForm"),
  settlementShiftInfo: document.querySelector("#settlementShiftInfo"),
  settlementOrders: document.querySelector("#settlementOrders"),
  settlementTotal: document.querySelector("#settlementTotal"),
  settlementExpectedCash: document.querySelector("#settlementExpectedCash"),
  settlementVoids: document.querySelector("#settlementVoids"),
  settlementPaymentList: document.querySelector("#settlementPaymentList"),
  settlementWarnings: document.querySelector("#settlementWarnings"),
  settlementOpeningCash: document.querySelector("#settlementOpeningCash"),
  settlementCashIn: document.querySelector("#settlementCashIn"),
  settlementCashOut: document.querySelector("#settlementCashOut"),
  settlementCountedCash: document.querySelector("#settlementCountedCash"),
  settlementCashDifference: document.querySelector("#settlementCashDifference"),
  settlementNote: document.querySelector("#settlementNote"),
  closeSettlementBtn: document.querySelector("#closeSettlementBtn"),
  exportCurrentSettlementBtn: document.querySelector("#exportCurrentSettlementBtn"),
  settlementCashMovementBtn: document.querySelector("#settlementCashMovementBtn"),
  cashMovementDialog: document.querySelector("#cashMovementDialog"),
  cashMovementForm: document.querySelector("#cashMovementForm"),
  cashMovementShiftInfo: document.querySelector("#cashMovementShiftInfo"),
  cashMovementType: document.querySelector("#cashMovementType"),
  cashMovementAmount: document.querySelector("#cashMovementAmount"),
  cashMovementReason: document.querySelector("#cashMovementReason"),
  cashMovementSubmitBtn: document.querySelector("#cashMovementSubmitBtn"),
  cashMovementInTotal: document.querySelector("#cashMovementInTotal"),
  cashMovementOutTotal: document.querySelector("#cashMovementOutTotal"),
  cashMovementList: document.querySelector("#cashMovementList"),
  closeCashMovementBtn: document.querySelector("#closeCashMovementBtn")
};

function readSessionEmail(key) {
  try {
    localStorage.removeItem(key);
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function persistSessionEmail(key, value) {
  try {
    sessionStorage.setItem(key, value);
    localStorage.removeItem(key);
  } catch (error) {
    reportStorageError(error);
  }
}

function clearSessionEmail(key) {
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  } catch (error) {
    console.warn("Session clear failed", error);
  }
}

function load(key, fallback) {
  let raw = null;
  try {
    raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch (error) {
    const recoveryKey = `${key}.corrupt-${Date.now()}`;
    let preserved = false;
    if (raw) {
      try {
        localStorage.setItem(recoveryKey, raw);
        localStorage.removeItem(key);
        preserved = true;
      } catch {
        protectedCorruptStorageKeys.add(key);
      }
    }
    storageReadIssues.push({ key, recoveryKey: preserved ? recoveryKey : "", raw: preserved ? "" : (raw || ""), message: error.message });
    return structuredClone(fallback);
  }
}

function reportStorageError(error) {
  lastStorageWriteError = error?.message || "本机储存无法写入";
  console.error("Local storage write failed", error);
  setTimeout(() => {
    updateCloudStatus("本机储存失败，请立即导出备份");
    if (!storageErrorAlertShown) {
      storageErrorAlertShown = true;
      alert("本机储存空间不足或无法写入。系统没有覆盖原资料，请立即导出完整备份并释放浏览器空间。");
    }
  }, 0);
}

function save(key, value) {
  if (protectedCorruptStorageKeys.has(key)) {
    reportStorageError(new Error(`${key} 含有尚未保存的损坏原始资料`));
    return false;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    reportStorageError(error);
    return false;
  }
}

function saveStorageBatch(entries, { allowProtected = false } = {}) {
  const originals = new Map();
  try {
    const prepared = entries.map(([key, value]) => [key, JSON.stringify(value)]);
    for (const [key] of entries) originals.set(key, localStorage.getItem(key));
    for (const [key, serialized] of prepared) {
      if (!allowProtected && protectedCorruptStorageKeys.has(key)) throw new Error(`${key} 含有尚未保存的损坏原始资料`);
      localStorage.setItem(key, serialized);
    }
    if (allowProtected) {
      for (const [key] of entries) protectedCorruptStorageKeys.delete(key);
    }
    return true;
  } catch (error) {
    for (const [key, original] of originals) {
      try {
        if (original === null) localStorage.removeItem(key);
        else localStorage.setItem(key, original);
      } catch (rollbackError) {
        console.error(`Storage rollback failed: ${key}`, rollbackError);
      }
    }
    reportStorageError(error);
    return false;
  }
}

function getStorageRecoveryEntries() {
  const entries = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.includes(".corrupt-")) continue;
    entries.push({ key, raw: localStorage.getItem(key) || "" });
  }
  for (const issue of storageReadIssues) {
    if (!issue.raw || entries.some((entry) => entry.key === issue.key)) continue;
    entries.push({ key: issue.key, raw: issue.raw, error: issue.message });
  }
  return entries;
}

function normalizeSaleExternalReferences(sale = {}) {
  const payment = sale.payment || {};
  const existing = sale.externalReferences || {};
  const referralCode = String(
    sale.customer?.referralCode || existing.affiliateReferralCode || ""
  ).trim().toUpperCase();
  const simplePayReference = String(
    existing.simplePayReference
      || (payment.method === "简单支付 / SimplePay" ? payment.reference : "")
      || ""
  ).trim();
  const affiliateOrderId = String(existing.affiliateOrderId || "").trim();
  return {
    ...sale,
    customer: {
      ...(sale.customer || {}),
      referralCode
    },
    externalReferences: {
      ...existing,
      posOrderId: existing.posOrderId || sale.id || "",
      simplePayReference,
      simplePayStatus: existing.simplePayStatus
        || (payment.method === "简单支付 / SimplePay" ? (simplePayReference ? "linked" : "pending") : "not-used"),
      affiliateReferralCode: referralCode,
      affiliateOrderId,
      affiliateStatus: existing.affiliateStatus
        || (affiliateOrderId ? "linked" : (referralCode ? "pending" : "not-used"))
    }
  };
}

function attachIntegrationOutbox(sale, eventType = "checkout") {
  if (!window.integrationContract) return sale;
  return window.integrationContract.attachJobReferences(sale, eventType);
}

function getInventoryReviewStatus(sale) {
  return sale?.inventoryReview?.status || "none";
}

function requiresInventoryReview(sale) {
  return getInventoryReviewStatus(sale) === "required";
}

function getInventoryConflictSummary(sale) {
  const conflicts = Array.isArray(sale?.inventoryReview?.conflicts) ? sale.inventoryReview.conflicts : [];
  if (!conflicts.length) return "云端库存与离线销售不一致";
  return conflicts.map((conflict) => {
    const cloudStock = conflict.cloudStock === null || conflict.cloudStock === undefined
      ? "云端无商品"
      : `云端 ${conflict.cloudStock}`;
    return `${conflict.productName || conflict.productId}：需 ${conflict.requestedQty || 0}，${cloudStock}`;
  }).join("；");
}

function hasCloud() {
  return Boolean(window.cloudPOS);
}

function updateCloudStatus(text, ok = false) {
  const pendingCount = pendingSales.length
    + pendingSaleUpdates.length
    + pendingProducts.length
    + pendingStockAdjustments.length
    + pendingAuditLogs.length
    + getPendingManagementCount();
  const pendingText = pendingCount ? ` · 待同步 ${pendingCount}` : "";
  const inventoryReviewCount = sales.filter(requiresInventoryReview).length;
  const reviewText = inventoryReviewCount ? ` · 库存待复核 ${inventoryReviewCount}` : "";
  els.cloudStatus.textContent = `${text}${pendingText}${reviewText}`;
  els.cloudStatus.style.color = ok ? "#0f766e" : "#66756f";
}

function getErrorMessage(error) {
  return error?.code || error?.message || "未知错误";
}

function savePendingSales() {
  save(STORAGE_KEYS.pendingSales, pendingSales);
}

function queuePendingSale(sale) {
  pendingSales = [
    { ...sale, syncStatus: "pending" },
    ...pendingSales.filter((item) => item.id !== sale.id)
  ];
  savePendingSales();
  updateCloudStatus("订单待同步");
}

function markSaleSynced(saleId, patch = {}) {
  pendingSales = pendingSales.filter((sale) => sale.id !== saleId);
  savePendingSales();
  sales = sales.map((sale) => sale.id === saleId ? { ...sale, syncStatus: "synced", ...patch } : sale);
  save(STORAGE_KEYS.sales, sales);
}

function applyCheckoutSyncResult(saleId, result) {
  if (result?.status !== "inventory-review") {
    markSaleSynced(saleId);
    return false;
  }
  const previous = sales.find((sale) => sale.id === saleId);
  const inventoryReview = result.inventoryReview || {
    status: "required",
    detectedAt: new Date().toISOString(),
    conflicts: []
  };
  markSaleSynced(saleId, {
    syncStatus: "review-required",
    inventoryReview
  });
  if (!requiresInventoryReview(previous)) {
    writeAuditLog("inventory.conflict.detected", {
      saleId,
      branchId: inventoryReview.branchId || previous?.branchId || "hq",
      conflicts: inventoryReview.conflicts || []
    });
  }
  updateCloudStatus("订单已保存，库存待复核");
  return true;
}

function savePendingSaleUpdates() {
  save(STORAGE_KEYS.pendingSaleUpdates, pendingSaleUpdates);
}

function queuePendingSaleUpdate(sale) {
  pendingSaleUpdates = [
    sale,
    ...pendingSaleUpdates.filter((item) => item.id !== sale.id)
  ];
  savePendingSaleUpdates();
  updateCloudStatus("订单更新待同步");
}

function markSaleUpdateSynced(saleId, patch = {}) {
  pendingSaleUpdates = pendingSaleUpdates.filter((sale) => sale.id !== saleId);
  savePendingSaleUpdates();
  sales = sales.map((sale) => sale.id === saleId ? { ...sale, syncStatus: "synced", ...patch } : sale);
  save(STORAGE_KEYS.sales, sales);
}

function applyVoidSyncResult(saleId, result) {
  const reviewRequired = result?.stockStatus === "review-required";
  markSaleUpdateSynced(saleId, {
    syncStatus: reviewRequired ? "review-required" : "synced",
    ...(result && Object.hasOwn(result, "inventoryReview")
      ? { inventoryReview: result.inventoryReview }
      : {})
  });
  updateCloudStatus(reviewRequired ? "订单已作废，退款库存待复核" : "退款与库存已同步", !reviewRequired);
  return reviewRequired;
}

function savePendingProducts() {
  save(STORAGE_KEYS.pendingProducts, pendingProducts);
}

function queuePendingProduct(product) {
  pendingProducts = [
    product,
    ...pendingProducts.filter((item) => item.id !== product.id)
  ];
  savePendingProducts();
  updateCloudStatus("库存待同步");
}

function markProductSynced(productId) {
  pendingProducts = pendingProducts.filter((product) => product.id !== productId);
  savePendingProducts();
}

function savePendingStockAdjustments() {
  save(STORAGE_KEYS.pendingStockAdjustments, pendingStockAdjustments);
}

function queuePendingStockAdjustment(adjustment) {
  pendingStockAdjustments = [
    adjustment,
    ...pendingStockAdjustments.filter((item) => item.id !== adjustment.id)
  ];
  savePendingStockAdjustments();
  updateCloudStatus("库存调整待同步");
}

function markStockAdjustmentSynced(adjustmentId) {
  pendingStockAdjustments = pendingStockAdjustments.filter((item) => item.id !== adjustmentId);
  savePendingStockAdjustments();
}

function recordStockAdjustment(adjustment) {
  stockAdjustments = [
    adjustment,
    ...stockAdjustments.filter((item) => item.id !== adjustment.id)
  ].slice(0, 500);
  save(STORAGE_KEYS.stockAdjustments, stockAdjustments);
}

function savePendingAuditLogs() {
  save(STORAGE_KEYS.pendingAuditLogs, pendingAuditLogs);
}

function normalizePendingManagement(value = {}) {
  return {
    branches: Array.isArray(value.branches) ? value.branches : [],
    users: Array.isArray(value.users) ? value.users : [],
    settings: value.settings && typeof value.settings === "object" ? value.settings : null
  };
}

function savePendingManagement() {
  save(STORAGE_KEYS.pendingManagement, pendingManagement);
}

function getPendingManagementCount() {
  return pendingManagement.branches.length
    + pendingManagement.users.length
    + (pendingManagement.settings ? 1 : 0);
}

function queuePendingManagement(type, value) {
  if (type === "branch") {
    pendingManagement.branches = [
      value,
      ...pendingManagement.branches.filter((item) => item.id !== value.id)
    ];
  } else if (type === "user") {
    pendingManagement.users = [
      value,
      ...pendingManagement.users.filter((item) => normalizeEmail(item.email) !== normalizeEmail(value.email))
    ];
  } else if (type === "settings") {
    pendingManagement.settings = value;
  }
  savePendingManagement();
  updateCloudStatus("后台资料待同步");
}

function markManagementSynced(type, id = "") {
  if (type === "branch") {
    pendingManagement.branches = pendingManagement.branches.filter((item) => item.id !== id);
  } else if (type === "user") {
    pendingManagement.users = pendingManagement.users.filter((item) => normalizeEmail(item.email) !== normalizeEmail(id));
  } else if (type === "settings") {
    pendingManagement.settings = null;
  }
  savePendingManagement();
}

function getCurrentActor() {
  return currentCloudUser || getActiveCashier() || { email: adminEmail || operatorEmail || "", name: "本机用户" };
}

function queuePendingAuditLog(log) {
  pendingAuditLogs = [
    log,
    ...pendingAuditLogs.filter((item) => item.id !== log.id)
  ];
  savePendingAuditLogs();
}

function markAuditLogSynced(logId) {
  pendingAuditLogs = pendingAuditLogs.filter((item) => item.id !== logId);
  savePendingAuditLogs();
}

async function writeAuditLog(action, detail = {}) {
  const log = {
    id: `AUD${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    detail,
    actor: getCurrentActor(),
    branchId: currentBranchId,
    branchName: getBranchName(currentBranchId),
    createdAt: new Date().toISOString()
  };
  auditLogs = [
    log,
    ...auditLogs.filter((item) => item.id !== log.id)
  ].slice(0, 500);
  save(STORAGE_KEYS.auditLogs, auditLogs);
  if (!hasCloud() || !navigator.onLine) {
    queuePendingAuditLog(log);
    return false;
  }
  try {
    await window.cloudPOS.saveAuditLog(log);
    markAuditLogSynced(log.id);
    return true;
  } catch (error) {
    queuePendingAuditLog(log);
    console.warn("Audit log sync failed", error);
    return false;
  }
}

function isAdmin() {
  return Boolean(adminEmail);
}

function canUseOperations() {
  return Boolean(getOperator()) && !isAdmin();
}

function canAccessView(view = currentView) {
  if (isAdmin()) return view === "report" || view === "settings";
  if (view === "order") return true;
  if (["menu", "inventory", "transactions", "report"].includes(view)) return canUseOperations();
  return false;
}

function getOperationalBranchId() {
  return isAdmin() ? currentBranchId : getOperator()?.branchId || currentBranchId;
}

function canManageBranch(branchId) {
  if (isAdmin()) return true;
  const operator = getOperator();
  return Boolean(operator && operator.branchId === branchId);
}

function canVoidSale(sale) {
  if (!sale || isSaleVoided(sale)) return false;
  return canManageBranch(sale.branchId || "hq");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isConfiguredAdminEmail(email) {
  return sha256Hex(normalizeEmail(email)).then((hash) => hash === ADMIN_EMAIL_HASH);
}

function createPasswordSalt() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function hashOfflinePassword(email, password, salt, iterations = OFFLINE_PASSWORD_ITERATIONS) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: encoder.encode(`${salt}:${normalizeEmail(email)}`),
    iterations: Math.max(100000, Number(iterations || OFFLINE_PASSWORD_ITERATIONS))
  }, key, 256);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyOfflinePassword(user, password) {
  if (!user?.offlinePasswordHash || !user?.offlinePasswordSalt) return false;
  const hash = user.offlinePasswordAlgorithm === "PBKDF2-SHA256"
    ? await hashOfflinePassword(
        user.email,
        password,
        user.offlinePasswordSalt,
        user.offlinePasswordIterations
      )
    : await sha256Hex(`${user.offlinePasswordSalt}:${normalizeEmail(user.email)}:${password}`);
  return hash === user.offlinePasswordHash;
}

function ensureAdminAuthorized(email) {
  const normalized = normalizeEmail(email);
  if (!authorizedUsers.some((user) => normalizeEmail(user.email) === normalized)) {
    authorizedUsers.unshift({
      id: "admin-user",
      name: "管理员",
      email: normalized,
      branchId: "hq",
      role: "管理员",
      active: true
    });
    save(STORAGE_KEYS.authorizedUsers, authorizedUsers);
  }
}

function getBranchName(branchId) {
  const branch = branches.find((item) => item.id === branchId || normalizeEmail(item.name) === normalizeEmail(branchId));
  return branch?.name || "未知分行";
}

function resolveBranchId(value) {
  const normalized = normalizeEmail(value);
  if (!normalized) return "hq";
  const branch = branches.find((item) => {
    return normalizeEmail(item.id) === normalized
      || normalizeEmail(item.name) === normalized
      || createSlug(item.name) === normalized;
  });
  return branch?.id || "";
}

function normalizeBranchStock(branchStock = {}) {
  const nextStock = Object.fromEntries(branches.map((branch) => [branch.id, 0]));
  for (const [rawBranchId, rawStock] of Object.entries(branchStock || {})) {
    const branchId = resolveBranchId(rawBranchId);
    if (!branchId || !Object.hasOwn(nextStock, branchId)) continue;
    nextStock[branchId] = Number(nextStock[branchId] || 0) + Number(rawStock || 0);
  }
  return nextStock;
}

function normalizeProductBranches(product) {
  return {
    ...product,
    branchStock: normalizeBranchStock(product.branchStock || (product.stock ? { hq: product.stock } : {}))
  };
}

function syncCurrentBranchFromSelect() {
  enforceBranchAccess();
  const selectedBranchId = resolveBranchId(els.branchSelect.value);
  const fallbackBranchId = resolveBranchId(currentBranchId) || "hq";
  if (!isBranchLockedToOperator()) {
    currentBranchId = selectedBranchId || fallbackBranchId;
  }
  if (!branches.some((branch) => branch.id === currentBranchId)) currentBranchId = "hq";
  localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
  if (els.branchSelect.value !== currentBranchId) els.branchSelect.value = currentBranchId;
  return currentBranchId;
}

function getBranchStock(product, branchId = currentBranchId) {
  if (product.branchStock && Number.isFinite(Number(product.branchStock[branchId]))) {
    return Number(product.branchStock[branchId]);
  }
  if (branchId === "hq") return Number(product.stock || 0);
  return 0;
}

function setBranchStock(product, branchId, stock) {
  return {
    ...product,
    stock: branchId === "hq" ? stock : product.stock,
    branchStock: {
      ...(product.branchStock || {}),
      [branchId]: stock
    }
  };
}

function createBranchStock(initialStock = 0, selectedBranchId = currentBranchId) {
  return Object.fromEntries(
    branches.map((branch) => [branch.id, branch.id === selectedBranchId ? Number(initialStock || 0) : 0])
  );
}

function getTotalStock() {
  return products.reduce((sum, product) => {
    const branchStock = product.branchStock
      ? Object.values(product.branchStock).reduce((total, value) => total + Number(value || 0), 0)
      : Number(product.stock || 0);
    return sum + branchStock;
  }, 0);
}

function migrateProductsForBranches() {
  products = products.filter((product) => !isLegacyDemoProduct(product));
  pendingProducts = pendingProducts.filter((product) => !isLegacyDemoProduct(product));
  cart = cart.filter((item) => !isLegacyDemoProduct(item));
  savePendingProducts();
  const affiliateSample = sampleProducts.find((product) => product.id === "affiliate-plan-rm180");
  if (affiliateSample && !products.some((product) => product.id === affiliateSample.id)) {
    const product = normalizeProductBranches(structuredClone(affiliateSample));
    products.push(product);
    pendingProducts = [
      product,
      ...pendingProducts.filter((item) => item.id !== product.id)
    ];
    savePendingProducts();
  }
  products = products.map((product) => {
    return normalizeProductBranches(product);
  });
  save(STORAGE_KEYS.products, products);
}

function isLegacyDemoProduct(product = {}) {
  return LEGACY_DEMO_PRODUCT_BARCODES.has(String(product.barcode || "").trim().toUpperCase());
}

function cloneSampleProductsForBranches() {
  return structuredClone(sampleProducts).map((product) => ({
    ...product,
    branchStock: Object.fromEntries(
      branches.map((branch) => [branch.id, Number(product.branchStock?.[branch.id] || 0)])
    )
  }));
}

function migrateSaleExternalReferences() {
  sales = sales.map(normalizeSaleExternalReferences);
  pendingSales = pendingSales.map(normalizeSaleExternalReferences);
  pendingSaleUpdates = pendingSaleUpdates.map(normalizeSaleExternalReferences);
  save(STORAGE_KEYS.sales, sales);
  savePendingSales();
  savePendingSaleUpdates();
}

function migrateManagementData() {
  appSettings = { ...defaultSettings, ...appSettings };
  let settingsMigrated = false;
  if (appSettings.businessName === "简单草本减脂计划") {
    appSettings.businessName = "简单POS";
    settingsMigrated = true;
  }
  if (appSettings.defaultServiceName === "简单草本减脂计划第一阶段") {
    appSettings.defaultServiceName = "一般销售";
    appSettings.serviceDays = 1;
    settingsMigrated = true;
  }
  if (settingsMigrated) {
    pendingManagement.settings = { ...appSettings };
    savePendingManagement();
  }
  if (!branches.length) branches = structuredClone(defaultBranches);
  if (!authorizedUsers.length) authorizedUsers = structuredClone(defaultAuthorizedUsers);
  currentBranchId = resolveBranchId(currentBranchId) || currentBranchId;
  if (!branches.some((branch) => branch.id === currentBranchId)) {
    currentBranchId = "hq";
    localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
  }
  save(STORAGE_KEYS.branches, branches);
  save(STORAGE_KEYS.authorizedUsers, authorizedUsers);
  save(STORAGE_KEYS.settings, appSettings);
  migrateSaleExternalReferences();
}

function renderBranchSelect() {
  enforceBranchAccess();
  if (!branches.some((branch) => branch.id === currentBranchId)) {
    currentBranchId = resolveBranchId(currentBranchId) || "hq";
    localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
    cart = [];
  }
  els.branchSelect.innerHTML = "";
  for (const branch of branches) {
    const option = document.createElement("option");
    option.value = branch.id;
    option.textContent = branch.name;
    els.branchSelect.append(option);
  }
  els.branchSelect.value = currentBranchId;
  els.branchStatus.textContent = getBranchName(els.branchSelect.value);
  els.branchSelect.disabled = isBranchLockedToOperator() || hasOpenShift();
  els.branchSelect.title = hasOpenShift()
    ? `当前班次属于 ${getCurrentShiftLabel()}，结班后才可切换分行。`
    : isBranchLockedToOperator()
      ? "收银员只能使用授权分行；管理员登录后可切换全部分行。"
      : "管理员可切换总店与所有分行。";
}

function renderAdminAccess() {
  const adminAllowed = isAdmin();
  const viewAllowed = canAccessView();
  const operationalAllowed = canUseOperations() && ["menu", "inventory", "transactions", "report"].includes(currentView);
  els.adminStatus.textContent = adminAllowed ? "管理员 · 设置/总览" : operationalAllowed ? "分行员工权限" : "后台未登录";
  els.adminStatus.style.color = adminAllowed || operationalAllowed ? "#0f766e" : "#66756f";
  els.adminLoginForm.classList.toggle("hidden", adminAllowed || operationalAllowed);
  els.adminLogoutBtn.classList.toggle("hidden", !adminAllowed);
  els.adminContent.classList.toggle("hidden", !viewAllowed);
  els.productForm.classList.toggle("hidden", !adminAllowed);
  for (const button of document.querySelectorAll("[data-app-view]")) {
    const view = button.dataset.appView;
    const visible = adminAllowed
      ? ["report", "settings"].includes(view)
      : canUseOperations()
        ? view !== "settings"
        : ["order", "settings"].includes(view);
    button.classList.toggle("hidden", !visible);
  }
  for (const tools of document.querySelectorAll("[data-employee-tools]")) {
    tools.classList.toggle("hidden", !canUseOperations());
  }
  for (const section of document.querySelectorAll("[data-admin-only]")) {
    section.classList.toggle("hidden", !adminAllowed);
  }
  if (adminAllowed) {
    els.adminLoginMessage.classList.remove("error");
    els.adminLoginMessage.textContent = isCloudAdmin()
      ? "Google 管理员已授权；仅开放设置与全局总览。"
      : "本机管理员已授权；仅开放设置与全局总览。";
  } else if (operationalAllowed) {
    els.adminLoginMessage.classList.remove("error");
    els.adminLoginMessage.textContent = "员工可处理本分行下单、库存、交易与报告。";
  }
}

function getOperator() {
  const email = normalizeEmail(operatorEmail);
  return authorizedUsers.find((user) => normalizeEmail(user.email) === email && user.active !== false) || null;
}

function getAdminOperator() {
  const email = normalizeEmail(adminEmail || currentCloudUser?.email);
  if (!email || !isAdmin()) return null;
  const savedAdmin = authorizedUsers.find((user) => normalizeEmail(user.email) === email && user.active !== false);
  return {
    id: savedAdmin?.id || "admin-user",
    name: savedAdmin?.name || "管理员",
    email,
    branchId: currentBranchId,
    role: "admin",
    active: true
  };
}

function getActiveCashier() {
  return getAdminOperator() || getOperator();
}

function hasOpenShift() {
  return Boolean(currentShift && !currentShift.closedAt);
}

function isShiftIdentity(email, branchId) {
  return hasOpenShift()
    && normalizeEmail(currentShift.operatorEmail) === normalizeEmail(email)
    && currentShift.branchId === branchId;
}

function isCurrentShiftOwner() {
  const operator = getActiveCashier();
  return Boolean(operator && isShiftIdentity(operator.email, currentBranchId));
}

function canManageCurrentShift() {
  return hasOpenShift() && isCurrentShiftOwner();
}

function getCurrentShiftLabel() {
  if (!hasOpenShift()) return "";
  return `${currentShift.operatorName || currentShift.operatorEmail || "原操作员"} · ${currentShift.branchName || getBranchName(currentShift.branchId)}`;
}

function isOperatorAllowedForCurrentBranch() {
  if (isAdmin()) return false;
  const operator = getOperator();
  return Boolean(operator && operator.branchId === currentBranchId);
}

function isBranchLockedToOperator() {
  return Boolean(getOperator() && !isAdmin());
}

function enforceBranchAccess() {
  if (isAdmin()) return;
  const operator = getOperator();
  if (operator && currentBranchId !== operator.branchId) {
    currentBranchId = operator.branchId;
    localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
    cart = [];
  }
}

function saveCurrentShift() {
  return save(STORAGE_KEYS.currentShift, currentShift);
}

function saveShifts() {
  return save(STORAGE_KEYS.shifts, shifts);
}

function ensureCurrentShift(openingCash = Number(els.shiftOpeningCashInput?.value || 0)) {
  const operator = getActiveCashier();
  if (!operator) return false;
  if (hasOpenShift()) {
    if (isShiftIdentity(operator.email, currentBranchId)) return true;
    alert(`当前班次属于 ${getCurrentShiftLabel()}。请先由原员工恢复班次，或由管理员完成交班。`);
    return false;
  }
  const nextShift = {
    id: `SHIFT${Date.now()}`,
    openedAt: new Date().toISOString(),
    branchId: currentBranchId,
    branchName: getBranchName(currentBranchId),
    operatorName: operator.name,
    operatorEmail: operator.email,
    openingCash: Math.max(0, Number(openingCash || 0)),
    cashIn: 0,
    cashOut: 0,
    cashMovements: []
  };
  if (!save(STORAGE_KEYS.currentShift, nextShift)) {
    alert("班次尚未开始：本机无法安全保存班次资料，请处理浏览器储存空间后重试。");
    return false;
  }
  currentShift = nextShift;
  return true;
}

function getShiftAllSales(shift) {
  if (!shift) return [];
  const openedAt = new Date(shift.openedAt);
  const closedAt = shift.closedAt ? new Date(shift.closedAt) : new Date();
  return sales.filter((sale) => {
    if (sale.shiftId) return sale.shiftId === shift.id;
    const createdAt = new Date(sale.createdAt);
    return (sale.branchId || "hq") === shift.branchId && createdAt >= openedAt && createdAt <= closedAt;
  });
}

function getShiftSales(shift) {
  return getActiveSales(getShiftAllSales(shift));
}

function getShiftCashMovementTotals(shift) {
  const movements = Array.isArray(shift?.cashMovements) ? shift.cashMovements : [];
  if (!movements.length) {
    return {
      cashIn: Math.max(0, Number(shift?.cashIn || 0)),
      cashOut: Math.max(0, Number(shift?.cashOut || 0))
    };
  }
  return movements.reduce((totals, movement) => {
    const amount = Math.max(0, Number(movement.amount || 0));
    if (movement.type === "out") totals.cashOut += amount;
    else totals.cashIn += amount;
    return totals;
  }, { cashIn: 0, cashOut: 0 });
}

function getShiftSummary(shift) {
  const shiftSales = getShiftSales(shift);
  const allShiftSales = getShiftAllSales(shift);
  const voidedSales = allShiftSales.filter(isSaleVoided);
  const pendingPaymentSales = allShiftSales.filter(isSalePaymentPending);
  const shiftSaleIds = new Set(allShiftSales.map((sale) => sale.id));
  const pendingOrderIds = new Set(
    [...pendingSales, ...pendingSaleUpdates]
      .filter((sale) => shiftSaleIds.has(sale.id))
      .map((sale) => sale.id)
  );
  const normalizedReferences = getNonVoidedSales(allShiftSales)
    .map((sale) => normalizeSaleExternalReferences(sale).externalReferences);
  const payments = getPaymentSummaryRows(shiftSales);
  const cashSales = Number(payments.find((item) => item.method === "现金")?.total || 0);
  const openingCash = Math.max(0, Number(shift.openingCash || 0));
  const { cashIn, cashOut } = getShiftCashMovementTotals(shift);
  return {
    orders: shiftSales.length,
    total: shiftSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    payments,
    cashSales,
    openingCash,
    cashIn,
    cashOut,
    expectedCash: openingCash + cashSales + cashIn - cashOut,
    voidedOrders: voidedSales.length,
    voidedTotal: voidedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    pendingPaymentOrders: pendingPaymentSales.length,
    pendingPaymentTotal: pendingPaymentSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    pendingOrderSync: pendingOrderIds.size,
    pendingSyncTotal: pendingSales.length
      + pendingSaleUpdates.length
      + pendingProducts.length
      + pendingStockAdjustments.length
      + pendingAuditLogs.length
      + getPendingManagementCount(),
    inventoryReviewPending: allShiftSales.filter(requiresInventoryReview).length,
    simplePayPending: normalizedReferences.filter((item) => item.simplePayStatus === "pending").length,
    affiliatePending: normalizedReferences.filter((item) => item.affiliateStatus === "pending").length
  };
}

function closeCurrentShift() {
  if (!currentShift || currentShift.closedAt) {
    alert("当前没有进行中的班次。");
    return;
  }
  if (!canManageCurrentShift()) {
    alert(`当前班次属于 ${getCurrentShiftLabel()}，只有原员工或管理员可以交班。`);
    return;
  }
  openShiftSettlement();
}

function seedLegacyCashMovements(shift) {
  if (!shift || (Array.isArray(shift.cashMovements) && shift.cashMovements.length)) return;
  const movements = [];
  if (Number(shift.cashIn || 0) > 0) {
    movements.push({
      id: `CASH-LEGACY-IN-${shift.id}`,
      type: "in",
      amount: Number(shift.cashIn),
      reason: "旧版现金存入汇总",
      createdAt: shift.openedAt,
      actor: { name: shift.operatorName || "", email: shift.operatorEmail || "" },
      legacy: true
    });
  }
  if (Number(shift.cashOut || 0) > 0) {
    movements.push({
      id: `CASH-LEGACY-OUT-${shift.id}`,
      type: "out",
      amount: Number(shift.cashOut),
      reason: "旧版现金取出汇总",
      createdAt: shift.openedAt,
      actor: { name: shift.operatorName || "", email: shift.operatorEmail || "" },
      legacy: true
    });
  }
  shift.cashMovements = movements;
}

function refreshCurrentShiftCashTotals() {
  if (!currentShift) return;
  const totals = getShiftCashMovementTotals(currentShift);
  currentShift.cashIn = Number(totals.cashIn.toFixed(2));
  currentShift.cashOut = Number(totals.cashOut.toFixed(2));
  saveCurrentShift();
}

function openCashMovementDialog(returnToSettlement = false) {
  if (!requireOperator()) return;
  if (!currentShift || currentShift.closedAt) {
    alert("请先开始班次，再登记现金流水。");
    return;
  }
  if (!canManageCurrentShift()) {
    alert(`当前班次属于 ${getCurrentShiftLabel()}，只有原员工或管理员可以登记现金流水。`);
    return;
  }
  returnToSettlementAfterCashMovement = returnToSettlement;
  if (returnToSettlement) closeShiftSettlementDialog();
  renderCashMovementDialog();
  els.cashMovementDialog.showModal();
}

function closeCashMovementDialog() {
  if (els.cashMovementDialog.open) els.cashMovementDialog.close();
}

function handleCashMovementDialogClosed() {
  const shouldReturn = returnToSettlementAfterCashMovement;
  returnToSettlementAfterCashMovement = false;
  if (shouldReturn && currentShift && !currentShift.closedAt) openShiftSettlement();
}

function renderCashMovementDialog() {
  if (!currentShift) return;
  seedLegacyCashMovements(currentShift);
  refreshCurrentShiftCashTotals();
  els.cashMovementShiftInfo.textContent = `${currentShift.operatorName || "-"} · ${currentShift.branchName || getBranchName(currentShift.branchId)} · ${new Date(currentShift.openedAt).toLocaleString()} 开始`;
  els.cashMovementInTotal.textContent = money(currentShift.cashIn || 0);
  els.cashMovementOutTotal.textContent = money(currentShift.cashOut || 0);
  els.cashMovementList.innerHTML = "";
  const movements = [...(currentShift.cashMovements || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!movements.length) {
    els.cashMovementList.innerHTML = '<div class="empty compact-empty">本班尚无现金存入或取出</div>';
    return;
  }
  const reversedIds = new Set(movements.map((item) => item.reversalOf).filter(Boolean));
  for (const movement of movements) {
    const row = document.createElement("div");
    row.className = "management-row";
    const reversed = reversedIds.has(movement.id);
    row.innerHTML = `
      <div>
        <strong>${movement.type === "out" ? "现金取出" : "现金存入"} · ${money(movement.amount)}</strong>
        <small>${escapeHtml(movement.reason || "-")} · ${new Date(movement.createdAt).toLocaleString()} · ${escapeHtml(movement.actor?.name || "-")}</small>
      </div>
      <button class="ghost danger" type="button" data-reverse-cash ${reversed || movement.reversalOf ? "disabled" : ""}>${reversed ? "已冲正" : (movement.reversalOf ? "冲正记录" : "冲正")}</button>
    `;
    const reverseButton = row.querySelector("[data-reverse-cash]");
    reverseButton.addEventListener("click", () => reverseCashMovement(movement.id));
    els.cashMovementList.append(row);
  }
}

function recordCashMovement(event) {
  event.preventDefault();
  if (cashMovementInProgress) return;
  if (!currentShift || currentShift.closedAt) return;
  if (!canManageCurrentShift()) {
    alert("当前账号无权修改这个班次的现金流水。");
    return;
  }
  const type = els.cashMovementType.value === "out" ? "out" : "in";
  const amount = Number(els.cashMovementAmount.value || 0);
  const reason = els.cashMovementReason.value.trim();
  if (!Number.isFinite(amount) || amount <= 0 || !reason) {
    alert("请填写有效金额和原因。");
    return;
  }
  cashMovementInProgress = true;
  els.cashMovementSubmitBtn.disabled = true;
  els.cashMovementSubmitBtn.textContent = "正在保存...";
  try {
    const nextShift = structuredClone(currentShift);
    seedLegacyCashMovements(nextShift);
    const movement = {
      id: `CASH-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type,
      amount: Number(amount.toFixed(2)),
      reason,
      createdAt: new Date().toISOString(),
      actor: getCurrentActor()
    };
    nextShift.cashMovements.push(movement);
    const totals = getShiftCashMovementTotals(nextShift);
    nextShift.cashIn = Number(totals.cashIn.toFixed(2));
    nextShift.cashOut = Number(totals.cashOut.toFixed(2));
    if (!save(STORAGE_KEYS.currentShift, nextShift)) {
      alert("现金流水尚未保存，原有班次资料没有改变，请处理浏览器储存空间后重试。");
      return;
    }
    currentShift = nextShift;
    writeAuditLog("shift.cash-movement", {
      shiftId: currentShift.id,
      movementId: movement.id,
      type,
      amount: movement.amount,
      reason
    });
    els.cashMovementForm.reset();
    renderCashMovementDialog();
    renderOperatorAccess();
  } finally {
    cashMovementInProgress = false;
    els.cashMovementSubmitBtn.disabled = false;
    els.cashMovementSubmitBtn.textContent = "登记现金流水";
  }
}

function reverseCashMovement(movementId) {
  if (!currentShift || currentShift.closedAt) return;
  if (!canManageCurrentShift()) {
    alert("当前账号无权冲正这个班次的现金流水。");
    return;
  }
  const movements = currentShift.cashMovements || [];
  const movement = movements.find((item) => item.id === movementId);
  if (!movement || movements.some((item) => item.reversalOf === movementId)) return;
  if (!confirm(`确定冲正这笔${movement.type === "out" ? "现金取出" : "现金存入"} ${money(movement.amount)} 吗？`)) return;
  const nextShift = structuredClone(currentShift);
  seedLegacyCashMovements(nextShift);
  const reversal = {
    id: `CASH-REV-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: movement.type === "out" ? "in" : "out",
    amount: Number(movement.amount),
    reason: `冲正 ${movement.id}：${movement.reason || ""}`,
    createdAt: new Date().toISOString(),
    actor: getCurrentActor(),
    reversalOf: movement.id
  };
  nextShift.cashMovements.push(reversal);
  const totals = getShiftCashMovementTotals(nextShift);
  nextShift.cashIn = Number(totals.cashIn.toFixed(2));
  nextShift.cashOut = Number(totals.cashOut.toFixed(2));
  if (!save(STORAGE_KEYS.currentShift, nextShift)) {
    alert("冲正尚未保存，原有现金流水没有改变，请处理浏览器储存空间后重试。");
    return;
  }
  currentShift = nextShift;
  writeAuditLog("shift.cash-movement.reverse", {
    shiftId: currentShift.id,
    movementId,
    reversalId: reversal.id,
    amount: reversal.amount
  });
  renderCashMovementDialog();
}

function updateSettlementDifference() {
  const summary = getShiftSummary(currentShift);
  const openingCash = Math.max(0, Number(els.settlementOpeningCash.value || 0));
  const cashIn = Math.max(0, Number(els.settlementCashIn.value || 0));
  const cashOut = Math.max(0, Number(els.settlementCashOut.value || 0));
  const expectedCash = openingCash + Number(summary.cashSales || 0) + cashIn - cashOut;
  els.settlementExpectedCash.textContent = money(expectedCash);
  const rawValue = els.settlementCountedCash.value;
  if (rawValue === "") {
    els.settlementCashDifference.textContent = "待输入";
    els.settlementCashDifference.parentElement.classList.remove("negative");
    els.settlementCashDifference.parentElement.classList.remove("mismatch");
    return;
  }
  const difference = Number(rawValue || 0) - expectedCash;
  els.settlementCashDifference.textContent = money(difference);
  els.settlementCashDifference.parentElement.classList.toggle("negative", difference < 0);
  els.settlementCashDifference.parentElement.classList.toggle("mismatch", difference !== 0);
}

function openShiftSettlement() {
  if (!currentShift || currentShift.closedAt) return;
  if (!canManageCurrentShift()) {
    alert(`当前班次属于 ${getCurrentShiftLabel()}，只有原员工或管理员可以交班。`);
    return;
  }
  const summary = getShiftSummary(currentShift);
  els.settlementShiftInfo.textContent = `${currentShift.operatorName || "-"} · ${currentShift.branchName || getBranchName(currentShift.branchId)} · ${new Date(currentShift.openedAt).toLocaleString()} 开始`;
  els.settlementOrders.textContent = String(summary.orders);
  els.settlementTotal.textContent = money(summary.total);
  els.settlementVoids.textContent = `${summary.voidedOrders} 单`;
  els.settlementPaymentList.innerHTML = "";
  if (!summary.payments.length) {
    els.settlementPaymentList.innerHTML = '<div class="empty compact-empty">本班暂无有效订单</div>';
  } else {
    for (const payment of summary.payments) {
      const row = document.createElement("div");
      row.className = "management-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(payment.method)}</strong>
          <small>${payment.orders} 单</small>
        </div>
        <span>${money(payment.total)}</span>
      `;
      els.settlementPaymentList.append(row);
    }
  }
  const warnings = [];
  if (!navigator.onLine) warnings.push("当前离线，交班资料会保存在本机并等待同步。");
  if (summary.pendingOrderSync) warnings.push(`本班有 ${summary.pendingOrderSync} 笔订单或更新等待同步。`);
  if (summary.pendingSyncTotal > summary.pendingOrderSync) warnings.push(`本机另有 ${summary.pendingSyncTotal - summary.pendingOrderSync} 项库存或审计资料等待同步。`);
  if (summary.inventoryReviewPending) warnings.push(`${summary.inventoryReviewPending} 笔订单库存待复核。`);
  if (summary.pendingPaymentOrders) warnings.push(`${summary.pendingPaymentOrders} 笔订单等待顾客付款，金额 ${money(summary.pendingPaymentTotal)} 不计入本班收入。`);
  if (summary.simplePayPending) warnings.push(`${summary.simplePayPending} 笔 SimplePay 付款待确认。`);
  if (summary.affiliatePending) warnings.push(`${summary.affiliatePending} 笔联盟订单待关联。`);
  if (summary.voidedOrders) warnings.push(`${summary.voidedOrders} 笔作废订单，原金额 ${money(summary.voidedTotal)}。`);
  els.settlementWarnings.innerHTML = warnings.length
    ? warnings.map((warning) => `<div class="settlement-warning">${escapeHtml(warning)}</div>`).join("")
    : '<div class="helper-text">未发现待同步、待关联或作废提醒。</div>';
  els.settlementOpeningCash.value = Number(currentShift.openingCash || 0).toFixed(2);
  els.settlementCashIn.value = Number(currentShift.cashIn || 0).toFixed(2);
  els.settlementCashOut.value = Number(currentShift.cashOut || 0).toFixed(2);
  els.settlementCountedCash.value = summary.expectedCash === 0 ? "0.00" : "";
  els.settlementCountedCash.placeholder = summary.expectedCash.toFixed(2);
  els.settlementNote.value = "";
  updateSettlementDifference();
  els.shiftSettlementDialog.showModal();
}

function closeShiftSettlementDialog() {
  if (els.shiftSettlementDialog.open) els.shiftSettlementDialog.close();
}

function getSettlementReconciliation(shift = currentShift) {
  const summary = getShiftSummary(shift);
  const openingCash = Math.max(0, Number(els.settlementOpeningCash.value || 0));
  const cashIn = Math.max(0, Number(els.settlementCashIn.value || 0));
  const cashOut = Math.max(0, Number(els.settlementCashOut.value || 0));
  const expectedCash = openingCash + Number(summary.cashSales || 0) + cashIn - cashOut;
  const countedCash = Number(els.settlementCountedCash.value || 0);
  return {
    cashSales: summary.cashSales,
    openingCash,
    cashIn,
    cashOut,
    expectedCash,
    countedCash,
    cashDifference: Number((countedCash - expectedCash).toFixed(2)),
    voidedOrders: summary.voidedOrders,
    voidedTotal: summary.voidedTotal,
    pendingOrderSync: summary.pendingOrderSync,
    pendingSyncTotal: summary.pendingSyncTotal,
    inventoryReviewPending: summary.inventoryReviewPending,
    pendingPaymentOrders: summary.pendingPaymentOrders,
    pendingPaymentTotal: summary.pendingPaymentTotal,
    simplePayPending: summary.simplePayPending,
    affiliatePending: summary.affiliatePending,
    note: els.settlementNote.value.trim(),
    reconciledAt: new Date().toISOString(),
    reconciledBy: getCurrentActor()
  };
}

function confirmShiftSettlement(event) {
  event.preventDefault();
  if (!currentShift || currentShift.closedAt) {
    closeShiftSettlementDialog();
    return;
  }
  if (!canManageCurrentShift()) {
    closeShiftSettlementDialog();
    alert("当前账号无权结束这个班次。");
    return;
  }
  if (els.settlementCountedCash.value === "") {
    alert("请填写现金实点金额。");
    els.settlementCountedCash.focus();
    return;
  }
  const summary = getShiftSummary(currentShift);
  const reconciliation = getSettlementReconciliation(currentShift);
  if (reconciliation.expectedCash < 0) {
    alert("现金取出不能大于备用金、现金销售和现金存入的合计。");
    els.settlementCashOut.focus();
    return;
  }
  if (reconciliation.cashDifference !== 0 && !reconciliation.note) {
    alert("现金有差额时必须填写交班备注。");
    els.settlementNote.focus();
    return;
  }
  const hasWarnings = reconciliation.cashDifference !== 0
    || reconciliation.pendingSyncTotal > 0
    || reconciliation.inventoryReviewPending > 0
    || reconciliation.simplePayPending > 0
    || reconciliation.affiliatePending > 0;
  if (hasWarnings && !confirm("当前结算仍有差额或待处理项目，确定保存并结束班次吗？")) return;
  const closedShift = {
    ...currentShift,
    openingCash: reconciliation.openingCash,
    cashIn: reconciliation.cashIn,
    cashOut: reconciliation.cashOut,
    closedAt: new Date().toISOString(),
    closedBy: getCurrentActor(),
    summary: {
      ...summary,
      openingCash: reconciliation.openingCash,
      cashIn: reconciliation.cashIn,
      cashOut: reconciliation.cashOut,
      expectedCash: reconciliation.expectedCash
    },
    reconciliation
  };
  const nextShifts = [closedShift, ...shifts].slice(0, 100);
  const settlementSaved = saveStorageBatch([
    [STORAGE_KEYS.shifts, nextShifts],
    [STORAGE_KEYS.currentShift, null]
  ]);
  if (!settlementSaved) {
    alert("班次尚未结束：本机无法安全保存交班记录，当前班次保持进行中。");
    return;
  }
  shifts = nextShifts;
  currentShift = null;
  els.shiftOpeningCashInput.value = "0.00";
  closeShiftSettlementDialog();
  writeAuditLog("shift.close", {
    shiftId: closedShift.id,
    orders: summary.orders,
    total: summary.total,
    cashDifference: reconciliation.cashDifference,
    pendingSyncTotal: reconciliation.pendingSyncTotal,
    closedBy: closedShift.closedBy?.email || ""
  });
  alert("班次已结束，交班记录已保存。");
  renderAll();
}

function buildShiftSettlementRows(shift, reconciliation = shift?.reconciliation) {
  const calculatedSummary = getShiftSummary(shift);
  const summary = { ...calculatedSummary, ...(shift?.summary || {}) };
  const rows = [
    ["班次结算"],
    ["班次号", shift?.id || ""],
    ["分行", shift?.branchName || getBranchName(shift?.branchId || "hq")],
    ["操作员", shift?.operatorName || ""],
    ["核对 / 结班人", reconciliation?.reconciledBy?.name || shift?.closedBy?.name || "", reconciliation?.reconciledBy?.email || shift?.closedBy?.email || ""],
    ["开始时间", shift?.openedAt ? new Date(shift.openedAt).toLocaleString() : ""],
    ["结束时间", shift?.closedAt ? new Date(shift.closedAt).toLocaleString() : "尚未结束"],
    ["有效订单", summary.orders || 0],
    ["销售总额", summary.total || 0],
    ["作废订单", summary.voidedOrders || 0],
    ["作废原金额", summary.voidedTotal || 0],
    [],
    ["付款方式", "订单数", "金额"]
  ];
  for (const payment of summary.payments || []) {
    rows.push([payment.method, payment.orders, payment.total]);
  }
  rows.push(
    [],
    ["现金核对"],
    ["开班备用金", reconciliation?.openingCash ?? summary.openingCash ?? 0],
    ["现金销售", reconciliation?.cashSales ?? summary.cashSales ?? 0],
    ["其他现金存入", reconciliation?.cashIn ?? summary.cashIn ?? 0],
    ["现金取出 / 支出", reconciliation?.cashOut ?? summary.cashOut ?? 0],
    ["应有现金", reconciliation?.expectedCash ?? summary.expectedCash ?? 0],
    ["实点现金", reconciliation?.countedCash ?? els.settlementCountedCash.value ?? ""],
    ["现金差额", reconciliation?.cashDifference ?? ""],
    ["交班备注", reconciliation?.note || els.settlementNote.value.trim() || ""]
  );
  const cashMovements = Array.isArray(shift?.cashMovements) ? shift.cashMovements : [];
  rows.push([], ["现金流水", "时间", "金额", "原因", "操作员", "流水号", "冲正原流水"]);
  if (!cashMovements.length) {
    rows.push(["无逐笔现金流水"]);
  } else {
    for (const movement of cashMovements) {
      rows.push([
        movement.type === "out" ? "现金取出" : "现金存入",
        movement.createdAt ? new Date(movement.createdAt).toLocaleString() : "",
        movement.amount || 0,
        movement.reason || "",
        movement.actor?.name || movement.actor?.email || "",
        movement.id || "",
        movement.reversalOf || ""
      ]);
    }
  }
  rows.push(
    [],
    ["风险提醒"],
    ["本班待同步订单", reconciliation?.pendingOrderSync ?? summary.pendingOrderSync ?? 0],
    ["本机全部待同步", reconciliation?.pendingSyncTotal ?? summary.pendingSyncTotal ?? 0],
    ["库存待复核", reconciliation?.inventoryReviewPending ?? summary.inventoryReviewPending ?? 0],
    ["待付款订单", reconciliation?.pendingPaymentOrders ?? summary.pendingPaymentOrders ?? 0],
    ["待付款金额（不计收入）", reconciliation?.pendingPaymentTotal ?? summary.pendingPaymentTotal ?? 0],
    ["SimplePay 待确认", reconciliation?.simplePayPending ?? summary.simplePayPending ?? 0],
    ["联盟待关联", reconciliation?.affiliatePending ?? summary.affiliatePending ?? 0]
  );
  return rows;
}

function exportCurrentShiftSettlement(shift = currentShift) {
  if (!shift) {
    alert("没有可导出的班次。");
    return;
  }
  const calculatedSummary = getShiftSummary(shift);
  const summary = { ...calculatedSummary, ...(shift.summary || {}) };
  let reconciliation = shift.reconciliation;
  if (!reconciliation && shift === currentShift) {
    const hasCountedCash = els.settlementCountedCash.value !== "";
    const countedCash = hasCountedCash ? Number(els.settlementCountedCash.value || 0) : "";
    const openingCash = Math.max(0, Number(els.settlementOpeningCash.value || 0));
    const cashIn = Math.max(0, Number(els.settlementCashIn.value || 0));
    const cashOut = Math.max(0, Number(els.settlementCashOut.value || 0));
    const expectedCash = openingCash + Number(summary.cashSales || 0) + cashIn - cashOut;
    reconciliation = {
      cashSales: summary.cashSales || 0,
      openingCash,
      cashIn,
      cashOut,
      expectedCash,
      countedCash,
      cashDifference: hasCountedCash ? Number((countedCash - expectedCash).toFixed(2)) : "",
      voidedOrders: summary.voidedOrders || 0,
      voidedTotal: summary.voidedTotal || 0,
      pendingOrderSync: summary.pendingOrderSync || 0,
      pendingSyncTotal: summary.pendingSyncTotal || 0,
      inventoryReviewPending: summary.inventoryReviewPending || 0,
      pendingPaymentOrders: summary.pendingPaymentOrders || 0,
      pendingPaymentTotal: summary.pendingPaymentTotal || 0,
      simplePayPending: summary.simplePayPending || 0,
      affiliatePending: summary.affiliatePending || 0,
      note: els.settlementNote.value.trim()
    };
  }
  if (!reconciliation) {
    reconciliation = {
      cashSales: summary.cashSales || 0,
      openingCash: summary.openingCash || 0,
      cashIn: summary.cashIn || 0,
      cashOut: summary.cashOut || 0,
      expectedCash: summary.expectedCash || 0,
      countedCash: "",
      cashDifference: "",
      voidedOrders: summary.voidedOrders || 0,
      voidedTotal: summary.voidedTotal || 0,
      pendingOrderSync: summary.pendingOrderSync || 0,
      pendingSyncTotal: summary.pendingSyncTotal || 0,
      inventoryReviewPending: summary.inventoryReviewPending || 0,
      pendingPaymentOrders: summary.pendingPaymentOrders || 0,
      pendingPaymentTotal: summary.pendingPaymentTotal || 0,
      simplePayPending: summary.simplePayPending || 0,
      affiliatePending: summary.affiliatePending || 0,
      note: "旧版交班记录，未保存现金实点"
    };
  }
  downloadCsv(`shift-settlement-${shift.id}.csv`, buildShiftSettlementRows(shift, reconciliation));
}

function renderOperatorAccess() {
  const operator = getActiveCashier();
  const posOperator = getOperator();
  const allowed = isOperatorAllowedForCurrentBranch();
  const shiftLocked = hasOpenShift() && !isCurrentShiftOwner();
  els.cashierToggleBtn.classList.toggle("hidden", isAdmin());
  els.cashierMenu.classList.toggle("hidden", isAdmin());
  els.operatorStatus.textContent = isAdmin()
    ? "管理模式"
    : shiftLocked
    ? "班次待交接"
    : allowed
    ? `收银：${operator.name}`
    : posOperator
      ? "收银分行不匹配"
      : "POS未登录";
  els.operatorStatus.style.color = allowed && !shiftLocked ? "#0f766e" : "#66756f";
  els.cashierOperatorText.textContent = shiftLocked
    ? getCurrentShiftLabel()
    : allowed
    ? `${operator.name} · ${getBranchName(operator.branchId)}`
    : posOperator
      ? `${posOperator.name} · 分行不匹配`
      : "未登录";
  els.quickCheckoutBtn.textContent = shiftLocked
    ? "先完成交班"
    : allowed
    ? (cart.length ? "结算当前订单" : (currentShift && !currentShift.closedAt ? "继续收银" : "开始收银"))
    : "员工登录";
  els.shiftStatusText.textContent = currentShift && !currentShift.closedAt
    ? `班次：${getCurrentShiftLabel()} · ${new Date(currentShift.openedAt).toLocaleString()} 开始 · 备用金 ${money(currentShift.openingCash || 0)}`
    : "未开班";
  els.shiftOpeningCashPanel.classList.toggle("hidden", Boolean(currentShift && !currentShift.closedAt));
  els.closeShiftBtn.disabled = !canManageCurrentShift();
  els.cashMovementBtn.disabled = !canManageCurrentShift();
  els.operatorLogoutBtn.classList.toggle("hidden", !posOperator);
  els.operatorMessage.classList.toggle("error", shiftLocked || Boolean(posOperator && !allowed));
  if (shiftLocked && isAdmin()) {
    els.operatorMessage.textContent = `当前班次属于 ${getCurrentShiftLabel()}。管理员可查看并完成交班，结班前不能切换分行或开始新销售。`;
  } else if (shiftLocked) {
    els.operatorMessage.textContent = `当前班次属于 ${getCurrentShiftLabel()}。请由原员工重新登录恢复，或请管理员完成交班。`;
  } else if (isAdmin()) {
    els.operatorMessage.textContent = "管理员仅使用设置与全局总览，不参与分行收银和交班。";
  } else if (allowed) {
    els.operatorMessage.textContent = hasOpenShift()
      ? `${operator.name} 已恢复 ${getBranchName(operator.branchId)} 的进行中班次。`
      : `${operator.name} 已授权使用 ${getBranchName(operator.branchId)} POS，分行已锁定。`;
  } else if (posOperator) {
    els.operatorMessage.textContent = `${posOperator.name} 只被授权使用 ${getBranchName(posOperator.branchId)}，系统已锁定该分行。`;
  } else {
    els.operatorMessage.textContent = navigator.onLine
      ? "联网时请使用 Google 登录；离线密码由管理员在「设置 > 授权 POS 用户」设置。"
      : "当前离线：请输入授权邮箱和离线密码。密码由管理员在「设置 > 授权 POS 用户」设置。";
  }
  if (currentCloudUser && lastAuthorizationCheckAt) {
    els.operatorMessage.textContent += ` 云端授权已于 ${new Date(lastAuthorizationCheckAt).toLocaleTimeString()} 核对。`;
  }
}

function requireOperator() {
  if (isOperatorAllowedForCurrentBranch()) return true;
  alert("请先使用当前分行已授权的邮箱登录 POS。");
  els.operatorEmailInput.focus();
  return false;
}

async function loginOperator(event) {
  event.preventDefault();
  if (navigator.onLine) {
    els.operatorMessage.textContent = "联网时请使用 Google 登录验证身份。";
    els.operatorMessage.classList.remove("error");
    await signInWithGoogle();
    return;
  }

  const email = normalizeEmail(els.operatorEmailInput.value);
  const password = els.operatorPasswordInput.value;
  const user = authorizedUsers.find((item) => normalizeEmail(item.email) === email);
  if (!user) {
    els.operatorMessage.textContent = "此邮箱还没有被管理员授权使用 POS。";
    els.operatorMessage.classList.add("error");
    return;
  }
  if (!password || !(await verifyOfflinePassword(user, password))) {
    els.operatorMessage.textContent = user.offlinePasswordHash
      ? "离线密码不正确。"
      : "这个账号还没有设置离线密码，请联网后由管理员重新授权或更新。";
    els.operatorMessage.classList.add("error");
    els.operatorPasswordInput.focus();
    return;
  }
  if (hasOpenShift() && !isShiftIdentity(user.email, user.branchId)) {
    els.operatorMessage.textContent = `当前班次属于 ${getCurrentShiftLabel()}，不能改由其他员工接手。请原员工登录，或请管理员交班。`;
    els.operatorMessage.classList.add("error");
    return;
  }
  operatorEmail = user.email;
  currentBranchId = user.branchId;
  persistSessionEmail(STORAGE_KEYS.operatorEmail, operatorEmail);
  localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
  els.operatorEmailInput.value = "";
  els.operatorPasswordInput.value = "";
  cart = [];
  if (!ensureCurrentShift()) return;
  setAppView("order");
  renderAll();
}

function logoutCloudIfReady() {
  if (hasCloud()) {
    window.cloudPOS.signOutGoogle().catch((error) => console.warn("Cloud sign out failed", error));
  }
}

function isCloudAuthorizationValid(appUser) {
  return Boolean(appUser && appUser.active !== false);
}

function shouldRefreshCloudAuthorization(force = false, now = Date.now()) {
  if (force) return true;
  return !lastAuthorizationCheckAt
    || now - lastAuthorizationCheckAt >= AUTHORIZATION_REFRESH_INTERVAL_MS;
}

function cacheCloudAuthorizedUser(appUser) {
  const email = normalizeEmail(appUser?.email);
  if (!email) return null;
  const existing = authorizedUsers.find((user) => normalizeEmail(user.email) === email);
  const cachedUser = {
    ...(existing || {}),
    ...appUser,
    id: appUser.id || existing?.id || email,
    email,
    active: appUser.active !== false
  };
  authorizedUsers = existing
    ? authorizedUsers.map((user) => normalizeEmail(user.email) === email ? cachedUser : user)
    : [...authorizedUsers, cachedUser];
  save(STORAGE_KEYS.authorizedUsers, authorizedUsers);
  return cachedUser;
}

function lockCloudSession(email, reason, markInactive = false) {
  const normalizedEmail = normalizeEmail(email || currentCloudUser?.email || operatorEmail || adminEmail);
  if (markInactive && normalizedEmail) {
    authorizedUsers = authorizedUsers.map((user) =>
      normalizeEmail(user.email) === normalizedEmail ? { ...user, active: false } : user
    );
    save(STORAGE_KEYS.authorizedUsers, authorizedUsers);
  }
  writeAuditLog("authorization.session-locked", {
    email: normalizedEmail,
    reason,
    openShiftId: hasOpenShift() ? currentShift.id : ""
  });
  adminEmail = "";
  operatorEmail = "";
  currentCloudUser = null;
  cloudSessionActive = false;
  lastAuthorizationCheckAt = 0;
  cart = [];
  clearSessionEmail(STORAGE_KEYS.adminEmail);
  clearSessionEmail(STORAGE_KEYS.operatorEmail);
  updateCloudStatus(reason);
  logoutCloudIfReady();
  renderAll();
  alert(`${reason}${hasOpenShift() ? "\n\n当前班次和销售资料已保留，请由管理员完成交班。" : ""}`);
}

function lockOfflineSessionForOnlineVerification() {
  if (currentCloudUser || (!operatorEmail && !adminEmail)) return false;
  operatorEmail = "";
  adminEmail = "";
  cloudSessionActive = false;
  lastAuthorizationCheckAt = 0;
  cart = [];
  clearSessionEmail(STORAGE_KEYS.operatorEmail);
  clearSessionEmail(STORAGE_KEYS.adminEmail);
  updateCloudStatus("网络已恢复，等待 Google 重新验证");
  renderAll();
  alert(`网络已恢复，请使用 Google 登录重新验证身份。${hasOpenShift() ? "\n\n当前班次已保留，原员工验证后可继续。" : ""}`);
  return true;
}

function applyRefreshedAuthorization(appUser) {
  if (!isCloudAuthorizationValid(appUser)) {
    lockCloudSession(currentCloudUser?.email, "账号已被停用或取消授权，POS 已自动退出。", true);
    return false;
  }
  const cachedUser = cacheCloudAuthorizedUser(appUser);
  if (cachedUser.role !== "admin" && hasOpenShift() && !isShiftIdentity(cachedUser.email, cachedUser.branchId || "hq")) {
    lockCloudSession(cachedUser.email, "员工授权分行已经变更，当前班次已锁定。");
    return false;
  }
  const previousBranchId = currentBranchId;
  currentCloudUser = cachedUser;
  cloudSessionActive = true;
  operatorEmail = cachedUser.email;
  if (cachedUser.role === "admin") {
    adminEmail = cachedUser.email;
    persistSessionEmail(STORAGE_KEYS.adminEmail, adminEmail);
    operatorEmail = "";
    clearSessionEmail(STORAGE_KEYS.operatorEmail);
  } else {
    adminEmail = "";
    clearSessionEmail(STORAGE_KEYS.adminEmail);
    persistSessionEmail(STORAGE_KEYS.operatorEmail, operatorEmail);
    currentBranchId = cachedUser.branchId || "hq";
    localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
    if (currentBranchId !== previousBranchId) cart = [];
  }
  updateCloudStatus(`授权已核对：${cachedUser.email}`, true);
  setAppView(cachedUser.role === "admin" ? "report" : (canAccessView(currentView) ? currentView : "order"));
  renderAll();
  return true;
}

async function refreshCloudAuthorization({ force = false } = {}) {
  if (!navigator.onLine || !hasCloud() || !currentCloudUser || !window.cloudPOS.refreshAuthorization) return true;
  if (authorizationRefreshInFlight || !shouldRefreshCloudAuthorization(force)) return true;
  authorizationRefreshInFlight = true;
  try {
    const result = await window.cloudPOS.refreshAuthorization();
    lastAuthorizationCheckAt = Date.now();
    if (!isCloudAuthorizationValid(result?.appUser)) {
      lockCloudSession(result?.firebaseUser?.email || currentCloudUser?.email, "账号已被停用或取消授权，POS 已自动退出。", true);
      return false;
    }
    return applyRefreshedAuthorization(result.appUser);
  } catch (error) {
    updateCloudStatus(`授权核对暂时失败：${getErrorMessage(error)}`);
    console.warn("Authorization refresh failed", error);
    return true;
  } finally {
    authorizationRefreshInFlight = false;
  }
}

function logoutOperator() {
  if (currentShift && !currentShift.closedAt && !confirm("当前班次尚未结束。退出后班次会保留，只有原员工重新登录或管理员交班后才能继续。确定退出吗？")) return;
  operatorEmail = "";
  clearSessionEmail(STORAGE_KEYS.operatorEmail);
  logoutCloudIfReady();
  cart = [];
  renderAll();
}

async function signInWithGoogle() {
  if (!hasCloud()) {
    alert("Firebase 尚未连接。请确认已联网，并通过 http://localhost 或 HTTPS 打开系统。");
    return;
  }
  try {
    updateCloudStatus("正在打开 Google 登录");
    await window.cloudPOS.signInWithGoogle();
  } catch (error) {
    updateCloudStatus("Google 登录失败");
    alert(`Google 登录失败：${error.message}`);
  }
}

async function syncSaleToCloud(sale) {
  queuePendingSale(sale);
  if (!hasCloud() || !navigator.onLine) {
    return { ok: false, queued: true };
  }
  try {
    let result;
    if (isSaleVoided(sale)) {
      if (!window.cloudPOS.saveVoid) throw new Error("退款事务模块尚未加载");
      result = await window.cloudPOS.saveVoid(sale);
    } else if (window.cloudPOS.saveCheckout) {
      result = await window.cloudPOS.saveCheckout(sale);
    } else {
      await window.cloudPOS.saveSale(sale);
    }
    if (isSaleVoided(sale) && window.cloudPOS.saveVoid) {
      pendingSales = pendingSales.filter((item) => item.id !== sale.id);
      savePendingSales();
      applyVoidSyncResult(sale.id, result);
      return { ok: true, queued: false, inventoryReview: result?.stockStatus === "review-required" };
    }
    const inventoryReview = applyCheckoutSyncResult(sale.id, result);
    if (!inventoryReview) updateCloudStatus("云端已同步", true);
    return { ok: true, queued: false, inventoryReview };
  } catch (error) {
    updateCloudStatus("云端同步失败");
    console.warn("Cloud sync failed", error);
    return { ok: false, queued: true, error };
  }
}

async function syncPendingSales() {
  if (!pendingSales.length || !hasCloud() || !navigator.onLine) {
    updateCloudStatus(hasCloud() ? "云端已连接" : "云端未连接", hasCloud());
    return;
  }

  updateCloudStatus(`正在补传 ${pendingSales.length} 单`);
  for (const sale of [...pendingSales].reverse()) {
    try {
      let result;
      if (isSaleVoided(sale)) {
        if (!window.cloudPOS.saveVoid) throw new Error("退款事务模块尚未加载");
        result = await window.cloudPOS.saveVoid(sale);
      } else if (window.cloudPOS.saveCheckout) {
        result = await window.cloudPOS.saveCheckout(sale);
      } else {
        await window.cloudPOS.saveSale(sale);
      }
      if (isSaleVoided(sale) && window.cloudPOS.saveVoid) {
        pendingSales = pendingSales.filter((item) => item.id !== sale.id);
        savePendingSales();
        applyVoidSyncResult(sale.id, result);
      } else {
        applyCheckoutSyncResult(sale.id, result);
      }
    } catch (error) {
      updateCloudStatus("部分订单待同步");
      console.warn("Pending sale sync failed", error);
      return;
    }
  }
  const reviewCount = sales.filter(requiresInventoryReview).length;
  updateCloudStatus(reviewCount ? `离线订单已同步 · ${reviewCount} 单库存待复核` : "离线订单已同步", true);
}

async function syncPendingSaleUpdates() {
  if (!pendingSaleUpdates.length || !hasCloud() || !navigator.onLine) return;
  updateCloudStatus(`正在补传 ${pendingSaleUpdates.length} 个订单更新`);
  for (const sale of [...pendingSaleUpdates].reverse()) {
    try {
      if (isSaleVoided(sale)) {
        if (!window.cloudPOS.saveVoid) throw new Error("退款事务模块尚未加载");
        const result = await window.cloudPOS.saveVoid(sale);
        applyVoidSyncResult(sale.id, result);
      } else {
        await window.cloudPOS.saveSale(sale);
        markSaleUpdateSynced(sale.id);
      }
    } catch (error) {
      updateCloudStatus("部分订单更新待同步");
      console.warn("Pending sale update sync failed", error);
      return;
    }
  }
  updateCloudStatus("订单更新已同步", true);
}

async function syncProductToCloud(product) {
  if (!hasCloud() || !navigator.onLine) {
    queuePendingProduct(product);
    return false;
  }
  try {
    await window.cloudPOS.saveProduct(product);
    markProductSynced(product.id);
    updateCloudStatus("商品已同步", true);
    return true;
  } catch (error) {
    queuePendingProduct(product);
    updateCloudStatus("商品同步失败");
    console.warn("Product cloud sync failed", error);
    return false;
  }
}

async function syncPendingProducts() {
  if (!pendingProducts.length || !hasCloud() || !navigator.onLine) return;
  updateCloudStatus(`正在补传 ${pendingProducts.length} 个库存`);
  for (const product of [...pendingProducts].reverse()) {
    try {
      await window.cloudPOS.saveProduct(product);
      markProductSynced(product.id);
    } catch (error) {
      updateCloudStatus("部分库存待同步");
      console.warn("Pending product sync failed", error);
      return;
    }
  }
  updateCloudStatus("库存已同步", true);
}

async function syncStockAdjustmentToCloud(adjustment) {
  if (!hasCloud() || !navigator.onLine) {
    queuePendingStockAdjustment(adjustment);
    return false;
  }
  try {
    await window.cloudPOS.saveStockAdjustment(adjustment);
    markStockAdjustmentSynced(adjustment.id);
    updateCloudStatus("库存调整已同步", true);
    return true;
  } catch (error) {
    queuePendingStockAdjustment(adjustment);
    updateCloudStatus("库存调整同步失败");
    console.warn("Stock adjustment sync failed", error);
    return false;
  }
}

async function syncPendingStockAdjustments() {
  if (!pendingStockAdjustments.length || !hasCloud() || !navigator.onLine) return;
  updateCloudStatus(`正在补传 ${pendingStockAdjustments.length} 条库存调整`);
  for (const adjustment of [...pendingStockAdjustments].reverse()) {
    try {
      await window.cloudPOS.saveStockAdjustment(adjustment);
      markStockAdjustmentSynced(adjustment.id);
    } catch (error) {
      updateCloudStatus("部分库存调整待同步");
      console.warn("Pending stock adjustment sync failed", error);
      return;
    }
  }
  updateCloudStatus("库存调整已同步", true);
}

async function syncPendingAuditLogs() {
  if (!pendingAuditLogs.length || !hasCloud() || !navigator.onLine) return;
  updateCloudStatus(`正在补传 ${pendingAuditLogs.length} 条审计记录`);
  for (const log of [...pendingAuditLogs].reverse()) {
    try {
      await window.cloudPOS.saveAuditLog(log);
      markAuditLogSynced(log.id);
    } catch (error) {
      updateCloudStatus("部分审计记录待同步");
      console.warn("Pending audit log sync failed", error);
      return;
    }
  }
  updateCloudStatus("审计记录已同步", true);
}

async function syncManagementToCloud(type, value) {
  queuePendingManagement(type, value);
  if (!hasCloud() || !navigator.onLine || !isCloudAdmin()) return false;
  try {
    if (type === "branch") await window.cloudPOS.saveBranch(value);
    if (type === "user") await window.cloudPOS.saveAuthorizedUser(value);
    if (type === "settings") await window.cloudPOS.saveSettings(value);
    markManagementSynced(type, type === "branch" ? value.id : value.email);
    updateCloudStatus("后台资料已同步", true);
    return true;
  } catch (error) {
    updateCloudStatus("后台资料待同步");
    console.warn(`Management ${type} sync failed`, error);
    return false;
  }
}

async function syncPendingManagementChanges() {
  if (!getPendingManagementCount() || !hasCloud() || !navigator.onLine || !isCloudAdmin()) return;
  updateCloudStatus(`正在补传 ${getPendingManagementCount()} 项后台资料`);
  for (const branch of [...pendingManagement.branches].reverse()) {
    try {
      await window.cloudPOS.saveBranch(branch);
      markManagementSynced("branch", branch.id);
    } catch (error) {
      console.warn("Pending branch sync failed", error);
      updateCloudStatus("部分后台资料待同步");
      return;
    }
  }
  for (const user of [...pendingManagement.users].reverse()) {
    try {
      await window.cloudPOS.saveAuthorizedUser(user);
      markManagementSynced("user", user.email);
    } catch (error) {
      console.warn("Pending user sync failed", error);
      updateCloudStatus("部分后台资料待同步");
      return;
    }
  }
  if (pendingManagement.settings) {
    try {
      await window.cloudPOS.saveSettings(pendingManagement.settings);
      markManagementSynced("settings");
    } catch (error) {
      console.warn("Pending settings sync failed", error);
      updateCloudStatus("部分后台资料待同步");
      return;
    }
  }
  updateCloudStatus("后台资料已同步", true);
}

async function syncPendingChanges() {
  if (pendingSyncPromise) return pendingSyncPromise;
  pendingSyncPromise = (async () => {
    await syncPendingManagementChanges();
    await syncPendingProducts();
    await syncPendingStockAdjustments();
    await syncPendingAuditLogs();
    await syncPendingSales();
    await syncPendingSaleUpdates();
  })();
  try {
    return await pendingSyncPromise;
  } finally {
    pendingSyncPromise = null;
  }
}

async function initializeCloudData() {
  if (!requireAdmin()) return;
  if (!requireCloudAdmin()) return;
  if (!hasCloud()) {
    alert("云端还没连接。请先用 Google 管理员登录。");
    return;
  }

  try {
    updateCloudStatus("正在初始化云端");
    for (const branch of branches) {
      await window.cloudPOS.saveBranch(branch);
    }
    for (const user of authorizedUsers) {
      await window.cloudPOS.saveAuthorizedUser(user);
    }
    for (const product of products) {
      await window.cloudPOS.saveProduct(product);
    }
    await window.cloudPOS.saveSettings(appSettings);
    await writeAuditLog("cloud.initialize", {
      branches: branches.length,
      users: authorizedUsers.length,
      products: products.length
    });
    pendingManagement = normalizePendingManagement();
    savePendingManagement();
    updateCloudStatus("云端初始化完成", true);
    alert("云端数据初始化完成。");
  } catch (error) {
    updateCloudStatus("云端初始化失败");
    alert(`云端初始化失败：${error.message}`);
  }
}

function normalizeCloudSales(cloudSales) {
  return cloudSales
    .map((sale) => normalizeSaleExternalReferences({
      ...sale,
      createdAt: sale.createdAt?.toDate ? sale.createdAt.toDate().toISOString() : sale.createdAt
    }))
    .filter((sale) => sale.id && sale.createdAt);
}

function normalizeCloudTimelineItems(items) {
  return items
    .map((item) => ({
      ...item,
      createdAt: item.createdAt?.toDate ? item.createdAt.toDate().toISOString() : item.createdAt
    }))
    .filter((item) => item.id && item.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function mergeCloudBranchesWithPending(cloudBranches) {
  const pendingById = new Map(pendingManagement.branches.map((branch) => [branch.id, branch]));
  const merged = cloudBranches.map((branch) => pendingById.get(branch.id) || branch);
  for (const branch of pendingManagement.branches) {
    if (!merged.some((item) => item.id === branch.id)) merged.push(branch);
  }
  return merged;
}

function mergeCloudUsersWithPending(cloudUsers) {
  const pendingByEmail = new Map(
    pendingManagement.users.map((user) => [normalizeEmail(user.email), user])
  );
  const merged = cloudUsers
    .filter((user) => user.active !== false || pendingByEmail.has(normalizeEmail(user.email)))
    .map((user) => pendingByEmail.get(normalizeEmail(user.email)) || user);
  for (const user of pendingManagement.users) {
    if (!merged.some((item) => normalizeEmail(item.email) === normalizeEmail(user.email))) merged.push(user);
  }
  return merged;
}

function mergeCloudProductsWithPending(cloudProducts) {
  const localById = new Map(products.map((product) => [product.id, product]));
  const pendingProductById = new Map(pendingProducts.map((product) => [product.id, product]));
  const protectedBranchesByProduct = new Map();
  for (const sale of pendingSales) {
    for (const item of sale.items || []) {
      const branchIds = protectedBranchesByProduct.get(item.id) || new Set();
      branchIds.add(sale.branchId || "hq");
      protectedBranchesByProduct.set(item.id, branchIds);
    }
  }
  const merged = cloudProducts.map((cloudProduct) => {
    if (pendingProductById.has(cloudProduct.id)) return pendingProductById.get(cloudProduct.id);
    const localProduct = localById.get(cloudProduct.id);
    const protectedBranches = protectedBranchesByProduct.get(cloudProduct.id);
    if (!localProduct || !protectedBranches?.size) return cloudProduct;
    let mergedProduct = normalizeProductBranches(cloudProduct);
    for (const branchId of protectedBranches) {
      mergedProduct = setBranchStock(mergedProduct, branchId, getBranchStock(localProduct, branchId));
    }
    return mergedProduct;
  });
  for (const pendingProduct of pendingProducts) {
    if (!merged.some((product) => product.id === pendingProduct.id)) merged.push(pendingProduct);
  }
  return merged;
}

async function loadCloudDataOnce() {
  if (!hasCloud() || !navigator.onLine) return false;
  try {
    updateCloudStatus("正在读取云端资料");
    const data = await window.cloudPOS.loadUserData(getActiveCashier());
    try {
      const cloudSettings = await window.cloudPOS.loadSettings();
      if (cloudSettings && !pendingManagement.settings) {
        appSettings = { ...appSettings, ...cloudSettings };
        save(STORAGE_KEYS.settings, appSettings);
      }
    } catch (settingsError) {
      console.warn("Cloud settings load skipped", settingsError);
    }
    if (data.branches.length) {
      branches = mergeCloudBranchesWithPending(
        data.branches.filter((branch) => branch.active !== false)
      );
      save(STORAGE_KEYS.branches, branches);
    }
    if (data.users.length) {
      authorizedUsers = mergeCloudUsersWithPending(data.users);
      save(STORAGE_KEYS.authorizedUsers, authorizedUsers);
    }
    if (data.products.length) {
      const legacyCloudProducts = data.products.filter(isLegacyDemoProduct);
      products = mergeCloudProductsWithPending(
        data.products.filter((product) => product.active !== false && !isLegacyDemoProduct(product))
      );
      save(STORAGE_KEYS.products, products);
      if (legacyCloudProducts.length && isCloudAdmin() && window.cloudPOS.deleteProduct) {
        await Promise.all(
          legacyCloudProducts.map((product) => window.cloudPOS.deleteProduct(product.id))
        );
        writeAuditLog("products.legacy-demo.delete", {
          productIds: legacyCloudProducts.map((product) => product.id),
          barcodes: legacyCloudProducts.map((product) => product.barcode)
        });
      }
    }
    if (data.sales.length) {
      const cloudSales = normalizeCloudSales(data.sales);
      const pendingById = new Map(
        [...pendingSales, ...pendingSaleUpdates].map((sale) => [sale.id, normalizeSaleExternalReferences(sale)])
      );
      const cloudWithLocalPending = cloudSales.map((sale) => pendingById.get(sale.id) || sale);
      const mergedSales = [
        ...cloudWithLocalPending,
        ...sales.filter((sale) => !cloudSales.some((item) => item.id === sale.id))
      ];
      sales = mergedSales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      save(STORAGE_KEYS.sales, sales);
    }
    if ((data.stockAdjustments || []).length) {
      const cloudAdjustments = normalizeCloudTimelineItems(data.stockAdjustments || []);
      stockAdjustments = [...cloudAdjustments, ...stockAdjustments.filter((item) => !cloudAdjustments.some((cloudItem) => cloudItem.id === item.id))].slice(0, 500);
      save(STORAGE_KEYS.stockAdjustments, stockAdjustments);
    }
    if ((data.auditLogs || []).length) {
      const cloudAuditLogs = normalizeCloudTimelineItems(data.auditLogs || []);
      auditLogs = [...cloudAuditLogs, ...auditLogs.filter((item) => !cloudAuditLogs.some((cloudItem) => cloudItem.id === item.id))].slice(0, 500);
      save(STORAGE_KEYS.auditLogs, auditLogs);
    }
    migrateManagementData();
    migrateProductsForBranches();
    updateCloudStatus("云端资料已更新", true);
    renderAll();
    return true;
  } catch (error) {
    updateCloudStatus(`读取云端失败：${getErrorMessage(error)}`);
    console.warn("Cloud data load failed", error);
    return false;
  }
}

async function loadCloudData() {
  if (cloudDataLoadPromise) return cloudDataLoadPromise;
  cloudDataLoadPromise = loadCloudDataOnce();
  try {
    return await cloudDataLoadPromise;
  } finally {
    cloudDataLoadPromise = null;
  }
}

async function syncThenLoadCloudData() {
  await syncPendingChanges();
  return loadCloudData();
}

async function saveSettings(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const serviceDays = Number(els.serviceDaysInput.value);
  const lowStockThreshold = Number(els.lowStockThresholdInput.value);
  const nextSettings = {
    businessName: els.businessNameInput.value.trim(),
    defaultServiceName: els.defaultServiceNameInput.value.trim(),
    serviceDays,
    lowStockThreshold,
    receiptFooter: els.receiptFooterInput.value.trim()
  };
  if (
    !nextSettings.businessName
    || !nextSettings.defaultServiceName
    || !Number.isInteger(serviceDays)
    || serviceDays < 1
    || !Number.isInteger(lowStockThreshold)
    || lowStockThreshold < 0
  ) {
    alert("请检查业务名称、服务名称、服务天数和低库存阈值。天数与阈值必须是有效整数。");
    return;
  }
  if (!save(STORAGE_KEYS.settings, nextSettings)) return;
  appSettings = nextSettings;
  syncManagementToCloud("settings", appSettings);
  writeAuditLog("settings.update", { settings: appSettings });
  renderAll();
}

async function applyCloudUser(appUser, firebaseUser = null) {
  if (!isCloudAuthorizationValid(appUser)) {
    lockCloudSession(firebaseUser?.email, "此 Google 邮箱未获授权或已被停用，POS 已自动退出。", true);
    return;
  }

  lastAuthorizationCheckAt = Date.now();
  appUser = cacheCloudAuthorizedUser(appUser);
  const previousBranchId = currentBranchId;
  const targetBranchId = appUser.role === "admin" ? currentBranchId : (appUser.branchId || "hq");
  if (appUser.role !== "admin" && hasOpenShift() && !isShiftIdentity(appUser.email, targetBranchId)) {
    lockCloudSession(appUser.email, `当前班次属于 ${getCurrentShiftLabel()}，不能改由其他员工接手。`);
    return;
  }

  cloudSessionActive = true;
  currentCloudUser = appUser;

  if (appUser.role === "admin") {
    adminEmail = normalizeEmail(appUser.email);
    ensureAdminAuthorized(adminEmail);
    persistSessionEmail(STORAGE_KEYS.adminEmail, adminEmail);
    operatorEmail = "";
    clearSessionEmail(STORAGE_KEYS.operatorEmail);
    currentBranchId = branches.some((branch) => branch.id === currentBranchId) ? currentBranchId : "hq";
  } else {
    adminEmail = "";
    clearSessionEmail(STORAGE_KEYS.adminEmail);
    operatorEmail = appUser.email;
    persistSessionEmail(STORAGE_KEYS.operatorEmail, operatorEmail);
    currentBranchId = appUser.branchId || "hq";
    if (currentBranchId !== previousBranchId) cart = [];
  }

  localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
  if (appUser.role !== "admin" && (!hasOpenShift() || isShiftIdentity(appUser.email, currentBranchId))) ensureCurrentShift();
  updateCloudStatus(`云端已登录：${appUser.email}`, true);
  setAppView(appUser.role === "admin" ? "report" : "order");
  renderAll();
  const sessionEmail = normalizeEmail(appUser.email);
  await syncPendingChanges();
  if (normalizeEmail(currentCloudUser?.email) === sessionEmail) await loadCloudData();
}

function requireAdmin() {
  if (isAdmin()) return true;
  alert("只有唯一管理员可以操作后台。请先输入管理员邮箱。");
  els.adminEmailInput.focus();
  return false;
}

function requireOperations() {
  if (canUseOperations()) return true;
  alert("请先使用授权员工账号登录。");
  els.operatorEmailInput.focus();
  return false;
}

function isCloudAdmin() {
  return currentCloudUser && currentCloudUser.role === "admin";
}

function requireCloudAdmin() {
  if (isCloudAdmin()) return true;
  alert("这个操作需要 Google 管理员登录。请点击 Google 管理员登录。");
  return false;
}

async function loginAdmin(event) {
  event.preventDefault();
  if (navigator.onLine) {
    els.adminLoginMessage.textContent = "联网时后台必须使用 Google 管理员登录。";
    els.adminLoginMessage.classList.remove("error");
    await signInWithGoogle();
    return;
  }
  const email = normalizeEmail(els.adminEmailInput.value);
  const password = els.adminPasswordInput.value;
  if (!(await isConfiguredAdminEmail(email))) {
    els.adminLoginMessage.textContent = "邮箱不匹配，无法进入后台。";
    els.adminLoginMessage.classList.add("error");
    return;
  }
  const adminUser = authorizedUsers.find((user) =>
    normalizeEmail(user.email) === email
    && user.active !== false
    && (user.role === "admin" || user.role === "管理员")
  );
  if (!adminUser?.offlinePasswordHash) {
    els.adminLoginMessage.textContent = "管理员尚未设置离线密码，请联网后使用 Google 管理员登录设置。";
    els.adminLoginMessage.classList.add("error");
    return;
  }
  if (!(await verifyOfflinePassword(adminUser, password))) {
    els.adminLoginMessage.textContent = "管理员离线密码不正确。";
    els.adminLoginMessage.classList.add("error");
    els.adminPasswordInput.focus();
    return;
  }
  adminEmail = adminUser.email;
  persistSessionEmail(STORAGE_KEYS.adminEmail, adminEmail);
  operatorEmail = "";
  clearSessionEmail(STORAGE_KEYS.operatorEmail);
  els.adminEmailInput.value = "";
  els.adminPasswordInput.value = "";
  els.adminLoginMessage.textContent = "管理员离线身份已验证。";
  els.adminLoginMessage.classList.remove("error");
  setAppView("report");
  renderAll();
}

function logoutAdmin() {
  const previousAdminEmail = normalizeEmail(adminEmail);
  adminEmail = "";
  clearSessionEmail(STORAGE_KEYS.adminEmail);
  if (previousAdminEmail && normalizeEmail(operatorEmail) === previousAdminEmail) {
    operatorEmail = "";
    clearSessionEmail(STORAGE_KEYS.operatorEmail);
  }
  els.adminLoginMessage.textContent = "管理员仅负责设置与全局总览；分行业务由授权员工处理。";
  els.adminLoginMessage.classList.remove("error");
  logoutCloudIfReady();
  renderAll();
}

function createSlug(value) {
  return normalizeEmail(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || `branch-${Date.now()}`;
}

function renderManagementLists() {
  if (!isAdmin()) return;
  els.userBranchSelect.innerHTML = "";
  for (const branch of branches) {
    const option = document.createElement("option");
    option.value = branch.id;
    option.textContent = branch.name;
    els.userBranchSelect.append(option);
  }

  els.branchList.innerHTML = "";
  for (const branch of branches) {
    const row = document.createElement("div");
    row.className = "management-row branch-management-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(branch.name)}</strong>
        <small>${escapeHtml(branch.id)} · ${authorizedUsers.filter((user) => user.branchId === branch.id).length} 位授权用户</small>
      </div>
      <div class="row-actions branch-merchant-actions">
        <input type="text" value="${escapeHtml(branch.simplePayMerchantId || "")}" placeholder="SimplePay 商家 ID" aria-label="${escapeHtml(branch.name)} SimplePay 商家 ID">
        <button class="ghost" type="button">保存对应商家</button>
      </div>
    `;
    const merchantInput = row.querySelector("input");
    row.querySelector("button").addEventListener("click", () => {
      updateBranchSimplePayMerchant(branch.id, merchantInput.value);
    });
    els.branchList.append(row);
  }

  els.userList.innerHTML = "";
  for (const user of authorizedUsers.filter((item) => item.active !== false)) {
    const row = document.createElement("div");
    row.className = "management-row";
    const offlineText = user.offlinePasswordHash ? "已设离线密码" : "未设离线密码";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${escapeHtml(user.email)} · ${escapeHtml(getBranchName(user.branchId))} · ${escapeHtml(user.role || "POS用户")} · ${offlineText}</small>
      </div>
      <button class="ghost danger" type="button" ${user.role === "管理员" || user.role === "admin" ? "disabled" : ""}>移除</button>
    `;
    const button = row.querySelector("button");
    button.addEventListener("click", () => removeAuthorizedUser(user.id));
    els.userList.append(row);
  }

  els.syncOverview.innerHTML = "";
  const syncRow = document.createElement("div");
  syncRow.className = "management-row";
  syncRow.innerHTML = `
    <div>
      <strong>${pendingSales.length} 单订单、${pendingSaleUpdates.length} 个订单更新、${pendingProducts.length} 个库存、${pendingStockAdjustments.length} 条调整、${pendingAuditLogs.length} 条审计、${getPendingManagementCount()} 项后台资料待同步</strong>
      <small>${pendingSales.length || pendingSaleUpdates.length || pendingProducts.length || pendingStockAdjustments.length || pendingAuditLogs.length || getPendingManagementCount() ? "恢复网络并完成对应权限登录后会自动补传，也可以手动补传。" : "所有本机变更已处理。"}</small>
    </div>
  `;
  els.syncOverview.append(syncRow);

  els.shiftList.innerHTML = "";
  if (!shifts.length) {
    els.shiftList.innerHTML = '<div class="empty">暂无交班记录</div>';
  } else {
    for (const shift of shifts.slice(0, 10)) {
      const row = document.createElement("div");
      row.className = "management-row";
      const cashDifference = shift.reconciliation?.cashDifference;
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(shift.operatorName || "-")} · ${escapeHtml(shift.branchName || "-")}</strong>
          <small>${new Date(shift.openedAt).toLocaleString()} 至 ${shift.closedAt ? new Date(shift.closedAt).toLocaleString() : "-"}</small>
        </div>
        <div class="row-actions">
          <small>${shift.summary?.orders || 0} 单 · ${money(shift.summary?.total || 0)}${cashDifference === undefined ? "" : ` · 现金差额 ${money(cashDifference)}`}</small>
          <button class="ghost" type="button" data-export-shift>导出结算</button>
        </div>
      `;
      row.querySelector("[data-export-shift]").addEventListener("click", () => exportCurrentShiftSettlement(shift));
      els.shiftList.append(row);
    }
  }

  els.auditList.innerHTML = "";
  const auditRows = [...auditLogs].slice(0, 10);
  if (!auditRows.length) {
    els.auditList.innerHTML = '<div class="empty">暂无审计记录</div>';
  } else {
    for (const log of auditRows) {
      const row = document.createElement("div");
      row.className = "management-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(log.action)}</strong>
          <small>${new Date(log.createdAt).toLocaleString()} · ${escapeHtml(log.actor?.email || "-")}</small>
        </div>
        <small>${escapeHtml(log.branchName || "-")}</small>
      `;
      els.auditList.append(row);
    }
  }

  els.stockAdjustmentList.innerHTML = "";
  const stockRows = [...stockAdjustments].slice(0, 10);
  if (!stockRows.length) {
    els.stockAdjustmentList.innerHTML = '<div class="empty">暂无库存流水</div>';
  } else {
    for (const adjustment of stockRows) {
      const row = document.createElement("div");
      row.className = "management-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(adjustment.productName || "-")}</strong>
          <small>${new Date(adjustment.createdAt).toLocaleString()} · ${escapeHtml(adjustment.branchName || getBranchName(adjustment.branchId || "hq"))}</small>
        </div>
        <small>${Number(adjustment.beforeStock || 0)} → ${Number(adjustment.afterStock || 0)} (${Number(adjustment.delta || 0) >= 0 ? "+" : ""}${Number(adjustment.delta || 0)})</small>
      `;
      els.stockAdjustmentList.append(row);
    }
  }
}

function renderStockAdjustmentList() {
  if (!canUseOperations()) return;
  els.stockAdjustmentList.innerHTML = "";
  const stockRows = stockAdjustments
    .filter((adjustment) => canManageBranch(adjustment.branchId || "hq"))
    .slice(0, 10);
  if (!stockRows.length) {
    els.stockAdjustmentList.innerHTML = '<div class="empty">暂无库存流水</div>';
    return;
  }
  for (const adjustment of stockRows) {
    const row = document.createElement("div");
    row.className = "management-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(adjustment.productName || "-")}</strong>
        <small>${new Date(adjustment.createdAt).toLocaleString()} · ${escapeHtml(adjustment.branchName || getBranchName(adjustment.branchId || "hq"))}</small>
      </div>
      <small>${Number(adjustment.beforeStock || 0)} → ${Number(adjustment.afterStock || 0)} (${Number(adjustment.delta || 0) >= 0 ? "+" : ""}${Number(adjustment.delta || 0)})</small>
    `;
    els.stockAdjustmentList.append(row);
  }
}

function addBranch(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const name = els.branchNameInput.value.trim();
  const simplePayMerchantId = els.branchSimplePayMerchantIdInput.value.trim();
  if (!name) {
    alert("请填写分行名称。");
    els.branchNameInput.focus();
    return;
  }
  const id = createSlug(name);
  if (branches.some((branch) => branch.id === id || branch.name === name)) {
    alert("这个分行已经存在。");
    return;
  }
  const branch = { id, name, simplePayMerchantId };
  const nextBranches = [...branches, branch];
  const nextProducts = products.map((product) => setBranchStock(product, id, 0));
  if (!saveStorageBatch([
    [STORAGE_KEYS.branches, nextBranches],
    [STORAGE_KEYS.products, nextProducts]
  ])) return;
  branches = nextBranches;
  products = nextProducts;
  syncManagementToCloud("branch", branch);
  writeAuditLog("branch.create", { id, name, simplePayMerchantId });
  els.branchForm.reset();
  renderAll();
}

function updateBranchSimplePayMerchant(branchId, value) {
  if (!requireAdmin()) return;
  const simplePayMerchantId = String(value || "").trim();
  const branch = branches.find((item) => item.id === branchId);
  if (!branch) return;
  const updatedBranch = { ...branch, simplePayMerchantId };
  const nextBranches = branches.map((item) => item.id === branchId ? updatedBranch : item);
  if (!save(STORAGE_KEYS.branches, nextBranches)) return;
  branches = nextBranches;
  syncManagementToCloud("branch", updatedBranch);
  writeAuditLog("branch.simplepay-merchant.update", {
    branchId,
    configured: Boolean(simplePayMerchantId)
  });
  renderAll();
}

async function addAuthorizedUser(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const email = normalizeEmail(els.userEmailInput.value);
  const offlinePassword = els.userPasswordInput.value;
  const name = els.userNameInput.value.trim();
  const branchId = els.userBranchSelect.value;
  if (!name || !email || !branches.some((branch) => branch.id === branchId)) {
    alert("请填写有效员工姓名、邮箱并选择存在的分行。");
    return;
  }
  if (offlinePassword.length < 8) {
    alert("员工离线密码至少需要 8 位。");
    els.userPasswordInput.focus();
    return;
  }
  const offlinePasswordSalt = createPasswordSalt();
  const existingUser = authorizedUsers.find((user) => normalizeEmail(user.email) === email);
  if (existingUser && (existingUser.role === "管理员" || existingUser.role === "admin")) {
    alert("管理员账号不能在这里更新。");
    return;
  }
  const user = {
    id: existingUser?.id || createId(),
    name,
    email,
    branchId,
    role: "POS用户",
    active: true,
    offlinePasswordAlgorithm: "PBKDF2-SHA256",
    offlinePasswordIterations: OFFLINE_PASSWORD_ITERATIONS,
    offlinePasswordSalt,
    offlinePasswordHash: await hashOfflinePassword(email, offlinePassword, offlinePasswordSalt)
  };
  const nextUsers = existingUser
    ? authorizedUsers.map((item) => normalizeEmail(item.email) === email ? user : item)
    : [...authorizedUsers, user];
  if (!save(STORAGE_KEYS.authorizedUsers, nextUsers)) return;
  authorizedUsers = nextUsers;
  syncManagementToCloud("user", user);
  writeAuditLog(existingUser ? "user.update" : "user.authorize", { email: user.email, name: user.name, branchId: user.branchId });
  els.userForm.reset();
  renderAll();
}

function removeAuthorizedUser(userId) {
  if (!requireAdmin()) return;
  const removedUser = authorizedUsers.find((user) => user.id === userId);
  const nextUsers = authorizedUsers.map((user) => {
    if (user.id !== userId || user.role === "管理员" || user.role === "admin") return user;
    return { ...user, active: false };
  });
  if (!save(STORAGE_KEYS.authorizedUsers, nextUsers)) return;
  authorizedUsers = nextUsers;
  if (!getOperator()) logoutOperator();
  if (removedUser && removedUser.role !== "管理员" && removedUser.role !== "admin") {
    syncManagementToCloud("user", { ...removedUser, active: false });
    writeAuditLog("user.remove", { email: removedUser.email, name: removedUser.name, branchId: removedUser.branchId });
  }
  renderAll();
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createPosOrderId(branchId = currentBranchId) {
  const branchToken = String(branchId || "hq")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase() || "HQ";
  const randomToken = window.crypto?.getRandomValues
    ? Array.from(window.crypto.getRandomValues(new Uint8Array(3)), (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()
    : Math.random().toString(16).slice(2, 8).toUpperCase();
  return `POS-${branchToken}-${Date.now()}-${randomToken}`;
}

function money(value) {
  return `RM ${Number(value || 0).toFixed(2)}`;
}

function formatDate(date) {
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function inputDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStartDate(date = new Date()) {
  return inputDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEndDate(date = new Date()) {
  return inputDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function setReportRange(startDate, endDate) {
  els.reportStartInput.value = startDate || "";
  els.reportEndInput.value = endDate || "";
  renderGlobalDashboard();
}

function ensureReportRange() {
  if (reportRangeInitialized) return;
  reportRangeInitialized = true;
  setReportRange(monthStartDate(), monthEndDate());
}

function getReportSales() {
  const startDate = els.reportStartInput.value;
  const endDate = els.reportEndInput.value;
  return getActiveSales().filter((sale) => {
    if (!canManageBranch(sale.branchId || "hq")) return false;
    const saleDate = inputDate(new Date(sale.createdAt));
    if (startDate && saleDate < startDate) return false;
    if (endDate && saleDate > endDate) return false;
    return true;
  });
}

function getAccessibleBranches() {
  if (isAdmin()) return branches;
  const branchId = getOperationalBranchId();
  return branches.filter((branch) => branch.id === branchId);
}

function getReportStock() {
  if (isAdmin()) return getTotalStock();
  const branchId = getOperationalBranchId();
  return products.reduce((total, product) => total + getBranchStock(product, branchId), 0);
}

function getReportRangeLabel() {
  const startDate = els.reportStartInput.value;
  const endDate = els.reportEndInput.value;
  if (!startDate && !endDate) return "全部";
  if (startDate && endDate) return `${startDate} 至 ${endDate}`;
  if (startDate) return `${startDate} 起`;
  return `${endDate} 前`;
}

function getProductSalesRows(reportSales = getReportSales()) {
  const productMap = new Map();
  for (const sale of reportSales) {
    for (const item of sale.items || []) {
      const key = item.id || item.name;
      const existing = productMap.get(key) || {
        name: item.name,
        qty: 0,
        revenue: 0
      };
      existing.qty += Number(item.qty || 0);
      existing.revenue += Number(item.price || 0) * Number(item.qty || 0);
      productMap.set(key, existing);
    }
  }
  return [...productMap.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty);
}

function getDailySalesRows(reportSales = getReportSales()) {
  const dayMap = new Map();
  for (const sale of reportSales) {
    const day = inputDate(new Date(sale.createdAt));
    const existing = dayMap.get(day) || { day, orders: 0, revenue: 0 };
    existing.orders += 1;
    existing.revenue += Number(sale.total || 0);
    dayMap.set(day, existing);
  }
  return [...dayMap.values()].sort((a, b) => b.day.localeCompare(a.day));
}

function getPaymentSummaryRows(reportSales = getReportSales()) {
  const paymentMap = new Map();
  for (const sale of reportSales) {
    const method = sale.payment?.method || "现金";
    const existing = paymentMap.get(method) || { method, orders: 0, total: 0 };
    existing.orders += 1;
    existing.total += Number(sale.total || 0);
    paymentMap.set(method, existing);
  }
  return [...paymentMap.values()].sort((a, b) => b.total - a.total);
}

function renderAll() {
  els.versionStatus.textContent = APP_VERSION;
  if (!paymentMethodInitialized) {
    els.paymentMethodInput.value = preferredPaymentMethod;
    paymentMethodInitialized = true;
  }
  renderBranchSelect();
  renderInventoryBranchFilter();
  renderSalesBranchFilter();
  renderCategoryFilter();
  renderProducts();
  renderCart();
  renderSales();
  renderSettingsForm();
  renderPrinterSettings();
  renderFollowUps();
  renderLowStock();
  renderMenuProductList();
  renderInventoryOverview();
  renderGlobalDashboard();
  renderManagementLists();
  renderIntegrationOverview();
  renderStockAdjustmentList();
  renderAdminAccess();
  renderOperatorAccess();
  updateNetworkStatus();
}

function renderInventoryBranchFilter() {
  if (!els.inventoryBranchFilter) return;
  const selectedBranchId = isAdmin()
    ? (resolveBranchId(els.inventoryBranchFilter.value) || currentBranchId || "hq")
    : (getOperator()?.branchId || currentBranchId || "hq");
  els.inventoryBranchFilter.innerHTML = "";
  for (const branch of branches) {
    const option = document.createElement("option");
    option.value = branch.id;
    option.textContent = branch.name;
    els.inventoryBranchFilter.append(option);
  }
  els.inventoryBranchFilter.value = branches.some((branch) => branch.id === selectedBranchId)
    ? selectedBranchId
    : (branches[0]?.id || "hq");
  els.inventoryBranchFilter.disabled = !isAdmin();
  els.inventoryBranchFilter.title = isAdmin() ? "管理员可查看所有分行库存" : "员工只能处理授权分行库存";
}

function renderSalesBranchFilter() {
  if (!els.salesBranchFilter) return;
  const operatorBranchId = getOperator()?.branchId || currentBranchId || "hq";
  const previousValue = els.salesBranchFilter.value;
  els.salesBranchFilter.innerHTML = "";
  if (isAdmin()) {
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "全部分行";
    els.salesBranchFilter.append(allOption);
    for (const branch of branches) {
      const option = document.createElement("option");
      option.value = branch.id;
      option.textContent = branch.name;
      els.salesBranchFilter.append(option);
    }
    els.salesBranchFilter.value = previousValue === "all" || branches.some((branch) => branch.id === previousValue)
      ? previousValue
      : "all";
    els.salesBranchFilter.disabled = false;
    return;
  }
  const option = document.createElement("option");
  option.value = operatorBranchId;
  option.textContent = getBranchName(operatorBranchId);
  els.salesBranchFilter.append(option);
  els.salesBranchFilter.value = operatorBranchId;
  els.salesBranchFilter.disabled = true;
}

function renderMenuProductList() {
  if (!isAdmin() && !canUseOperations()) return;
  els.menuProductList.innerHTML = "";
  const keyword = els.menuSearchInput.value.trim().toLowerCase();
  const filteredProducts = products.filter((product) => {
    if (!keyword) return true;
    return [product.name, product.barcode, product.category]
      .some((value) => String(value || "").toLowerCase().includes(keyword));
  });
  if (!filteredProducts.length) {
    els.menuProductList.innerHTML = '<div class="empty">暂无菜单商品</div>';
    return;
  }
  for (const product of filteredProducts.slice(0, 50)) {
    const row = document.createElement("div");
    row.className = "management-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(product.category || "-")} · SKU ${escapeHtml(product.barcode || "-")}</small>
      </div>
      <div class="row-actions">
        <small>${money(product.price)} · ${escapeHtml(getBranchName(getOperationalBranchId()))}库存 ${getBranchStock(product, getOperationalBranchId())}</small>
        ${isAdmin() ? '<button class="ghost" type="button" data-edit-product>编辑资料 / 价格</button>' : ""}
      </div>
    `;
    row.querySelector("[data-edit-product]")?.addEventListener("click", () => fillProductForm(product));
    els.menuProductList.append(row);
  }
}

function fillProductForm(product) {
  editingProductId = product.id;
  els.nameInput.value = product.name || "";
  els.barcodeInput.value = product.barcode || "";
  els.categoryInput.value = product.category || "";
  els.priceInput.value = Number(product.price || 0);
  els.saveProductBtn.textContent = "更新商品";
  els.cancelProductEditBtn.classList.remove("hidden");
  els.nameInput.focus();
}

function resetProductFormEditor() {
  editingProductId = "";
  els.productForm.reset();
  els.saveProductBtn.textContent = "新增商品";
  els.cancelProductEditBtn.classList.add("hidden");
}

function renderInventoryOverview() {
  if (!canUseOperations()) return;
  els.inventoryOverviewList.innerHTML = "";
  const selectedBranchId = isAdmin()
    ? (resolveBranchId(els.inventoryBranchFilter.value) || currentBranchId || "hq")
    : (getOperator()?.branchId || currentBranchId || "hq");
  const selectedBranchName = getBranchName(selectedBranchId);
  const keyword = els.inventorySearchInput.value.trim().toLowerCase();
  const filteredProducts = products.filter((product) => {
    if (!keyword) return true;
    return [product.name, product.barcode, product.category]
      .some((value) => String(value || "").toLowerCase().includes(keyword));
  });
  if (!filteredProducts.length) {
    els.inventoryOverviewList.innerHTML = '<div class="empty">暂无库存资料</div>';
    return;
  }
  for (const product of filteredProducts.slice(0, 50)) {
    const selectedStock = getBranchStock(product, selectedBranchId);
    const totalStock = Object.values(normalizeProductBranches(product).branchStock || {})
      .reduce((sum, stock) => sum + Number(stock || 0), 0);
    const row = document.createElement("div");
    row.className = "management-row inventory-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(selectedBranchName)} · SKU ${escapeHtml(product.barcode || "-")} · 总库存 ${totalStock}</small>
      </div>
      <form class="inventory-adjust-control" data-adjust-stock data-product-id="${escapeHtml(product.id)}" data-branch-id="${escapeHtml(selectedBranchId)}">
        <input type="number" min="0" step="1" required value="${selectedStock}" aria-label="${escapeHtml(product.name)} ${escapeHtml(selectedBranchName)} 库存">
        <button class="ghost stock-adjust-button" type="submit">保存</button>
      </form>
    `;
    const form = row.querySelector("[data-adjust-stock]");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector("input");
      adjustInventoryStock(form.dataset.productId, form.dataset.branchId, input.value, input);
    });
    els.inventoryOverviewList.append(row);
  }
}

function adjustInventoryStock(productId, branchId, rawValue, inputElement = null) {
  if (!requireOperations()) return;
  const product = products.find((item) => item.id === productId);
  const resolvedBranchId = resolveBranchId(branchId);
  if (!product || !resolvedBranchId) {
    alert("找不到商品或分行。");
    return;
  }
  if (!canManageBranch(resolvedBranchId)) {
    alert("员工只能调整自己授权分行的库存。");
    return;
  }
  const beforeStock = getBranchStock(product, resolvedBranchId);
  const nextStock = Number(rawValue);
  if (!Number.isFinite(nextStock) || nextStock < 0 || !Number.isInteger(nextStock)) {
    if (inputElement) {
      inputElement.setCustomValidity("库存必须是 0 或以上的整数");
      inputElement.reportValidity();
      inputElement.focus();
    } else {
      alert("库存必须是 0 或以上的整数。");
    }
    return;
  }
  if (inputElement) inputElement.setCustomValidity("");
  if (nextStock === beforeStock) return;

  let savedProduct = product;
  const nextProducts = products.map((item) => {
    if (item.id !== productId) return normalizeProductBranches(item);
    savedProduct = normalizeProductBranches(setBranchStock(item, resolvedBranchId, nextStock));
    return savedProduct;
  });
  const adjustment = {
    id: `ADJ${Date.now()}`,
    createdAt: new Date().toISOString(),
    productId: savedProduct.id,
    productName: savedProduct.name,
    barcode: savedProduct.barcode,
    branchId: resolvedBranchId,
    branchName: getBranchName(resolvedBranchId),
    beforeStock,
    afterStock: nextStock,
    delta: nextStock - beforeStock,
    reason: "库存页调整",
    operator: getCurrentActor()
  };
  const nextStockAdjustments = [
    adjustment,
    ...stockAdjustments.filter((item) => item.id !== adjustment.id)
  ].slice(0, 500);
  const saved = saveStorageBatch([
    [STORAGE_KEYS.products, nextProducts],
    [STORAGE_KEYS.stockAdjustments, nextStockAdjustments]
  ]);
  if (!saved) return;
  products = nextProducts;
  stockAdjustments = nextStockAdjustments;
  syncProductToCloud(savedProduct);
  syncStockAdjustmentToCloud(adjustment);
  writeAuditLog("inventory.adjust", {
    productId: savedProduct.id,
    productName: savedProduct.name,
    barcode: savedProduct.barcode,
    branchId: resolvedBranchId,
    previousStock: beforeStock,
    nextStock
  });
  renderAll();
}

function renderSettingsForm() {
  if (!isAdmin()) return;
  els.businessNameInput.value = appSettings.businessName;
  els.defaultServiceNameInput.value = appSettings.defaultServiceName;
  els.serviceDaysInput.value = appSettings.serviceDays;
  els.lowStockThresholdInput.value = appSettings.lowStockThreshold ?? 5;
  els.receiptFooterInput.value = appSettings.receiptFooter;
  const adminUser = authorizedUsers.find((user) =>
    normalizeEmail(user.email) === normalizeEmail(adminEmail || currentCloudUser?.email)
    && (user.role === "admin" || user.role === "管理员")
  );
  els.adminOfflinePasswordStatus.textContent = adminUser?.offlinePasswordHash
    ? `已设置${isCloudAdmin() ? "，可在此更新" : "；更新时需要 Google 管理员登录"}`
    : `尚未设置${isCloudAdmin() ? "" : "；请先使用 Google 管理员登录"}`;
}

async function saveAdminOfflinePassword(event) {
  event.preventDefault();
  if (!requireCloudAdmin()) return;
  const password = els.adminOfflinePasswordInput.value;
  const confirmation = els.adminOfflinePasswordConfirm.value;
  if (password.length < 8) {
    alert("管理员离线密码至少需要 8 位。");
    els.adminOfflinePasswordInput.focus();
    return;
  }
  if (password !== confirmation) {
    alert("两次输入的管理员离线密码不一致。");
    els.adminOfflinePasswordConfirm.focus();
    return;
  }
  const email = normalizeEmail(currentCloudUser.email);
  if (!(await isConfiguredAdminEmail(email))) {
    alert("当前 Google 账号不是唯一管理员。");
    return;
  }
  const existing = authorizedUsers.find((user) => normalizeEmail(user.email) === email) || {};
  const offlinePasswordSalt = createPasswordSalt();
  const adminUser = {
    ...existing,
    id: existing.id || "admin-user",
    name: currentCloudUser.name || existing.name || "管理员",
    email,
    branchId: "hq",
    role: "admin",
    active: true,
    offlinePasswordAlgorithm: "PBKDF2-SHA256",
    offlinePasswordIterations: OFFLINE_PASSWORD_ITERATIONS,
    offlinePasswordSalt,
    offlinePasswordHash: await hashOfflinePassword(email, password, offlinePasswordSalt)
  };
  const nextUsers = authorizedUsers.some((user) => normalizeEmail(user.email) === email)
    ? authorizedUsers.map((user) => normalizeEmail(user.email) === email ? adminUser : user)
    : [adminUser, ...authorizedUsers];
  if (!save(STORAGE_KEYS.authorizedUsers, nextUsers)) return;
  authorizedUsers = nextUsers;
  currentCloudUser = { ...currentCloudUser, ...adminUser };
  const cloudSynced = await syncManagementToCloud("user", adminUser);
  writeAuditLog("admin.offline-password.update", { email });
  els.adminOfflinePasswordForm.reset();
  els.adminOfflinePasswordStatus.textContent = cloudSynced
    ? "管理员离线密码已安全更新并同步云端。"
    : "管理员离线密码已保存到本设备；云端尚未同步，其他设备暂时不能离线使用。";
  els.adminOfflinePasswordStatus.classList.toggle("error", !cloudSynced);
  renderManagementLists();
}

function renderPrinterSettings() {
  if (!els.printerPaperWidth) return;
  els.printerPaperWidth.value = printerSettings.paperWidth;
  els.printerAutoPrint.checked = Boolean(printerSettings.autoPrint);
  const printer = window.thermalPrinter;
  const supported = Boolean(printer?.isSupported());
  const connected = Boolean(printer?.isConnected());
  const printing = Boolean(printer?.isPrinting());
  els.printerConnectBtn.disabled = !supported || connected || printing;
  els.printerPairBtn.disabled = !supported || printing;
  els.printerTestBtn.disabled = !supported || !connected || printing;
  els.printerForgetBtn.disabled = printing || (!printerSettings.deviceId && !printer?.getDeviceInfo().id);
  els.bluetoothPrintReceiptBtn.disabled = !supported || printing;
  if (!supported) {
    updatePrinterStatus("此浏览器不支持蓝牙直连，请使用 Android 或电脑的 Chrome / Edge。", "error");
  }
}

function renderIntegrationOverview() {
  if (!els.integrationOverview) return;
  const activeSales = getNonVoidedSales();
  const outboxJobCount = sales.reduce((total, sale) => {
    const outbox = sale.integrationOutbox || {};
    return total
      + (Array.isArray(outbox.checkoutJobIds) ? outbox.checkoutJobIds.length : 0)
      + (Array.isArray(outbox.voidJobIds) ? outbox.voidJobIds.length : 0);
  }, 0);
  const references = activeSales.map((sale) => normalizeSaleExternalReferences(sale).externalReferences);
  const simplePayRows = references.filter((item) => item.simplePayStatus !== "not-used");
  const affiliateRows = references.filter((item) => item.affiliateStatus !== "not-used");
  const simplePayPending = simplePayRows.filter((item) => item.simplePayStatus === "pending").length;
  const affiliatePending = affiliateRows.filter((item) => item.affiliateStatus === "pending").length;
  const markedFailedCount = references.filter((item) =>
    isIntegrationFailureStatus(item.simplePayStatus)
    || isIntegrationFailureStatus(item.affiliateStatus)
  ).length;
  const integrityIssues = getIntegrationIssues(activeSales);
  const failedCount = markedFailedCount + integrityIssues.length;
  const inventoryReviewCount = sales.filter(requiresInventoryReview).length;
  const affiliateProduct = products.find((product) =>
    product.affiliatePlanId || String(product.barcode || "").startsWith("AFF-PLAN-")
  );
  const issueHint = integrityIssues[0]?.message || "在交易记录打开“关联资料”处理";
  els.integrationOverview.innerHTML = `
    <div class="management-row">
      <div>
        <strong>连接模式</strong>
        <small>订单内保存参考号，暂不进行跨项目实时查询</small>
      </div>
      <span>低成本手动关联</span>
    </div>
    <div class="management-row">
      <div>
        <strong>Integration outbox</strong>
        <small>订单同步时一并建立，使用固定任务编号避免重复处理</small>
      </div>
      <span>${outboxJobCount} 项任务</span>
    </div>
    <div class="management-row">
      <div>
        <strong>SimplePay</strong>
        <small>${simplePayRows.length} 笔使用记录</small>
      </div>
      <span>${simplePayPending} 笔待确认</span>
    </div>
    <div class="management-row">
      <div>
        <strong>简单联盟</strong>
        <small>${affiliateRows.length} 笔含推荐或联盟资料</small>
      </div>
      <span>${affiliatePending} 笔待关联</span>
    </div>
    <div class="management-row">
      <div>
        <strong>关联异常</strong>
        <small>${escapeHtml(issueHint)}</small>
      </div>
      <span>${failedCount} 笔</span>
    </div>
    <div class="management-row ${inventoryReviewCount ? "diagnostic-warning" : ""}">
      <div>
        <strong>离线库存复核</strong>
        <small>先读取云端库存并调整，再确认订单复核</small>
      </div>
      <span>${inventoryReviewCount} 笔待处理</span>
    </div>
    <div class="management-row">
      <div>
        <strong>价格来源</strong>
        <small>管理员按需读取联盟配套价格，联盟入单时仍会再次核对</small>
      </div>
      <span>${affiliateProduct ? money(affiliateProduct.price) : "未设置联盟商品"}</span>
    </div>
    <div class="row-actions integration-review-actions">
      <button class="primary" type="button" data-review-integration="pending">处理待关联</button>
      <button class="ghost" type="button" data-review-integration="failed">查看异常</button>
      <button class="ghost" type="button" data-review-integration="inventory-review">库存待复核</button>
    </div>
  `;
  for (const button of els.integrationOverview.querySelectorAll("[data-review-integration]")) {
    button.addEventListener("click", () => openIntegrationQueue(button.dataset.reviewIntegration));
  }
  renderIntegrationConnectionOverview();
  renderIntegrationJobOverview();
}

function renderIntegrationConnectionOverview() {
  if (!els.integrationConnectionOverview) return;
  els.integrationConnectionOverview.innerHTML = "";
  if (!isAdmin() || !integrationConnectionStatus) return;
  const status = integrationConnectionStatus;
  const simplePayBranches = Array.isArray(status.simplePay?.branches) ? status.simplePay.branches : [];
  const branchIssues = simplePayBranches.filter((branch) =>
    !branch.merchantConfigured || !branch.merchantExists || !branch.merchantApproved
  );
  const secureMode = status.simplePay?.secureMoneyFunctionsEnabled === true;
  const rows = [
    {
      title: "SimplePay 项目",
      detail: status.simplePay?.reachable
        ? `积分汇率 ${Number(status.simplePay.pointsPerMyr || 0)} / RM`
        : `无法读取${status.simplePay?.errorCode ? ` · ${status.simplePay.errorCode}` : ""}`,
      value: status.simplePay?.reachable ? "可连接" : "不可连接",
      warning: !status.simplePay?.reachable
    },
    {
      title: "SimplePay 安全资金模式",
      detail: secureMode ? "资金变动由安全云函数处理" : "仍是迁移 / 测试模式，不能正式上线",
      value: secureMode ? "已启用" : "未启用",
      warning: !secureMode
    },
    {
      title: "分行 SimplePay 商家",
      detail: branchIssues.length
        ? branchIssues.map((branch) => branch.branchName || branch.branchId).join("、")
        : `${simplePayBranches.length} 个分行均已配置并通过`,
      value: `${branchIssues.length} 个问题`,
      warning: branchIssues.length > 0
    },
    {
      title: "联盟项目",
      detail: status.affiliate?.reachable
        ? `${status.affiliate.activePlans?.length || 0} 个有效配套`
        : `无法读取${status.affiliate?.errorCode ? ` · ${status.affiliate.errorCode}` : ""}`,
      value: status.affiliate?.reachable ? "可连接" : "不可连接",
      warning: !status.affiliate?.reachable || !(status.affiliate?.activePlans?.length)
    }
  ];
  for (const item of rows) {
    const row = document.createElement("div");
    row.className = `management-row ${item.warning ? "diagnostic-warning" : ""}`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </div>
      <span>${escapeHtml(item.value)}</span>
    `;
    els.integrationConnectionOverview.append(row);
  }
}

async function checkIntegrationConnectionsFromCloud() {
  if (!requireCloudAdmin() || integrationConnectionLoading) return;
  if (!window.cloudPOS?.checkIntegrationConnections) {
    alert("三系统连接诊断模块尚未加载，请刷新页面后重试。");
    return;
  }
  integrationConnectionLoading = true;
  els.checkIntegrationConnectionsBtn.disabled = true;
  els.checkIntegrationConnectionsBtn.textContent = "正在检查...";
  try {
    const result = await window.cloudPOS.checkIntegrationConnections();
    integrationConnectionStatus = result && typeof result === "object" ? result : {};
    renderIntegrationConnectionOverview();
  } catch (error) {
    alert(`三系统连接检查失败：${getErrorMessage(error)}`);
  } finally {
    integrationConnectionLoading = false;
    els.checkIntegrationConnectionsBtn.disabled = false;
    els.checkIntegrationConnectionsBtn.textContent = "检查三系统连接";
  }
}

function renderIntegrationTraceOverview() {
  if (!els.integrationTraceOverview) return;
  els.integrationTraceOverview.innerHTML = "";
  if (!isAdmin() || !integrationTraceStatus) {
    els.integrationTraceOverview.innerHTML = '<div class="empty compact-empty">尚未追踪订单</div>';
    return;
  }
  const trace = integrationTraceStatus;
  const jobs = Array.isArray(trace.jobs) ? trace.jobs : [];
  const unresolvedJobs = jobs.filter((job) => !["completed", "canceled"].includes(job.status));
  const simplePayParts = [
    trace.simplePay?.paymentIntent?.status && `付款意图 ${trace.simplePay.paymentIntent.status}`,
    trace.simplePay?.merchantOrder?.status && `商家订单 ${trace.simplePay.merchantOrder.status}`,
    trace.simplePay?.refundIntent?.status && `退款意图 ${trace.simplePay.refundIntent.status}`,
    ...(trace.simplePay?.refundRequests || []).map((item) => `退款 ${item.status}`)
  ].filter(Boolean);
  const affiliateParts = [
    trace.affiliate?.externalOrder?.status && `联盟订单 ${trace.affiliate.externalOrder.status}`,
    trace.affiliate?.reversalCase?.status && `撤销 ${trace.affiliate.reversalCase.status}`,
    ...(trace.affiliate?.commands || []).map((item) => `${item.operation || "命令"} ${item.status}`)
  ].filter(Boolean);
  const rows = [
    {
      title: `POS ${trace.sale?.id || "-"}`,
      detail: `${trace.sale?.branchId || "-"} · ${money(trace.sale?.amount)} · ${trace.sale?.paymentMethod || "-"}`,
      value: trace.sale?.status || "未知",
      warning: trace.sale?.status === "voided"
    },
    {
      title: "整合任务",
      detail: jobs.length
        ? jobs.map((job) => `${job.operation || job.id}: ${job.status || "未知"}${job.errorCode ? ` (${job.errorCode})` : ""}`).join(" · ")
        : "没有建立整合任务",
      value: `${unresolvedJobs.length} 项未结束`,
      warning: unresolvedJobs.some((job) => ["retry", "needs-attention", "failed"].includes(job.status))
    },
    {
      title: "SimplePay",
      detail: trace.simplePay?.reachable
        ? (simplePayParts.join(" · ") || "项目可连接，本订单没有 SimplePay 记录")
        : `无法读取${trace.simplePay?.errorCode ? ` · ${trace.simplePay.errorCode}` : ""}`,
      value: trace.simplePay?.reachable ? "已读取" : "不可连接",
      warning: !trace.simplePay?.reachable
    },
    {
      title: "简单联盟",
      detail: trace.affiliate?.reachable
        ? (affiliateParts.join(" · ") || "项目可连接，本订单没有联盟记录")
        : `无法读取${trace.affiliate?.errorCode ? ` · ${trace.affiliate.errorCode}` : ""}`,
      value: trace.affiliate?.reachable ? "已读取" : "不可连接",
      warning: !trace.affiliate?.reachable
    }
  ];
  for (const item of rows) {
    const row = document.createElement("div");
    row.className = `management-row ${item.warning ? "diagnostic-warning" : ""}`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </div>
      <span>${escapeHtml(item.value)}</span>
    `;
    els.integrationTraceOverview.append(row);
  }
}

async function traceIntegrationOrderFromCloud() {
  if (!requireCloudAdmin() || integrationTraceLoading) return;
  if (!window.cloudPOS?.traceIntegrationOrder) {
    alert("订单追踪模块尚未加载，请刷新页面后重试。");
    return;
  }
  const posOrderId = els.integrationTraceOrderInput.value.trim();
  if (!posOrderId) {
    alert("请输入 POS 订单号。");
    els.integrationTraceOrderInput.focus();
    return;
  }
  integrationTraceLoading = true;
  els.traceIntegrationOrderBtn.disabled = true;
  els.traceIntegrationOrderBtn.textContent = "正在追踪...";
  try {
    const result = await window.cloudPOS.traceIntegrationOrder(posOrderId);
    integrationTraceStatus = result && typeof result === "object" ? result : {};
    renderIntegrationTraceOverview();
  } catch (error) {
    integrationTraceStatus = null;
    renderIntegrationTraceOverview();
    alert(`订单追踪失败：${getErrorMessage(error)}`);
  } finally {
    integrationTraceLoading = false;
    els.traceIntegrationOrderBtn.disabled = false;
    els.traceIntegrationOrderBtn.textContent = "追踪订单";
  }
}

function getIntegrationJobStatusText(status) {
  const labels = {
    pending: "等待处理",
    processing: "处理中",
    retry: "等待重试",
    blocked: "等待前置任务",
    "awaiting-customer-authorization": "等待顾客付款",
    "awaiting-refund-approval": "等待退款审批",
    dispatched: "已派发",
    completed: "已完成",
    canceled: "已取消",
    "needs-attention": "需要处理"
  };
  return labels[status] || status || "未知";
}

function renderIntegrationJobOverview() {
  if (!els.integrationJobOverview) return;
  els.integrationJobOverview.innerHTML = "";
  if (!isAdmin()) return;
  if (!integrationJobsLoadedAt) {
    els.integrationJobOverview.innerHTML = '<div class="empty compact-empty">尚未检查云端整合任务</div>';
    return;
  }
  const actionable = integrationJobs.filter((job) => ["retry", "needs-attention"].includes(job.status));
  const summary = document.createElement("div");
  summary.className = `management-row ${actionable.length ? "diagnostic-warning" : ""}`;
  summary.innerHTML = `
    <div>
      <strong>云端整合任务</strong>
      <small>最近检查 ${escapeHtml(new Date(integrationJobsLoadedAt).toLocaleString())} · 最近 ${integrationJobs.length} 条</small>
    </div>
    <span>${actionable.length} 条需处理</span>
  `;
  els.integrationJobOverview.append(summary);
  for (const job of actionable.slice(0, 10)) {
    const row = document.createElement("div");
    row.className = "management-row diagnostic-warning";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(job.operation || "未知任务")} · ${escapeHtml(getIntegrationJobStatusText(job.status))}</strong>
        <small>${escapeHtml(job.posOrderId || "-")} · ${escapeHtml(job.lastError?.message || "可重新执行")}</small>
      </div>
      <button class="ghost" type="button" data-retry-integration-job="${escapeHtml(job.id)}">安全重试</button>
    `;
    row.querySelector("[data-retry-integration-job]").addEventListener("click", () => {
      retryIntegrationJobFromCloud(job.id);
    });
    els.integrationJobOverview.append(row);
  }
}

async function checkIntegrationJobsFromCloud() {
  if (!requireCloudAdmin()) return;
  if (integrationJobsLoading) return;
  if (!window.cloudPOS?.loadIntegrationJobs) {
    alert("整合任务查询模块尚未加载，请刷新页面后重试。");
    return;
  }
  integrationJobsLoading = true;
  els.checkIntegrationJobsBtn.disabled = true;
  els.checkIntegrationJobsBtn.textContent = "正在检查...";
  try {
    const loadedJobs = await window.cloudPOS.loadIntegrationJobs();
    integrationJobs = Array.isArray(loadedJobs) ? loadedJobs : [];
    integrationJobsLoadedAt = new Date().toISOString();
    renderIntegrationJobOverview();
  } catch (error) {
    alert(`检查整合任务失败：${getErrorMessage(error)}`);
  } finally {
    integrationJobsLoading = false;
    els.checkIntegrationJobsBtn.disabled = false;
    els.checkIntegrationJobsBtn.textContent = "检查整合任务";
  }
}

async function retryIntegrationJobFromCloud(jobId) {
  if (!requireCloudAdmin() || !jobId || integrationJobsLoading) return;
  const job = integrationJobs.find((item) => item.id === jobId);
  if (!job || !["retry", "needs-attention"].includes(job.status)) return;
  if (!confirm(`确定安全重试 ${job.operation || "整合任务"}（订单 ${job.posOrderId || "-"}）吗？`)) return;
  try {
    await window.cloudPOS.retryIntegrationJob(jobId);
    await checkIntegrationJobsFromCloud();
  } catch (error) {
    alert(`整合任务无法重试：${getErrorMessage(error)}`);
  }
}

async function refreshAffiliateCatalogFromCloud() {
  if (!requireCloudAdmin()) return;
  if (!window.cloudPOS?.refreshAffiliateCatalog) {
    alert("联盟价格同步模块尚未加载，请刷新页面后重试。");
    return;
  }
  const button = els.refreshAffiliateCatalogBtn;
  button.disabled = true;
  button.textContent = "正在同步...";
  try {
    const result = await window.cloudPOS.refreshAffiliateCatalog();
    const catalog = Array.isArray(result?.catalog) ? result.catalog : [];
    const priceByPlanId = new Map(catalog.map((plan) => [String(plan.planId || ""), Number(plan.price)]));
    let localUpdatedProducts = 0;
    const nextProducts = products.map((product) => {
      const planId = String(product.affiliatePlanId || "");
      const price = priceByPlanId.get(planId);
      if (!planId || !Number.isFinite(price) || price <= 0) return product;
      if (Number(product.price) !== price) localUpdatedProducts += 1;
      return {
        ...product,
        price,
        affiliatePlanName: catalog.find((plan) => plan.planId === planId)?.name || product.affiliatePlanName || "",
        affiliatePriceSyncedAt: result.syncedAt || new Date().toISOString()
      };
    });
    if (!save(STORAGE_KEYS.products, nextProducts)) {
      alert("联盟价格已更新到云端，但本机保存失败；刷新云端资料后会重新取得价格。");
      return;
    }
    products = nextProducts;
    const productById = new Map(nextProducts.map((product) => [product.id, product]));
    cart = cart.map((item) => {
      const product = productById.get(item.id);
      return product?.affiliatePlanId ? { ...item, price: Number(product.price) } : item;
    });
    writeAuditLog("affiliate.catalog.refresh", {
      plans: catalog.map((plan) => ({ planId: plan.planId, price: plan.price })),
      updatedProducts: Number(result.updatedProducts || 0),
      localUpdatedProducts
    });
    alert(`联盟价格同步完成，共读取 ${catalog.length} 个有效配套，本机更新 ${localUpdatedProducts} 个商品。`);
    renderAll();
  } catch (error) {
    alert(`联盟价格同步失败：${getErrorMessage(error)}`);
  } finally {
    button.disabled = false;
    button.textContent = "同步联盟价格";
  }
}

function openIntegrationQueue(filter) {
  showAllSalesDates = true;
  showMoreSales = true;
  els.salesIntegrationFilter.value = filter;
  setAppView("transactions");
  renderSales();
}

function duplicateValues(items, getValue) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const value = String(getValue(item) || "").trim().toLowerCase();
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function runLocalDiagnostics() {
  const checks = [];
  const addCheck = (label, level, detail) => checks.push({ label, level, detail });

  try {
    const key = "__simplepos_diagnostic__";
    localStorage.setItem(key, "ok");
    localStorage.removeItem(key);
    addCheck("本机储存", "pass", "可正常写入");
  } catch (error) {
    addCheck("本机储存", "error", `无法写入：${error.message}`);
  }

  addCheck(
    "储存资料完整性",
    protectedCorruptStorageKeys.size || lastStorageWriteError ? "error" : (storageReadIssues.length ? "warning" : "pass"),
    lastStorageWriteError
      ? `最近写入失败：${lastStorageWriteError}`
      : protectedCorruptStorageKeys.size
        ? `${protectedCorruptStorageKeys.size} 项损坏原始资料尚未安全备份`
        : storageReadIssues.length
          ? `${storageReadIssues.length} 项损坏资料已另存，完整备份会包含恢复附件`
          : "未发现损坏或写入失败"
  );

  const duplicateBranchIds = duplicateValues(branches, (branch) => branch.id);
  const invalidBranches = branches.filter((branch) => !branch.id || !branch.name);
  addCheck(
    "分行资料",
    duplicateBranchIds.length || invalidBranches.length ? "error" : "pass",
    duplicateBranchIds.length
      ? `重复分行 ID：${duplicateBranchIds.join(", ")}`
      : (invalidBranches.length ? `${invalidBranches.length} 笔资料不完整` : `${branches.length} 个分行正常`)
  );

  const duplicateProductIds = duplicateValues(products, (product) => product.id);
  const duplicateBarcodes = duplicateValues(products, (product) => product.barcode);
  const invalidStocks = [];
  for (const product of products) {
    for (const [branchId, stock] of Object.entries(normalizeProductBranches(product).branchStock || {})) {
      if (!Number.isFinite(Number(stock)) || Number(stock) < 0) {
        invalidStocks.push(`${product.name || product.id}@${branchId}`);
      }
    }
  }
  const productLevel = duplicateProductIds.length || duplicateBarcodes.length || invalidStocks.length ? "error" : "pass";
  const productDetail = duplicateProductIds.length
    ? `重复商品 ID：${duplicateProductIds.join(", ")}`
    : duplicateBarcodes.length
      ? `重复 SKU：${duplicateBarcodes.join(", ")}`
      : invalidStocks.length
        ? `库存异常：${invalidStocks.slice(0, 3).join(", ")}`
        : `${products.length} 个商品及分行库存正常`;
  addCheck("商品与库存", productLevel, productDetail);

  const duplicateSaleIds = duplicateValues(sales, (sale) => sale.id);
  const invalidSales = sales.filter((sale) =>
    !sale.id
    || !branches.some((branch) => branch.id === (sale.branchId || "hq"))
    || !Array.isArray(sale.items)
    || !Number.isFinite(Number(sale.total))
  );
  addCheck(
    "销售订单",
    duplicateSaleIds.length || invalidSales.length ? "error" : "pass",
    duplicateSaleIds.length
      ? `重复订单号：${duplicateSaleIds.join(", ")}`
      : (invalidSales.length ? `${invalidSales.length} 笔订单结构异常` : `${sales.length} 笔订单结构正常`)
  );

  const duplicateEmails = duplicateValues(authorizedUsers, (user) => user.email);
  const invalidUsers = authorizedUsers.filter((user) =>
    !user.email || !branches.some((branch) => branch.id === user.branchId)
  );
  addCheck(
    "员工授权",
    duplicateEmails.length || invalidUsers.length ? "error" : "pass",
    duplicateEmails.length
      ? `重复邮箱：${duplicateEmails.join(", ")}`
      : (invalidUsers.length ? `${invalidUsers.length} 位用户的授权分行无效` : `${authorizedUsers.length} 位授权用户正常`)
  );

  const integrationIssues = getIntegrationIssues(getActiveSales());
  addCheck(
    "外部系统关联",
    integrationIssues.length ? "warning" : "pass",
    integrationIssues.length ? `${integrationIssues.length} 个问题；${integrationIssues[0].message}` : "订单参考号未发现重复或缺失"
  );

  const inventoryReviews = sales.filter(requiresInventoryReview);
  addCheck(
    "离线库存复核",
    inventoryReviews.length ? "warning" : "pass",
    inventoryReviews.length
      ? `${inventoryReviews.length} 笔订单等待核对；${inventoryReviews[0].id}：${getInventoryConflictSummary(inventoryReviews[0])}`
      : "没有库存冲突待复核"
  );

  const pendingCount = pendingSales.length
    + pendingSaleUpdates.length
    + pendingProducts.length
    + pendingStockAdjustments.length
    + pendingAuditLogs.length
    + getPendingManagementCount();
  const orphanUpdates = pendingSaleUpdates.filter((pending) =>
    !sales.some((sale) => sale.id === pending.id)
  );
  addCheck(
    "待同步队列",
    orphanUpdates.length ? "error" : (pendingCount ? "warning" : "pass"),
    orphanUpdates.length
      ? `${orphanUpdates.length} 个订单更新找不到本机订单`
      : (pendingCount ? `共有 ${pendingCount} 项等待网络同步` : "没有待同步资料")
  );

  const allShifts = [currentShift, ...shifts].filter(Boolean);
  const cashMovements = allShifts.flatMap((shift) =>
    (Array.isArray(shift.cashMovements) ? shift.cashMovements : []).map((movement) => ({
      ...movement,
      shiftId: shift.id
    }))
  );
  const duplicateMovementIds = duplicateValues(cashMovements, (movement) => movement.id);
  const movementIds = new Set(cashMovements.map((movement) => movement.id));
  const invalidMovements = cashMovements.filter((movement) =>
    !movement.id
    || !["in", "out"].includes(movement.type)
    || !Number.isFinite(Number(movement.amount))
    || Number(movement.amount) <= 0
    || !movement.reason
    || (movement.reversalOf && !movementIds.has(movement.reversalOf))
  );
  addCheck(
    "现金流水",
    duplicateMovementIds.length || invalidMovements.length ? "error" : "pass",
    duplicateMovementIds.length
      ? `重复流水 ID：${duplicateMovementIds.join(", ")}`
      : (invalidMovements.length ? `${invalidMovements.length} 笔现金流水结构异常` : `${cashMovements.length} 笔逐笔现金流水正常`)
  );

  const errors = checks.filter((check) => check.level === "error").length;
  const warnings = checks.filter((check) => check.level === "warning").length;
  const summaryLevel = errors ? "error" : (warnings ? "warning" : "pass");
  const summaryText = errors
    ? `${errors} 项错误，${warnings} 项提醒`
    : (warnings ? `没有结构错误，${warnings} 项提醒` : "全部检查通过");
  els.diagnosticsOverview.innerHTML = `
    <div class="management-row diagnostic-${summaryLevel}">
      <div>
        <strong>自检结果</strong>
        <small>${new Date().toLocaleString()}</small>
      </div>
      <span>${escapeHtml(summaryText)}</span>
    </div>
  `;
  for (const check of checks) {
    const row = document.createElement("div");
    row.className = `management-row diagnostic-${check.level}`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        <small>${escapeHtml(check.detail)}</small>
      </div>
      <span>${check.level === "pass" ? "通过" : (check.level === "warning" ? "提醒" : "错误")}</span>
    `;
    els.diagnosticsOverview.append(row);
  }
  return { checks, errors, warnings };
}

function daysUntil(dateValue) {
  const target = new Date(dateValue);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function getFollowUpStatusText(sale) {
  if (isSaleVoided(sale)) return "已作废";
  const status = sale.followUp?.status || "pending";
  if (status === "contacted") return "已联系";
  if (status === "completed") return "已完成";
  return "待跟进";
}

function getFollowUpDueText(daysLeft) {
  if (daysLeft < 0) return `已到期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return "今天到期";
  return `${daysLeft} 天后到期`;
}

function updateSaleFollowUp(saleId, status) {
  if (!requireOperations()) return;
  const sale = sales.find((item) => item.id === saleId);
  if (!sale) return;
  if (!canManageBranch(sale.branchId || "hq")) {
    alert("员工只能更新自己授权分行的客户跟进。");
    return;
  }
  const nextFollowUp = {
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: getCurrentActor()
  };
  sales = sales.map((item) => item.id === saleId ? { ...item, followUp: nextFollowUp } : item);
  save(STORAGE_KEYS.sales, sales);
  const updatedSale = sales.find((item) => item.id === saleId);
  pendingSales = pendingSales.map((item) => item.id === saleId ? updatedSale : item);
  savePendingSales();
  syncSaleUpdateToCloud(updatedSale, "客户跟进");
  writeAuditLog("followup.update", {
    saleId,
    customer: sale.customer?.name || "",
    phone: sale.customer?.phone || "",
    status
  });
  renderAll();
}

function isSaleVoided(sale) {
  return sale.status === "voided";
}

function isSalePaymentPending(sale) {
  return sale.status === "payment-pending";
}

function getSaleStatusText(sale) {
  if (isSaleVoided(sale)) return "已作废";
  if (isSalePaymentPending(sale)) return "等待 SimplePay 付款（库存已预留）";
  return "正常";
}

function getSaleSyncText(sale) {
  if (pendingSales.some((item) => item.id === sale.id)) return "待同步";
  if (pendingSaleUpdates.some((item) => item.id === sale.id)) return "更新待同步";
  if (requiresInventoryReview(sale)) return "已同步 · 库存待复核";
  if (getInventoryReviewStatus(sale) === "resolved") return "已同步 · 库存已复核";
  if (sale.syncStatus === "synced") return "已同步";
  if (sale.syncStatus === "queued" || sale.syncStatus === "pending") return "后台同步中";
  return "已处理";
}

function getIntegrationStatusText(status, pendingText = "待关联") {
  if (status === "linked") return "已关联";
  if (status === "refunded") return "已退款";
  if (status === "reversed") return "已撤销";
  if (status === "review-required") return "需人工复核";
  if (status === "refund-failed") return "退款异常";
  if (status === "canceled") return "已取消";
  if (status === "failed") return "关联异常";
  if (status === "pending") return pendingText;
  return "未使用";
}

function isIntegrationFailureStatus(status) {
  return ["failed", "refund-failed", "review-required"].includes(status);
}

function getSaleIntegrationSummary(sale) {
  const normalized = normalizeSaleExternalReferences(sale);
  const references = normalized.externalReferences;
  return `SimplePay ${getIntegrationStatusText(references.simplePayStatus, "待确认")} · 联盟 ${getIntegrationStatusText(references.affiliateStatus)}`;
}

function getIntegrationIssues(source = getActiveSales()) {
  const issues = [];
  const posOrderIds = new Map();
  const simplePayReferences = new Map();
  const affiliateOrderIds = new Map();
  for (const sale of source) {
    const references = normalizeSaleExternalReferences(sale).externalReferences;
    const checks = [
      ["POS 订单号", references.posOrderId, posOrderIds],
      ["SimplePay 参考号", references.simplePayReference, simplePayReferences],
      ["联盟订单号", references.affiliateOrderId, affiliateOrderIds]
    ];
    for (const [label, value, seen] of checks) {
      if (!value && label === "POS 订单号") {
        issues.push({ saleIds: [sale.id], message: `${sale.id} 缺少 POS 订单号` });
        continue;
      }
      if (!value) continue;
      if (seen.has(value) && seen.get(value) !== sale.id) {
        issues.push({
          saleIds: [seen.get(value), sale.id],
          message: `${label} ${value} 重复用于 ${seen.get(value)} 与 ${sale.id}`
        });
      } else {
        seen.set(value, sale.id);
      }
    }
    if (references.simplePayStatus === "linked" && !references.simplePayReference) {
      issues.push({ saleIds: [sale.id], message: `${sale.id} 的 SimplePay 已关联但缺少参考号` });
    }
    if (references.affiliateStatus === "linked" && !references.affiliateOrderId) {
      issues.push({ saleIds: [sale.id], message: `${sale.id} 的联盟已关联但缺少订单号` });
    }
  }
  return issues;
}

function matchesIntegrationFilter(sale, filter, issueSaleIds = new Set()) {
  if (filter === "all") return true;
  if (filter === "inventory-review") return requiresInventoryReview(sale);
  if (filter === "inventory-resolved") return getInventoryReviewStatus(sale) === "resolved";
  const references = normalizeSaleExternalReferences(sale).externalReferences;
  if (filter === "pending") {
    return references.simplePayStatus === "pending" || references.affiliateStatus === "pending";
  }
  if (filter === "simplepay-pending") return references.simplePayStatus === "pending";
  if (filter === "affiliate-pending") return references.affiliateStatus === "pending";
  if (filter === "linked") {
    return references.simplePayStatus === "linked" || references.affiliateStatus === "linked";
  }
  if (filter === "failed") {
    return isIntegrationFailureStatus(references.simplePayStatus)
      || isIntegrationFailureStatus(references.affiliateStatus)
      || issueSaleIds.has(sale.id);
  }
  return true;
}

async function syncSaleUpdateToCloud(sale, reason = "订单资料") {
  queuePendingSaleUpdate(sale);
  if (pendingSales.some((item) => item.id === sale.id)) return false;
  if (!hasCloud() || !navigator.onLine) return false;
  try {
    await window.cloudPOS.saveSale(sale);
    markSaleUpdateSynced(sale.id);
    updateCloudStatus(`${reason}已同步`, true);
    return true;
  } catch (error) {
    updateCloudStatus(`${reason}待同步`);
    console.warn(`${reason} sync failed`, error);
    return false;
  }
}

async function syncVoidToCloud(sale) {
  if (!pendingSaleUpdates.some((item) => item.id === sale.id)) queuePendingSaleUpdate(sale);
  if (!hasCloud() || !navigator.onLine || !window.cloudPOS.saveVoid) {
    updateCloudStatus("退款事务待同步");
    return false;
  }
  try {
    const result = await window.cloudPOS.saveVoid(sale);
    applyVoidSyncResult(sale.id, result);
    return true;
  } catch (error) {
    updateCloudStatus("退款待同步");
    console.warn("Void sale sync failed", error);
    return false;
  }
}

function openInventoryForReview(saleId) {
  const sale = sales.find((item) => item.id === saleId);
  if (!sale || !canManageBranch(sale.branchId || "hq")) return;
  setAppView("inventory");
  els.inventoryBranchFilter.value = sale.branchId || "hq";
  renderInventoryOverview();
}

function resolveInventoryReview(saleId) {
  const sale = sales.find((item) => item.id === saleId);
  if (!sale || !requiresInventoryReview(sale) || !canManageBranch(sale.branchId || "hq")) return;
  if (!confirm(`请先在库存页核对并调整 ${sale.branchName || getBranchName(sale.branchId || "hq")} 的云端库存。\n\n确定已完成订单 ${sale.id} 的库存复核吗？`)) return;
  const resolvedAt = new Date().toISOString();
  const resolvedBy = getCurrentActor();
  const updatedSale = {
    ...sale,
    inventoryReview: {
      ...(sale.inventoryReview || {}),
      status: "resolved",
      resolvedAt,
      resolvedBy,
      resolution: "manual-stock-review"
    },
    syncStatus: "pending-update",
    updatedAt: resolvedAt
  };
  sales = sales.map((item) => item.id === sale.id ? updatedSale : item);
  save(STORAGE_KEYS.sales, sales);
  syncSaleUpdateToCloud(updatedSale, "库存复核");
  writeAuditLog("inventory.conflict.resolved", {
    saleId: sale.id,
    branchId: sale.branchId || "hq",
    conflicts: sale.inventoryReview?.conflicts || []
  });
  renderAll();
}

function openIntegrationEditor(saleId) {
  if (!requireAdmin()) return;
  const sale = sales.find((item) => item.id === saleId);
  if (!sale || !canManageBranch(sale.branchId || "hq")) return;
  const normalized = normalizeSaleExternalReferences(sale);
  const references = normalized.externalReferences;
  editingIntegrationSaleId = sale.id;
  els.integrationOrderNo.textContent = `订单号：${sale.id}`;
  els.integrationPosOrderId.value = references.posOrderId || sale.id;
  els.integrationSimplePayReference.value = references.simplePayReference || "";
  els.integrationSimplePayStatus.value = references.simplePayStatus;
  els.integrationAffiliateReferralCode.value = references.affiliateReferralCode || "";
  els.integrationAffiliateOrderId.value = references.affiliateOrderId || "";
  els.integrationAffiliateStatus.value = references.affiliateStatus;
  els.integrationDialog.showModal();
}

function closeIntegrationEditor() {
  editingIntegrationSaleId = "";
  els.integrationForm.reset();
  if (els.integrationDialog.open) els.integrationDialog.close();
}

async function copyIntegrationOrderId() {
  const orderId = els.integrationPosOrderId.value;
  if (!orderId) return;
  try {
    await navigator.clipboard.writeText(orderId);
  } catch {
    els.integrationPosOrderId.focus();
    els.integrationPosOrderId.select();
    document.execCommand("copy");
  }
  const originalText = els.copyIntegrationOrderIdBtn.textContent;
  els.copyIntegrationOrderIdBtn.textContent = "已复制";
  setTimeout(() => {
    els.copyIntegrationOrderIdBtn.textContent = originalText;
  }, 1200);
}

function saveIntegrationDetails(event) {
  event.preventDefault();
  if (!requireAdmin()) {
    closeIntegrationEditor();
    return;
  }
  const sale = sales.find((item) => item.id === editingIntegrationSaleId);
  if (!sale || !canManageBranch(sale.branchId || "hq")) {
    closeIntegrationEditor();
    return;
  }
  const simplePayReference = els.integrationSimplePayReference.value.trim();
  const simplePayStatus = els.integrationSimplePayStatus.value;
  const affiliateReferralCode = els.integrationAffiliateReferralCode.value.trim().toUpperCase();
  const affiliateOrderId = els.integrationAffiliateOrderId.value.trim();
  const affiliateStatus = els.integrationAffiliateStatus.value;
  if (simplePayStatus === "linked" && !simplePayReference) {
    alert("SimplePay 标记为已关联时必须填写参考号。");
    return;
  }
  if (affiliateStatus === "linked" && !affiliateOrderId) {
    alert("联盟标记为已关联时必须填写联盟订单号。");
    return;
  }
  const duplicateSimplePaySale = simplePayReference && sales.find((item) =>
    item.id !== sale.id
    && normalizeSaleExternalReferences(item).externalReferences.simplePayReference === simplePayReference
  );
  if (duplicateSimplePaySale) {
    alert(`SimplePay 参考号已用于订单 ${duplicateSimplePaySale.id}。`);
    return;
  }
  const duplicateAffiliateSale = affiliateOrderId && sales.find((item) =>
    item.id !== sale.id
    && normalizeSaleExternalReferences(item).externalReferences.affiliateOrderId === affiliateOrderId
  );
  if (duplicateAffiliateSale) {
    alert(`联盟订单号已关联 POS 订单 ${duplicateAffiliateSale.id}。`);
    return;
  }

  const updatedAt = new Date().toISOString();
  const updatedBy = getCurrentActor();
  const updatedSale = normalizeSaleExternalReferences({
    ...sale,
    customer: {
      ...(sale.customer || {}),
      referralCode: affiliateReferralCode
    },
    payment: {
      ...(sale.payment || {}),
      reference: sale.payment?.method === "简单支付 / SimplePay"
        ? simplePayReference
        : (sale.payment?.reference || "")
    },
    externalReferences: {
      ...(sale.externalReferences || {}),
      posOrderId: sale.externalReferences?.posOrderId || sale.id,
      simplePayReference,
      simplePayStatus,
      affiliateReferralCode,
      affiliateOrderId,
      affiliateStatus,
      updatedAt,
      updatedBy
    },
    syncStatus: "pending-update"
  });
  sales = sales.map((item) => item.id === sale.id ? updatedSale : item);
  pendingSales = pendingSales.map((item) => item.id === sale.id ? updatedSale : item);
  save(STORAGE_KEYS.sales, sales);
  savePendingSales();
  syncSaleUpdateToCloud(updatedSale, "订单关联资料");
  writeAuditLog("sale.integration.update", {
    saleId: sale.id,
    branchId: sale.branchId || "hq",
    simplePayStatus,
    affiliateStatus
  });
  closeIntegrationEditor();
  renderAll();
}

function getActiveSales(source = sales) {
  return source.filter((sale) => !isSaleVoided(sale) && !isSalePaymentPending(sale));
}

function getNonVoidedSales(source = sales) {
  return source.filter((sale) => !isSaleVoided(sale));
}

function voidSale(saleId) {
  if (!requireOperations()) return;
  const sale = sales.find((item) => item.id === saleId);
  if (!sale || isSaleVoided(sale)) return;
  if (!canVoidSale(sale)) {
    alert("员工只能处理自己授权分行的退款/作废。");
    return;
  }
  const unpaidCancellation = isSalePaymentPending(sale);
  if (!unpaidCancellation && navigator.onLine && hasCloud() && pendingSales.some((item) => item.id === saleId)) {
    alert("订单首次云端同步仍在进行，请稍后再退款。断网订单仍可直接作废。");
    return;
  }
  const actionText = unpaidCancellation ? "取消待付款订单并释放预留库存" : "作废订单并回补库存";
  if (!confirm(`确定${actionText} ${sale.id} 吗？`)) return;
  const voidedAt = new Date().toISOString();
  const actor = getCurrentActor();
  const hadInventoryConflict = requiresInventoryReview(sale);
  const adjustments = [];
  const nextProducts = products.map((product) => {
    const sold = (sale.items || []).find((item) => item.id === product.id);
    if (!sold) return product;
    const beforeStock = getBranchStock(product, sale.branchId || "hq");
    const afterStock = beforeStock + Number(sold.qty || 0);
    const updatedProduct = setBranchStock(product, sale.branchId || "hq", afterStock);
    const adjustment = {
      id: `VOID${Date.now()}-${product.id}`,
      createdAt: voidedAt,
      productId: product.id,
      productName: product.name,
      barcode: product.barcode,
      branchId: sale.branchId || "hq",
      branchName: sale.branchName || getBranchName(sale.branchId || "hq"),
      beforeStock,
      afterStock,
      delta: Number(sold.qty || 0),
      reason: hadInventoryConflict
        ? `库存冲突订单作废，本机回补（云端未扣减） ${sale.id}`
        : (unpaidCancellation ? `待付款订单取消，释放预留库存 ${sale.id}` : `订单作废回补 ${sale.id}`),
      cloudStockSyncMode: hadInventoryConflict ? "not-required" : "refund-transaction",
      operator: actor
    };
    adjustments.push(adjustment);
    return updatedProduct;
  });
  const updatedSale = attachIntegrationOutbox({
    ...sale,
    status: "voided",
    voidedAt,
    voidedBy: actor,
    inventoryReview: hadInventoryConflict ? {
      ...(sale.inventoryReview || {}),
      status: "resolved",
      resolvedAt: voidedAt,
      resolvedBy: actor,
      resolution: "order-voided"
    } : sale.inventoryReview,
    syncStatus: "pending-update"
  }, "void");
  const nextSales = sales.map((item) => item.id === saleId ? updatedSale : item);
  const nextPendingSales = pendingSales.filter((item) => item.id !== saleId);
  const nextPendingSaleUpdates = [
    updatedSale,
    ...pendingSaleUpdates.filter((item) => item.id !== saleId)
  ];
  const adjustmentIds = new Set(adjustments.map((adjustment) => adjustment.id));
  const nextStockAdjustments = [
    ...adjustments,
    ...stockAdjustments.filter((adjustment) => !adjustmentIds.has(adjustment.id))
  ].slice(0, 500);
  const nextPendingStockAdjustments = [
    ...adjustments,
    ...pendingStockAdjustments.filter((adjustment) => !adjustmentIds.has(adjustment.id))
  ];
  const voidSaved = saveStorageBatch([
    [STORAGE_KEYS.products, nextProducts],
    [STORAGE_KEYS.sales, nextSales],
    [STORAGE_KEYS.pendingSales, nextPendingSales],
    [STORAGE_KEYS.pendingSaleUpdates, nextPendingSaleUpdates],
    [STORAGE_KEYS.stockAdjustments, nextStockAdjustments],
    [STORAGE_KEYS.pendingStockAdjustments, nextPendingStockAdjustments]
  ]);
  if (!voidSaved) {
    alert(`${unpaidCancellation ? "取消" : "退款"}尚未执行：本机无法安全保存订单与库存，原订单保持原状态。`);
    return;
  }
  products = nextProducts;
  sales = nextSales;
  pendingSales = nextPendingSales;
  pendingSaleUpdates = nextPendingSaleUpdates;
  stockAdjustments = nextStockAdjustments;
  pendingStockAdjustments = nextPendingStockAdjustments;
  for (const adjustment of adjustments) {
    syncStockAdjustmentToCloud(adjustment);
  }
  syncVoidToCloud(updatedSale);
  writeAuditLog(unpaidCancellation ? "sale.payment-pending.cancel" : "sale.void", {
    saleId,
    branchId: sale.branchId || "hq",
    total: sale.total,
    inventoryConflictClosed: hadInventoryConflict
  });
  if (hadInventoryConflict) {
    alert("订单已作废并恢复本机库存。云端原本没有扣减这笔库存，因此系统不会用本机数量覆盖云端。");
  }
  renderAll();
}

function renderFollowUps() {
  if (!canUseOperations()) {
    els.followUpList.innerHTML = '<div class="empty compact-empty">请先登录分行员工账号</div>';
    return;
  }
  els.followUpList.innerHTML = "";
  const activePlans = getActiveSales()
    .filter((sale) => canManageBranch(sale.branchId || "hq"))
    .filter((sale) => sale.service?.endDate)
    .map((sale) => ({ ...sale, daysLeft: daysUntil(sale.service.endDate) }))
    .filter((sale) => sale.followUp?.status !== "completed")
    .filter((sale) => sale.daysLeft >= -7)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 10);

  if (!activePlans.length) {
    els.followUpList.innerHTML = '<div class="empty">暂无需要跟进的客户</div>';
    return;
  }

  for (const sale of activePlans) {
    const row = document.createElement("div");
    row.className = "management-row";
    const dueStatus = getFollowUpDueText(sale.daysLeft);
    const phone = sale.customer?.phone || "";
    const whatsappNumber = phone.replace(/[^0-9]/g, "");
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(sale.customer?.name || "未填写姓名")}</strong>
        <small>${escapeHtml(phone || "-")} · ${escapeHtml(sale.branchName || getBranchName(sale.branchId || "hq"))} · ${escapeHtml(dueStatus)} · ${escapeHtml(getFollowUpStatusText(sale))}</small>
      </div>
      <div class="row-actions">
        ${whatsappNumber ? `<a class="ghost small-link" href="https://wa.me/${escapeHtml(whatsappNumber)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
        <button class="ghost" type="button" data-followup="contacted">已联系</button>
        <button class="ghost" type="button" data-followup="completed">已完成</button>
      </div>
    `;
    for (const button of row.querySelectorAll("[data-followup]")) {
      button.addEventListener("click", () => updateSaleFollowUp(sale.id, button.dataset.followup));
    }
    els.followUpList.append(row);
  }
}

function renderLowStock() {
  if (!canUseOperations()) return;
  els.lowStockList.innerHTML = "";
  const lowStockItems = [];
  const threshold = Number(appSettings.lowStockThreshold ?? 5);
  for (const product of products) {
    for (const branch of branches) {
      if (!canManageBranch(branch.id)) continue;
      const stock = getBranchStock(product, branch.id);
      if (stock <= threshold) {
        lowStockItems.push({ product, branch, stock });
      }
    }
  }

  if (!lowStockItems.length) {
    els.lowStockList.innerHTML = '<div class="empty">暂无低库存商品</div>';
    return;
  }

  for (const item of lowStockItems.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "management-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.product.name)}</strong>
        <small>${escapeHtml(item.branch.name)} · SKU ${escapeHtml(item.product.barcode || "-")}</small>
      </div>
      <small>库存 ${item.stock} / 阈值 ${threshold}</small>
    `;
    els.lowStockList.append(row);
  }
}

function renderCategoryFilter() {
  const selected = els.categoryFilter.value || "all";
  const categories = [...new Set(products.map((product) => product.category))].sort();
  els.categoryFilter.innerHTML = '<option value="all">全部分类</option>';
  els.categoryRail.innerHTML = "";
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = selected === "all" ? "active" : "";
  allButton.textContent = "全部分类";
  allButton.addEventListener("click", () => {
    els.categoryFilter.value = "all";
    renderProducts();
    renderCategoryFilter();
  });
  els.categoryRail.append(allButton);
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.categoryFilter.append(option);

    const button = document.createElement("button");
    button.type = "button";
    button.className = selected === category ? "active" : "";
    button.textContent = category;
    button.addEventListener("click", () => {
      els.categoryFilter.value = category;
      renderProducts();
      renderCategoryFilter();
    });
    els.categoryRail.append(button);
  }
  els.categoryFilter.value = categories.includes(selected) ? selected : "all";
}

function renderProducts() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const category = els.categoryFilter.value;
  const filtered = products.filter((product) => {
    const matchKeyword = [product.name, product.barcode].some((value) =>
      String(value || "").toLowerCase().includes(keyword)
    );
    const matchCategory = category === "all" || product.category === category;
    return matchKeyword && matchCategory;
  });

  els.productGrid.innerHTML = "";
  if (!filtered.length) {
    els.productGrid.innerHTML = '<div class="empty">没有找到商品</div>';
    return;
  }

  for (const product of filtered) {
    const branchStock = getBranchStock(product);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "product-card";
    card.disabled = branchStock <= 0;
    card.innerHTML = `
      <strong>${escapeHtml(product.name)}</strong>
      <span class="product-meta">${escapeHtml(product.category)} · ${escapeHtml(getBranchName(currentBranchId))}库存 ${branchStock}</span>
      <span class="product-meta">条码 ${escapeHtml(product.barcode || "-")}</span>
      <span class="price">${money(product.price)}</span>
    `;
    card.addEventListener("click", () => addToCart(product.id));
    els.productGrid.append(card);
  }
}

function addToCart(productId) {
  const product = products.find((item) => item.id === productId);
  const existing = cart.find((item) => item.id === productId);
  const currentQty = existing ? existing.qty : 0;
  if (product?.affiliatePlanId && currentQty >= 1) {
    alert("联盟配套每张订单只能选择一个单位；多个单位请分别下单。");
    return;
  }
  if (!product || currentQty >= getBranchStock(product)) {
    alert("库存不足，不能继续添加。");
    return;
  }
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      barcode: product.barcode || "",
      category: product.category || "",
      affiliatePlanId: product.affiliatePlanId || "",
      price: product.price,
      qty: 1,
      branchId: currentBranchId
    });
  }
  renderCart();
}

function renderCart() {
  els.cartItems.innerHTML = "";
  els.cartHint.textContent = cart.length ? `${cart.length} 种商品` : "还没有商品";

  if (!cart.length) {
    els.cartItems.innerHTML = '<div class="empty">点击左侧商品开始收银</div>';
  }

  for (const item of cart) {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-top">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${money(item.price * item.qty)}</span>
      </div>
      <div class="qty-row">
        <button type="button" aria-label="减少">-</button>
        <span>${item.qty} x ${money(item.price)}</span>
        <button type="button" aria-label="增加">+</button>
        <button type="button" class="ghost danger">删除</button>
      </div>
    `;
    const [minusBtn, plusBtn, removeBtn] = row.querySelectorAll("button");
    minusBtn.addEventListener("click", () => updateCartQty(item.id, item.qty - 1));
    plusBtn.addEventListener("click", () => updateCartQty(item.id, item.qty + 1));
    removeBtn.addEventListener("click", () => updateCartQty(item.id, 0));
    els.cartItems.append(row);
  }

  if (!cart.length) {
    els.paidInput.value = "";
    autoFillPaid = true;
  } else if (autoFillPaid) {
    els.paidInput.value = getCartDueAmount().toFixed(2);
  }
  const totals = getCartTotals();
  els.subtotalText.textContent = money(totals.subtotal);
  els.totalText.textContent = money(totals.total);
  els.changeText.textContent = money(totals.change);
  updatePaymentPreview();
  const exactPaidButton = els.quickPaidButtons?.querySelector('[data-quick-paid="due"]');
  if (exactPaidButton) exactPaidButton.textContent = totals.total > 0 ? totals.total.toFixed(2) : "刚好";
  for (const button of els.quickPaymentButtons.querySelectorAll("[data-payment-method]")) {
    button.classList.toggle("active", button.dataset.paymentMethod === els.paymentMethodInput.value);
  }
  els.checkoutBtn.disabled = !cart.length;
}

function updateCartQty(productId, nextQty) {
  const product = products.find((item) => item.id === productId);
  if (nextQty <= 0) {
    cart = cart.filter((item) => item.id !== productId);
  } else if (product && nextQty <= getBranchStock(product)) {
    cart = cart.map((item) => item.id === productId ? { ...item, qty: nextQty } : item);
  } else {
    alert("库存不足。");
  }
  renderCart();
}

function getCartTotals() {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = Math.max(0, Number(els.discountInput.value || 0));
  const total = getCartDueAmount();
  const paid = Number(els.paidInput.value || 0);
  return { subtotal, discount, total, paid, change: Math.max(0, paid - total) };
}

function getCartDueAmount() {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = Math.max(0, Number(els.discountInput.value || 0));
  return Math.max(0, subtotal - discount);
}

function needsPaymentReference(method) {
  return method !== "现金" && method !== "简单支付 / SimplePay";
}

function requireAffiliateCustomerPhone() {
  const hasAffiliateItems = Boolean(window.integrationContract?.hasAffiliateItems(cart));
  if (!hasAffiliateItems || els.customerPhoneInput.value.trim()) return true;
  if (els.paymentDialog.open) els.paymentDialog.close();
  els.orderOptionsPanel.classList.remove("hidden");
  alert("购买联盟配套必须填写客户电话，以便匹配联盟账号；推荐码仍可选填。");
  els.customerPhoneInput.focus();
  return false;
}

function updatePaymentPreview() {
  const totals = getCartTotals();
  if (els.paymentDueText) els.paymentDueText.textContent = money(totals.total);
  if (els.paymentChangePreview) els.paymentChangePreview.textContent = money(totals.change);
}

function openPaymentDialog() {
  if (!cart.length) return;
  if (!requireOperator()) return;
  if (!requireAffiliateCustomerPhone()) return;
  if (!ensureCurrentShift()) return;
  autoFillPaid = true;
  els.customPaidPanel.classList.add("hidden");
  renderCart();
  updatePaymentPreview();
  els.paymentDialog.showModal();
}

async function checkout() {
  if (checkoutInProgress) return;
  if (!cart.length) return;
  if (!requireOperator()) return;
  if (!requireAffiliateCustomerPhone()) return;
  const totals = getCartTotals();
  const paymentMethod = els.paymentMethodInput.value;
  const paymentReference = els.paymentReferenceInput.value.trim();
  const simplePayPending = paymentMethod === "简单支付 / SimplePay" && !paymentReference;
  if (!simplePayPending && totals.paid < totals.total) {
    alert("实收金额不足。");
    els.paidInput.focus();
    return;
  }
  if (needsPaymentReference(paymentMethod) && !paymentReference && !confirm("这个付款方式建议填写参考号。确定继续收款吗？")) {
    els.paymentReferenceInput.focus();
    return;
  }
  if (!ensureCurrentShift()) return;
  checkoutInProgress = true;
  els.confirmPaymentBtn.disabled = true;
  els.confirmPaymentBtn.textContent = "正在保存订单...";
  try {
    const cashier = getActiveCashier();

    const createdAt = new Date();
    const serviceEnd = new Date(createdAt);
    serviceEnd.setDate(serviceEnd.getDate() + Number(appSettings.serviceDays || 21));

    const saleId = createPosOrderId();
    const affiliateReferralCode = els.affiliateReferralCodeInput.value.trim().toUpperCase();
    const affiliateEligible = Boolean(window.integrationContract?.hasAffiliateItems(cart));
    const sale = attachIntegrationOutbox({
    id: saleId,
    createdAt: createdAt.toISOString(),
    branchId: currentBranchId,
    branchName: getBranchName(currentBranchId),
    operator: cashier,
    shiftId: currentShift?.id || "",
    customer: {
      name: els.customerNameInput.value.trim(),
      phone: els.customerPhoneInput.value.trim(),
      referralCode: affiliateReferralCode
    },
    service: {
      name: appSettings.defaultServiceName,
      startDate: createdAt.toISOString(),
      endDate: serviceEnd.toISOString(),
      durationDays: Number(appSettings.serviceDays || 21)
    },
    items: structuredClone(cart),
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    paid: simplePayPending ? 0 : totals.paid,
    change: simplePayPending ? 0 : totals.change,
    payment: {
      method: paymentMethod,
      reference: paymentReference
    },
    externalReferences: {
      posOrderId: saleId,
      simplePayReference: paymentMethod === "简单支付 / SimplePay" ? paymentReference : "",
      simplePayStatus: paymentMethod === "简单支付 / SimplePay"
        ? (paymentReference ? "linked" : "pending")
        : "not-used",
      affiliateReferralCode,
      affiliateOrderId: "",
      affiliateStatus: affiliateEligible ? "pending" : "not-used"
    },
    status: simplePayPending ? "payment-pending" : "completed",
    syncStatus: navigator.onLine && hasCloud() ? "queued" : "pending"
    }, "checkout");

    const changedProducts = [];
    const nextProducts = products.map((product) => {
      const sold = sale.items.find((item) => item.id === product.id);
      if (!sold) return product;
      const updatedProduct = setBranchStock(product, currentBranchId, getBranchStock(product) - sold.qty);
      changedProducts.push(updatedProduct);
      return updatedProduct;
    });
    const nextSales = [sale, ...sales];
    const nextPendingSales = [
      { ...sale, syncStatus: "pending" },
      ...pendingSales.filter((item) => item.id !== sale.id)
    ];
    const checkoutSaved = saveStorageBatch([
      [STORAGE_KEYS.products, nextProducts],
      [STORAGE_KEYS.sales, nextSales],
      [STORAGE_KEYS.pendingSales, nextPendingSales]
    ]);
    if (!checkoutSaved) {
      alert("收款尚未完成：本机无法安全保存订单。购物车和库存都没有改变，请先处理浏览器储存空间后重试。");
      return;
    }
    products = nextProducts;
    sales = nextSales;
    pendingSales = nextPendingSales;
    cart = [];
    els.customerNameInput.value = "";
    els.customerPhoneInput.value = "";
    els.affiliateReferralCodeInput.value = "";
    els.discountInput.value = "0";
    els.paidInput.value = "";
    els.paymentReferenceInput.value = "";
    autoFillPaid = true;
    if (!hasCloud() || !window.cloudPOS.saveCheckout) {
      for (const product of changedProducts) {
        syncProductToCloud(product);
      }
    }
    if (els.paymentDialog.open) els.paymentDialog.close();
    showReceipt(sale);
    renderAll();
    syncSaleToCloud(sale).then(async () => {
      await syncPendingSaleUpdates();
      renderSales();
    });
  } finally {
    checkoutInProgress = false;
    els.confirmPaymentBtn.disabled = false;
    els.confirmPaymentBtn.textContent = "确认收款";
  }
}

function showReceipt(sale) {
  lastReceiptSale = sale;
  renderReceiptContent(sale);
  els.receiptDialog.showModal();
  if (printerSettings.autoPrint && window.thermalPrinter?.isConnected()) {
    printBluetoothReceipt(sale, true);
  }
}

function renderReceiptContent(sale) {
  const simplePayCode = getSimplePayIntentCode(sale);
  els.receiptTitle.textContent = simplePayCode ? "等待顾客付款" : "收款成功";
  els.receiptNo.textContent = `订单号：${sale.id}`;
  els.receiptText.textContent = buildReceipt(sale);
  els.receiptSimplePayPanel.classList.toggle("hidden", !simplePayCode);
  els.receiptCheckPaymentBtn.classList.toggle("hidden", !isSalePaymentPending(sale));
  els.receiptPaymentStatus.classList.add("hidden");
  els.receiptPaymentStatus.classList.remove("error");
  els.receiptPaymentStatus.textContent = "";
  if (simplePayCode) {
    els.receiptSimplePayQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(simplePayCode)}`;
    els.receiptSimplePayIntent.textContent = window.integrationContract.jobId(sale.id, "simplepay.payment");
  } else {
    els.receiptSimplePayQr.removeAttribute("src");
    els.receiptSimplePayIntent.textContent = "";
  }
}

async function refreshSimplePayPayment(saleId, button = null) {
  const sale = sales.find((item) => item.id === saleId);
  if (!sale || !isSalePaymentPending(sale)) return false;
  if (!navigator.onLine || !hasCloud() || !window.cloudPOS.loadSale) {
    alert("当前无法读取云端付款状态。请联网并使用 Google 登录后重试。");
    return false;
  }
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "正在检查";
  }
  if (els.receiptDialog.open && lastReceiptSale?.id === saleId) {
    els.receiptPaymentStatus.classList.remove("hidden", "error");
    els.receiptPaymentStatus.textContent = "正在读取这张订单的付款状态...";
  }
  try {
    if (pendingSales.some((item) => item.id === saleId)) {
      const syncResult = await syncSaleToCloud(sale);
      if (!syncResult.ok) throw new Error("订单尚未同步云端");
    }
    const cloudSale = await window.cloudPOS.loadSale(saleId);
    if (!cloudSale) throw new Error("云端尚未找到这张订单");
    if (!canManageBranch(cloudSale.branchId || "hq")) {
      throw new Error("当前账号无权读取这张订单");
    }
    if (!isSalePaymentPending(cloudSale)) {
      const updatedSale = normalizeSaleExternalReferences({
        ...sale,
        ...cloudSale,
        syncStatus: "synced"
      });
      const nextSales = sales.map((item) => item.id === saleId ? updatedSale : item);
      const nextPendingSales = pendingSales.filter((item) => item.id !== saleId);
      const saved = saveStorageBatch([
        [STORAGE_KEYS.sales, nextSales],
        [STORAGE_KEYS.pendingSales, nextPendingSales]
      ]);
      if (!saved) throw new Error("本机无法安全保存付款结果");
      sales = nextSales;
      pendingSales = nextPendingSales;
      lastReceiptSale = updatedSale;
      if (els.receiptDialog.open) {
        renderReceiptContent(updatedSale);
        els.receiptPaymentStatus.classList.remove("hidden", "error");
        els.receiptPaymentStatus.textContent = "SimplePay 付款已确认，订单已计入销售。";
      }
      renderAll();
      return true;
    }
    if (els.receiptDialog.open && lastReceiptSale?.id === saleId) {
      els.receiptPaymentStatus.classList.remove("hidden", "error");
      els.receiptPaymentStatus.textContent = "尚未收到付款确认，库存继续预留。";
    } else {
      alert("尚未收到 SimplePay 付款确认，库存继续预留。");
    }
    return false;
  } catch (error) {
    const message = `检查付款失败：${error.message || "请稍后重试"}`;
    if (els.receiptDialog.open && lastReceiptSale?.id === saleId) {
      els.receiptPaymentStatus.classList.remove("hidden");
      els.receiptPaymentStatus.classList.add("error");
      els.receiptPaymentStatus.textContent = message;
    } else {
      alert(message);
    }
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function getSimplePayIntentCode(sale) {
  if (
    sale.payment?.method !== "简单支付 / SimplePay"
    || sale.externalReferences?.simplePayReference
    || !window.integrationContract
  ) return "";
  const intentId = window.integrationContract.jobId(sale.id, "simplepay.payment");
  return `oneminpay://pos?intentId=${encodeURIComponent(intentId)}`;
}

function buildReceipt(sale) {
  const lines = [
    appSettings.businessName,
    `订单号：${sale.id}`,
    `分行：${sale.branchName || getBranchName(sale.branchId || "hq")}`,
    `收银员：${sale.operator?.name || "-"}`,
    `时间：${new Date(sale.createdAt).toLocaleString()}`,
    `客户：${sale.customer?.name || "-"}`,
    `电话：${sale.customer?.phone || "-"}`,
    `计划周期：${formatDate(new Date(sale.service.startDate))} 至 ${formatDate(new Date(sale.service.endDate))}`,
    "------------------------------"
  ];
  if (sale.customer?.referralCode) lines.splice(7, 0, `推荐码：${sale.customer.referralCode}`);
  for (const item of sale.items) {
    lines.push(`${item.name} x${item.qty}  ${money(item.price * item.qty)}`);
  }
  lines.push("------------------------------");
  lines.push(`小计：${money(sale.subtotal)}`);
  lines.push(`折扣：${money(sale.discount)}`);
  lines.push(`应收：${money(sale.total)}`);
  const simplePayPending = Boolean(getSimplePayIntentCode(sale));
  lines.push(`实收：${simplePayPending ? "待确认" : money(sale.paid)}`);
  lines.push(`找零：${simplePayPending ? "-" : money(sale.change)}`);
  lines.push(`付款方式：${sale.payment?.method || "现金"}`);
  if (sale.payment?.reference) lines.push(`参考号：${sale.payment.reference}`);
  const simplePayCode = getSimplePayIntentCode(sale);
  if (simplePayCode) {
    lines.push("付款状态：等待顾客在 SimplePay 确认");
    lines.push(`SimplePay付款码：${simplePayCode}`);
  }
  lines.push(appSettings.receiptFooter);
  return lines.join("\n");
}

function savePrinterSettings() {
  printerSettings = {
    ...printerSettings,
    paperWidth: els.printerPaperWidth.value === "80" ? "80" : "58",
    autoPrint: els.printerAutoPrint.checked
  };
  save(STORAGE_KEYS.printerSettings, printerSettings);
}

function updatePrinterStatus(message, state = "idle") {
  if (els.printerStatus) {
    els.printerStatus.textContent = message;
    els.printerStatus.classList.toggle("error", state === "error");
  }
  if (els.receiptPrinterStatus) {
    els.receiptPrinterStatus.textContent = message;
    els.receiptPrinterStatus.style.color = state === "error" ? "var(--danger)" : "";
  }
}

function getBluetoothErrorMessage(error) {
  if (error?.name === "NotFoundError") return "未选择打印机";
  if (error?.name === "NotAllowedError") return "蓝牙权限未获允许";
  if (error?.name === "NetworkError") return "打印机连接中断，请确认打印机已开机并靠近设备";
  return error?.message || "蓝牙打印失败";
}

async function pairBluetoothPrinter() {
  try {
    updatePrinterStatus("正在等待选择打印机...");
    const info = await window.thermalPrinter.pair();
    printerSettings.deviceId = info.id;
    printerSettings.deviceName = info.name;
    savePrinterSettings();
    updatePrinterStatus(`${info.name || "蓝牙打印机"} 已连接`, "connected");
  } catch (error) {
    updatePrinterStatus(getBluetoothErrorMessage(error), "error");
  }
  renderPrinterSettings();
}

async function reconnectBluetoothPrinter() {
  try {
    updatePrinterStatus("正在连接打印机...");
    const info = await window.thermalPrinter.reconnect(printerSettings.deviceId);
    printerSettings.deviceId = info.id;
    printerSettings.deviceName = info.name;
    savePrinterSettings();
  } catch (error) {
    updatePrinterStatus(getBluetoothErrorMessage(error), "error");
  }
  renderPrinterSettings();
}

async function forgetBluetoothPrinter() {
  try {
    await window.thermalPrinter?.forget();
  } catch (error) {
    console.warn("Bluetooth printer forget failed", error);
  }
  printerSettings.deviceId = "";
  printerSettings.deviceName = "";
  savePrinterSettings();
  updatePrinterStatus("尚未连接打印机");
  renderPrinterSettings();
}

async function ensureBluetoothPrinter() {
  if (!window.thermalPrinter?.isSupported()) {
    throw new Error("此浏览器不支持蓝牙直连，请使用 Android 或电脑的 Chrome / Edge");
  }
  if (window.thermalPrinter.isConnected()) return;
  if (printerSettings.deviceId) {
    await window.thermalPrinter.reconnect(printerSettings.deviceId);
    return;
  }
  const info = await window.thermalPrinter.pair();
  printerSettings.deviceId = info.id;
  printerSettings.deviceName = info.name;
  savePrinterSettings();
}

async function printBluetoothLines(lines) {
  await ensureBluetoothPrinter();
  await window.thermalPrinter.printLines(lines, printerSettings.paperWidth);
}

async function printBluetoothReceipt(sale = lastReceiptSale, automatic = false) {
  if (!sale) {
    updatePrinterStatus("没有可打印的小票", "error");
    return;
  }
  if (automatic && !window.thermalPrinter?.isConnected()) return;
  try {
    els.bluetoothPrintReceiptBtn.disabled = true;
    await printBluetoothLines(buildReceipt(sale).split("\n"));
  } catch (error) {
    updatePrinterStatus(getBluetoothErrorMessage(error), "error");
  } finally {
    els.bluetoothPrintReceiptBtn.disabled = false;
    renderPrinterSettings();
  }
}

async function testBluetoothPrinter() {
  const lines = [
    appSettings.businessName,
    "蓝牙打印测试",
    "中文 / English / 123456",
    `纸宽：${printerSettings.paperWidth}mm`,
    new Date().toLocaleString(),
    "打印正常"
  ];
  try {
    els.printerTestBtn.disabled = true;
    await printBluetoothLines(lines);
  } catch (error) {
    updatePrinterStatus(getBluetoothErrorMessage(error), "error");
  } finally {
    renderPrinterSettings();
  }
}

function renderSales() {
  if (!showAllSalesDates && !els.salesDateInput.value) els.salesDateInput.value = inputDate();
  const selectedDate = els.salesDateInput.value;
  const keyword = els.salesSearchInput.value.trim().toLowerCase();
  const branchFilter = els.salesBranchFilter.value || (isAdmin() ? "all" : getOperationalBranchId());
  const paymentFilter = els.salesPaymentFilter.value;
  const integrationFilter = els.salesIntegrationFilter.value;
  const integrationIssues = getIntegrationIssues(
    getActiveSales().filter((sale) => canManageBranch(sale.branchId || "hq"))
  );
  const integrationIssueSaleIds = new Set(integrationIssues.flatMap((issue) => issue.saleIds));
  const selectedSales = sales.filter((sale) => {
    if (!canManageBranch(sale.branchId || "hq")) return false;
    if (branchFilter !== "all" && (sale.branchId || "hq") !== branchFilter) return false;
    const matchDate = showAllSalesDates || inputDate(new Date(sale.createdAt)) === selectedDate;
    if (!matchDate) return false;
    if (paymentFilter !== "all" && (sale.payment?.method || "现金") !== paymentFilter) return false;
    if (!matchesIntegrationFilter(sale, integrationFilter, integrationIssueSaleIds)) return false;
    if (!keyword) return true;
    const haystack = [
      sale.id,
      sale.customer?.name,
      sale.customer?.phone,
      sale.customer?.referralCode,
      sale.branchName,
      sale.operator?.name,
      ...(sale.items || []).map((item) => item.name)
    ].join(" ").toLowerCase();
    return haystack.includes(keyword);
  });
  const completedSelectedSales = getActiveSales(selectedSales);
  const total = completedSelectedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const pendingPaymentCount = selectedSales.filter(isSalePaymentPending).length;
  const dateLabel = showAllSalesDates ? "全部日期" : selectedDate;
  els.salesSummary.textContent = selectedSales.length
    ? `${dateLabel} · ${completedSelectedSales.length} 单已收款，共 ${money(total)}${pendingPaymentCount ? ` · ${pendingPaymentCount} 单待付款` : ""}`
    : `${dateLabel} · 暂无销售`;
  els.todaySalesBtn.classList.toggle("active", !showAllSalesDates && selectedDate === inputDate());
  els.allSalesDatesBtn.classList.toggle("active", showAllSalesDates);
  els.salesList.innerHTML = "";
  renderDailyPaymentSummary(selectedSales);

  if (!selectedSales.length) {
    els.salesList.innerHTML = '<div class="empty">完成收款后这里会出现销售记录</div>';
    els.toggleSalesLimitBtn.classList.add("hidden");
    return;
  }

  const visibleSales = selectedSales.slice(0, showMoreSales ? 50 : 8);
  els.toggleSalesLimitBtn.classList.toggle("hidden", selectedSales.length <= 8);
  els.toggleSalesLimitBtn.textContent = showMoreSales ? "显示较少" : `显示更多（共 ${selectedSales.length} 笔）`;

  for (const sale of visibleSales) {
    const row = document.createElement("div");
    row.className = "sale-item";
    row.classList.toggle("voided", isSaleVoided(sale));
    row.classList.toggle("payment-pending", isSalePaymentPending(sale));
    row.innerHTML = `
      <div class="sale-item-top">
        <strong>${isSaleVoided(sale) ? "已作废" : money(sale.total)}</strong>
        <span>${new Date(sale.createdAt).toLocaleTimeString()}</span>
      </div>
      <span class="product-meta">状态：${getSaleStatusText(sale)}</span>
      <span class="product-meta">分行：${escapeHtml(sale.branchName || getBranchName(sale.branchId || "hq"))}</span>
      <span class="product-meta">收银员：${escapeHtml(sale.operator?.name || "-")}</span>
      <span class="product-meta">班次：${escapeHtml(sale.shiftId || "-")}</span>
      <span class="product-meta">同步：${getSaleSyncText(sale)}</span>
      <span class="product-meta">付款：${escapeHtml(sale.payment?.method || "现金")}${sale.payment?.reference ? ` · ${escapeHtml(sale.payment.reference)}` : ""}</span>
      <span class="product-meta">客户：${escapeHtml(sale.customer?.name || "-")} ${escapeHtml(sale.customer?.phone || "")}</span>
      ${sale.customer?.referralCode ? `<span class="product-meta">联盟推荐码：${escapeHtml(sale.customer.referralCode)}</span>` : ""}
      <span class="product-meta">关联：${escapeHtml(getSaleIntegrationSummary(sale))}</span>
      <span class="product-meta">${(sale.items || []).map((item) =>
        `${escapeHtml(item.name || "-")} x${Number(item.qty || 0)}`
      ).join("，")}</span>
      ${requiresInventoryReview(sale) ? `<div class="settlement-warning"><strong>库存待复核</strong><br>${escapeHtml(getInventoryConflictSummary(sale))}</div>` : ""}
      ${isAdmin() ? '<button class="ghost" type="button" data-edit-integration>关联资料</button>' : ""}
      ${isSalePaymentPending(sale) ? '<button class="primary" type="button" data-check-payment>检查付款状态</button>' : ""}
      ${requiresInventoryReview(sale) ? '<button class="ghost" type="button" data-open-inventory-review>前往库存核对</button><button class="primary" type="button" data-resolve-inventory-review>确认库存已复核</button>' : ""}
      ${canVoidSale(sale) ? `<button class="ghost danger" type="button" data-void-sale>${isSalePaymentPending(sale) ? "取消待付款并释放库存" : "退款 / 作废并回补库存"}</button>` : ""}
    `;
    row.querySelector("[data-edit-integration]")?.addEventListener("click", () => openIntegrationEditor(sale.id));
    const paymentCheckButton = row.querySelector("[data-check-payment]");
    if (paymentCheckButton) paymentCheckButton.addEventListener("click", () => refreshSimplePayPayment(sale.id, paymentCheckButton));
    const inventoryButton = row.querySelector("[data-open-inventory-review]");
    if (inventoryButton) inventoryButton.addEventListener("click", () => openInventoryForReview(sale.id));
    const resolveButton = row.querySelector("[data-resolve-inventory-review]");
    if (resolveButton) resolveButton.addEventListener("click", () => resolveInventoryReview(sale.id));
    const voidButton = row.querySelector("[data-void-sale]");
    if (voidButton) voidButton.addEventListener("click", () => voidSale(sale.id));
    els.salesList.append(row);
  }
}

function renderDailyPaymentSummary(selectedSales) {
  const activeSelectedSales = getActiveSales(selectedSales);
  const nonVoidedSelectedSales = getNonVoidedSales(selectedSales);
  const voidedSelectedSales = selectedSales.filter(isSaleVoided);
  const pendingPaymentSales = selectedSales.filter(isSalePaymentPending);
  const paymentRows = getPaymentSummaryRows(activeSelectedSales);
  els.dailyPaymentSummaryList.innerHTML = "";
  if (!paymentRows.length && !voidedSelectedSales.length && !pendingPaymentSales.length) {
    els.dailyPaymentSummaryList.innerHTML = '<div class="empty compact-empty">当前筛选没有结算资料</div>';
    return;
  }
  for (const item of paymentRows) {
    const row = document.createElement("div");
    row.className = "management-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.method)}</strong>
        <small>${item.orders} 单</small>
      </div>
      <small>${money(item.total)}</small>
    `;
    els.dailyPaymentSummaryList.append(row);
  }
  const visibleIds = new Set(selectedSales.map((sale) => sale.id));
  const pendingOrderCount = new Set(
    [...pendingSales, ...pendingSaleUpdates]
      .filter((sale) => visibleIds.has(sale.id))
      .map((sale) => sale.id)
  ).size;
  const references = nonVoidedSelectedSales.map((sale) => normalizeSaleExternalReferences(sale).externalReferences);
  const simplePayPending = references.filter((item) => item.simplePayStatus === "pending").length;
  const affiliatePending = references.filter((item) => item.affiliateStatus === "pending").length;
  const inventoryReviewCount = selectedSales.filter(requiresInventoryReview).length;
  const alerts = [
    voidedSelectedSales.length ? `作废 ${voidedSelectedSales.length} 单（原金额 ${money(voidedSelectedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0))}）` : "",
    pendingPaymentSales.length ? `待付款 ${pendingPaymentSales.length} 单（${money(pendingPaymentSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0))}，不计入收入）` : "",
    pendingOrderCount ? `待同步 ${pendingOrderCount} 单` : "",
    simplePayPending ? `SimplePay 待确认 ${simplePayPending} 单` : "",
    affiliatePending ? `联盟待关联 ${affiliatePending} 单` : "",
    inventoryReviewCount ? `库存待复核 ${inventoryReviewCount} 单` : ""
  ].filter(Boolean);
  if (alerts.length) {
    const row = document.createElement("div");
    row.className = "management-row diagnostic-warning";
    row.innerHTML = `
      <div>
        <strong>对账提醒</strong>
        <small>${escapeHtml(alerts.join(" · "))}</small>
      </div>
      <span>待处理</span>
    `;
    els.dailyPaymentSummaryList.append(row);
  }
}

function renderGlobalDashboard() {
  if (!canAccessView("report")) return;
  ensureReportRange();
  const reportSales = getReportSales();
  const totalRevenue = reportSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const customers = new Set(
    reportSales
      .map((sale) => `${sale.customer?.phone || ""}-${sale.customer?.name || ""}`.trim())
      .filter(Boolean)
  );

  els.globalRevenueText.textContent = money(totalRevenue);
  els.globalOrdersText.textContent = String(reportSales.length);
  els.reportRevenueLabel.textContent = isAdmin() ? "全局销售额" : "本分行销售额";
  els.reportOrdersLabel.textContent = isAdmin() ? "全局订单" : "本分行订单";
  els.globalCustomersText.textContent = String(customers.size);
  els.globalStockText.textContent = String(getReportStock());
  els.branchOverview.innerHTML = "";

  for (const branch of getAccessibleBranches()) {
    const branchSales = reportSales.filter((sale) => (sale.branchId || "hq") === branch.id);
    const revenue = branchSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const branchCustomers = new Set(
      branchSales
        .map((sale) => `${sale.customer?.phone || ""}-${sale.customer?.name || ""}`.trim())
        .filter(Boolean)
    );
    const row = document.createElement("div");
    row.className = "branch-row";
    row.innerHTML = `
      <strong>${escapeHtml(branch.name)}</strong>
      <span>销售额 ${money(revenue)}</span>
      <span>订单 ${branchSales.length}</span>
      <span>客户 ${branchCustomers.size}</span>
    `;
    els.branchOverview.append(row);
  }

  const productRows = getProductSalesRows(reportSales).slice(0, 8);
  els.topProductsList.innerHTML = "";
  if (!productRows.length) {
    els.topProductsList.innerHTML = '<div class="empty">当前日期范围暂无商品销售</div>';
  } else {
    for (const item of productRows) {
      const row = document.createElement("div");
      row.className = "management-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <small>销量 ${item.qty}</small>
        </div>
        <small>${money(item.revenue)}</small>
      `;
      els.topProductsList.append(row);
    }
  }

  const dailyRows = getDailySalesRows(reportSales).slice(0, 10);
  els.dailyTrendList.innerHTML = "";
  if (!dailyRows.length) {
    els.dailyTrendList.innerHTML = '<div class="empty">当前日期范围暂无每日趋势</div>';
  } else {
    for (const item of dailyRows) {
      const row = document.createElement("div");
      row.className = "management-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(item.day)}</strong>
          <small>${item.orders} 单</small>
        </div>
        <small>${money(item.revenue)}</small>
      `;
      els.dailyTrendList.append(row);
    }
  }

  const paymentRows = getPaymentSummaryRows(reportSales);
  els.paymentSummaryList.innerHTML = "";
  if (!paymentRows.length) {
    els.paymentSummaryList.innerHTML = '<div class="empty">当前日期范围暂无付款资料</div>';
  } else {
    for (const item of paymentRows) {
      const row = document.createElement("div");
      row.className = "management-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(item.method)}</strong>
          <small>${item.orders} 单</small>
        </div>
        <small>${money(item.total)}</small>
      `;
      els.paymentSummaryList.append(row);
    }
  }
}

function saveProduct(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const normalizedProducts = products.map((item) => normalizeProductBranches(item));
  const product = {
    id: editingProductId || createId(),
    name: els.nameInput.value.trim(),
    barcode: els.barcodeInput.value.trim(),
    category: els.categoryInput.value.trim(),
    price: Number(els.priceInput.value),
    stock: 0,
    branchStock: createBranchStock(0, currentBranchId)
  };
  if (!product.name || !product.category || !Number.isFinite(product.price) || product.price < 0) {
    alert("请检查商品信息。");
    return;
  }

  const barcodeConflict = product.barcode && normalizedProducts.find((item) =>
    item.barcode === product.barcode && item.id !== editingProductId
  );
  if (barcodeConflict) {
    alert(`条码 / SKU 已由“${barcodeConflict.name}”使用。`);
    return;
  }
  const existingProduct = normalizedProducts.find((item) => item.id === editingProductId);
  let savedProduct = product;
  let nextProducts;
  if (existingProduct) {
    nextProducts = normalizedProducts.map((item) => {
      if (item.id !== existingProduct.id) return item;
      savedProduct = {
        ...item,
        name: product.name,
        barcode: product.barcode,
        category: product.category,
        price: product.price
      };
      savedProduct = normalizeProductBranches(savedProduct);
      return savedProduct;
    });
  } else {
    savedProduct = normalizeProductBranches(product);
    nextProducts = [savedProduct, ...normalizedProducts];
  }
  if (!save(STORAGE_KEYS.products, nextProducts)) return;
  products = nextProducts;
  syncProductToCloud(savedProduct);
  writeAuditLog("product.save", {
    productId: savedProduct.id,
    productName: savedProduct.name,
    barcode: savedProduct.barcode,
    price: savedProduct.price
  });
  resetProductFormEditor();
  renderAll();
}

function exportSales() {
  if (!requireOperations()) return;
  const accessibleSales = sales.filter((sale) => canManageBranch(sale.branchId || "hq"));
  if (!accessibleSales.length) {
    alert("还没有销售记录可以导出。");
    return;
  }
  const rows = [["订单号", "外部订单号", "班次号", "状态", "作废时间", "分行", "收银员", "收银员邮箱", "同步状态", "库存复核状态", "库存冲突详情", "库存复核人", "时间", "客户姓名", "电话", "联盟推荐码", "付款方式", "付款参考号", "SimplePay参考号", "联盟订单号", "跟进状态", "跟进更新时间", "计划名称", "服务天数", "计划开始", "计划结束", "商品", "小计", "折扣", "应收", "实收", "找零"]];
  for (const sale of accessibleSales) {
    rows.push([
      sale.id,
      sale.externalReferences?.posOrderId || sale.id,
      sale.shiftId || "",
      getSaleStatusText(sale),
      sale.voidedAt ? new Date(sale.voidedAt).toLocaleString() : "",
      sale.branchName || getBranchName(sale.branchId || "hq"),
      sale.operator?.name || "",
      sale.operator?.email || "",
      getSaleSyncText(sale),
      getInventoryReviewStatus(sale),
      requiresInventoryReview(sale) ? getInventoryConflictSummary(sale) : "",
      sale.inventoryReview?.resolvedBy?.email || "",
      new Date(sale.createdAt).toLocaleString(),
      sale.customer?.name || "",
      sale.customer?.phone || "",
      sale.customer?.referralCode || sale.externalReferences?.affiliateReferralCode || "",
      sale.payment?.method || "现金",
      sale.payment?.reference || "",
      sale.externalReferences?.simplePayReference || "",
      sale.externalReferences?.affiliateOrderId || "",
      getFollowUpStatusText(sale),
      sale.followUp?.updatedAt ? new Date(sale.followUp.updatedAt).toLocaleString() : "",
      sale.service?.name || "",
      sale.service?.durationDays || "",
      sale.service?.startDate ? formatDate(new Date(sale.service.startDate)) : "",
      sale.service?.endDate ? formatDate(new Date(sale.service.endDate)) : "",
      sale.items.map((item) => `${item.name} x${item.qty}`).join("; "),
      sale.subtotal,
      sale.discount,
      sale.total,
      sale.paid,
      sale.change
    ]);
  }
  downloadCsv(`sales-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportBranchSummary() {
  if (!requireOperations()) return;
  const reportSales = getReportSales();
  const rows = [["日期范围", "统计口径", "分行", "订单数", "客户数", "销售额"]];
  for (const branch of getAccessibleBranches()) {
    const branchSales = reportSales.filter((sale) => (sale.branchId || "hq") === branch.id);
    const customers = new Set(branchSales.map((sale) => `${sale.customer?.phone || ""}-${sale.customer?.name || ""}`).filter(Boolean));
    const revenue = branchSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    rows.push([getReportRangeLabel(), "不含已作废订单", branch.name, branchSales.length, customers.size, revenue]);
  }
  downloadCsv(`branch-summary-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportProductSales() {
  if (!requireOperations()) return;
  const rows = [["日期范围", "统计口径", "商品", "销量", "销售额"]];
  for (const item of getProductSalesRows()) {
    rows.push([getReportRangeLabel(), "不含已作废订单", item.name, item.qty, item.revenue]);
  }
  if (rows.length === 1) {
    alert("当前日期范围还没有商品销售记录。");
    return;
  }
  downloadCsv(`product-sales-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportPaymentSummary() {
  if (!requireOperations()) return;
  const rows = [["日期范围", "统计口径", "付款方式", "订单数", "金额"]];
  for (const item of getPaymentSummaryRows()) {
    rows.push([getReportRangeLabel(), "不含已作废订单", item.method, item.orders, item.total]);
  }
  if (rows.length === 1) {
    alert("当前日期范围还没有付款资料。");
    return;
  }
  downloadCsv(`payment-summary-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportDailySettlement() {
  if (!requireOperations()) return;
  const selectedDate = els.salesDateInput.value || inputDate();
  const branchFilter = els.salesBranchFilter.value || "all";
  const paymentFilter = els.salesPaymentFilter.value;
  const dateSales = sales.filter((sale) => {
    if (!canManageBranch(sale.branchId || "hq")) return false;
    if (branchFilter !== "all" && (sale.branchId || "hq") !== branchFilter) return false;
    const matchDate = inputDate(new Date(sale.createdAt)) === selectedDate;
    if (!matchDate) return false;
    return paymentFilter === "all" || (sale.payment?.method || "现金") === paymentFilter;
  });
  if (!dateSales.length) {
    alert("当前筛选没有结算资料。");
    return;
  }
  const selectedSales = getActiveSales(dateSales);
  const pendingPaymentSales = dateSales.filter(isSalePaymentPending);
  const voidedSales = dateSales.filter(isSaleVoided);
  const selectedIds = new Set(dateSales.map((sale) => sale.id));
  const pendingOrderIds = new Set(
    [...pendingSales, ...pendingSaleUpdates]
      .filter((sale) => selectedIds.has(sale.id))
      .map((sale) => sale.id)
  );
  const externalReferences = getNonVoidedSales(dateSales)
    .map((sale) => normalizeSaleExternalReferences(sale).externalReferences);
  const simplePayPending = externalReferences.filter((item) => item.simplePayStatus === "pending").length;
  const affiliatePending = externalReferences.filter((item) => item.affiliateStatus === "pending").length;
  const inventoryReviewCount = dateSales.filter(requiresInventoryReview).length;
  const rows = [["类型", "日期", "付款筛选", "付款方式", "订单数", "有效金额", "订单号", "状态", "时间", "参考号", "客户", "分行", "同步", "外部关联"]];
  for (const item of getPaymentSummaryRows(selectedSales)) {
    rows.push(["付款汇总", selectedDate, paymentFilter === "all" ? "全部付款" : paymentFilter, item.method, item.orders, item.total, "", "", "", "", "", "", "", ""]);
  }
  for (const sale of selectedSales) {
    rows.push([
      "明细",
      selectedDate,
      paymentFilter === "all" ? "全部付款" : paymentFilter,
      sale.payment?.method || "现金",
      "",
      sale.total,
      sale.id,
      "正常",
      new Date(sale.createdAt).toLocaleString(),
      sale.payment?.reference || "",
      `${sale.customer?.name || ""} ${sale.customer?.phone || ""}`.trim(),
      sale.branchName || getBranchName(sale.branchId || "hq"),
      getSaleSyncText(sale),
      getSaleIntegrationSummary(sale)
    ]);
  }
  for (const sale of voidedSales) {
    rows.push([
      "作废",
      selectedDate,
      paymentFilter === "all" ? "全部付款" : paymentFilter,
      sale.payment?.method || "现金",
      "",
      0,
      sale.id,
      `已作废，原金额 ${money(sale.total)}`,
      new Date(sale.createdAt).toLocaleString(),
      sale.payment?.reference || "",
      `${sale.customer?.name || ""} ${sale.customer?.phone || ""}`.trim(),
      sale.branchName || getBranchName(sale.branchId || "hq"),
      getSaleSyncText(sale),
      getSaleIntegrationSummary(sale)
    ]);
  }
  rows.push(
    ["风险汇总", selectedDate, "", "", pendingOrderIds.size, "", "", "待同步订单", "", "", "", "", "", ""],
    ["风险汇总", selectedDate, "", "", pendingPaymentSales.length, pendingPaymentSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0), "", "待付款订单（不计收入）", "", "", "", "", "", ""],
    ["风险汇总", selectedDate, "", "", simplePayPending, "", "", "SimplePay 待确认", "", "", "", "", "", ""],
    ["风险汇总", selectedDate, "", "", affiliatePending, "", "", "联盟待关联", "", "", "", "", "", ""],
    ["风险汇总", selectedDate, "", "", inventoryReviewCount, "", "", "库存待复核", "", "", "", "", "", ""],
    ["风险汇总", selectedDate, "", "", voidedSales.length, 0, "", `作废原金额 ${money(voidedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0))}`, "", "", "", "", "", ""]
  );
  const branchSuffix = branchFilter === "all" ? "all-branches" : branchFilter;
  downloadCsv(`daily-settlement-${selectedDate}-${branchSuffix}.csv`, rows);
}

function exportIntegrationQueue() {
  if (!requireOperations()) return;
  const manageableSales = getActiveSales()
    .filter((sale) => canManageBranch(sale.branchId || "hq"))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const issues = getIntegrationIssues(manageableSales);
  const issueSaleIds = new Set(issues.flatMap((issue) => issue.saleIds));
  const queue = manageableSales.filter((sale) => {
    const references = normalizeSaleExternalReferences(sale).externalReferences;
    return references.simplePayStatus === "pending"
      || references.affiliateStatus === "pending"
      || references.simplePayStatus === "failed"
      || references.affiliateStatus === "failed"
      || issueSaleIds.has(sale.id);
  });
  if (!queue.length) {
    alert("目前没有待关联或异常订单。");
    return;
  }
  const rows = [[
    "POS订单号",
    "时间",
    "分行",
    "客户",
    "电话",
    "金额",
    "SimplePay状态",
    "SimplePay参考号",
    "联盟状态",
    "联盟推荐码",
    "联盟订单号",
    "问题"
  ]];
  for (const sale of queue) {
    const references = normalizeSaleExternalReferences(sale).externalReferences;
    const issueText = issues
      .filter((issue) => issue.saleIds.includes(sale.id))
      .map((issue) => issue.message)
      .join("; ");
    const markedFailed = [
      references.simplePayStatus === "failed" ? "SimplePay 已标记异常" : "",
      references.affiliateStatus === "failed" ? "联盟已标记异常" : ""
    ].filter(Boolean).join("; ");
    rows.push([
      references.posOrderId || sale.id,
      new Date(sale.createdAt).toLocaleString(),
      sale.branchName || getBranchName(sale.branchId || "hq"),
      sale.customer?.name || "",
      sale.customer?.phone || "",
      sale.total,
      getIntegrationStatusText(references.simplePayStatus, "待确认"),
      references.simplePayReference || "",
      getIntegrationStatusText(references.affiliateStatus),
      references.affiliateReferralCode || "",
      references.affiliateOrderId || "",
      [issueText, markedFailed].filter(Boolean).join("; ")
    ]);
  }
  downloadCsv(`integration-queue-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportInventory() {
  if (!requireOperations()) return;
  const rows = [["商品", "SKU", "分类", "售价", "分行", "库存"]];
  for (const product of products) {
    for (const branch of getAccessibleBranches()) {
      rows.push([
        product.name,
        product.barcode || "",
        product.category || "",
        product.price,
        branch.name,
        getBranchStock(product, branch.id)
      ]);
    }
  }
  downloadCsv(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportCustomers() {
  if (!requireOperations()) return;
  const accessibleSales = sales.filter((sale) => canManageBranch(sale.branchId || "hq"));
  if (!accessibleSales.length) {
    alert("还没有客户资料可以导出。");
    return;
  }
  const rows = [["客户姓名", "电话", "联盟推荐码", "最近订单号", "最近分行", "最近消费时间", "计划名称", "计划开始", "计划结束", "到期状态", "跟进状态", "消费次数", "累计消费"]];
  const customerMap = new Map();
  for (const sale of [...getActiveSales(accessibleSales)].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    const key = `${sale.customer?.phone || ""}-${sale.customer?.name || ""}`.trim() || sale.id;
    const existing = customerMap.get(key) || {
      latestSale: sale,
      orderCount: 0,
      totalSpend: 0
    };
    existing.orderCount += 1;
    existing.totalSpend += Number(sale.total || 0);
    customerMap.set(key, existing);
  }
  for (const customer of customerMap.values()) {
    const sale = customer.latestSale;
    const daysLeft = sale.service?.endDate ? daysUntil(sale.service.endDate) : null;
    rows.push([
      sale.customer?.name || "",
      sale.customer?.phone || "",
      sale.customer?.referralCode || sale.externalReferences?.affiliateReferralCode || "",
      sale.id,
      sale.branchName || getBranchName(sale.branchId || "hq"),
      new Date(sale.createdAt).toLocaleString(),
      sale.service?.name || "",
      sale.service?.startDate ? formatDate(new Date(sale.service.startDate)) : "",
      sale.service?.endDate ? formatDate(new Date(sale.service.endDate)) : "",
      daysLeft === null ? "" : getFollowUpDueText(daysLeft),
      getFollowUpStatusText(sale),
      customer.orderCount,
      customer.totalSpend
    ]);
  }
  downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportAuditLogs() {
  if (!requireAdmin()) return;
  if (!auditLogs.length) {
    alert("还没有审计日志可以导出。");
    return;
  }
  const rows = [["时间", "动作", "操作者", "操作者邮箱", "分行", "详情"]];
  for (const log of auditLogs) {
    rows.push([
      new Date(log.createdAt).toLocaleString(),
      log.action,
      log.actor?.name || "",
      log.actor?.email || "",
      log.branchName || getBranchName(log.branchId || "hq"),
      JSON.stringify(log.detail || {})
    ]);
  }
  downloadCsv(`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportStockAdjustments() {
  if (!requireOperations()) return;
  const accessibleAdjustments = stockAdjustments.filter((item) => canManageBranch(item.branchId || "hq"));
  if (!accessibleAdjustments.length) {
    alert("还没有库存流水可以导出。");
    return;
  }
  const rows = [["时间", "商品", "SKU", "分行", "调整前", "调整后", "变化", "原因", "操作者", "操作者邮箱"]];
  for (const adjustment of accessibleAdjustments) {
    rows.push([
      new Date(adjustment.createdAt).toLocaleString(),
      adjustment.productName || "",
      adjustment.barcode || "",
      adjustment.branchName || getBranchName(adjustment.branchId || "hq"),
      adjustment.beforeStock,
      adjustment.afterStock,
      adjustment.delta,
      adjustment.reason || "",
      adjustment.operator?.name || "",
      adjustment.operator?.email || ""
    ]);
  }
  downloadCsv(`stock-adjustments-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportShifts() {
  if (!requireOperations()) return;
  const accessibleShifts = shifts.filter((shift) => canManageBranch(shift.branchId || "hq"));
  if (!accessibleShifts.length) {
    alert("还没有交班记录可以导出。");
    return;
  }
  const rows = [["班次号", "分行", "操作员", "核对 / 结班人", "结班人邮箱", "开始时间", "结束时间", "订单数", "总金额", "付款汇总", "开班备用金", "现金销售", "其他现金存入", "现金取出", "应有现金", "实点现金", "现金差额", "作废订单", "本机待同步", "库存待复核", "SimplePay待确认", "联盟待关联", "交班备注"]];
  for (const shift of accessibleShifts) {
    const reconciledBy = shift.reconciliation?.reconciledBy || shift.closedBy || {};
    rows.push([
      shift.id,
      shift.branchName || getBranchName(shift.branchId || "hq"),
      shift.operatorName || "",
      reconciledBy.name || "",
      reconciledBy.email || "",
      shift.openedAt ? new Date(shift.openedAt).toLocaleString() : "",
      shift.closedAt ? new Date(shift.closedAt).toLocaleString() : "",
      shift.summary?.orders || 0,
      shift.summary?.total || 0,
      (shift.summary?.payments || []).map((item) => `${item.method}: ${money(item.total)} (${item.orders}单)`).join("; "),
      shift.reconciliation?.openingCash ?? shift.openingCash ?? "",
      shift.reconciliation?.cashSales ?? shift.summary?.cashSales ?? "",
      shift.reconciliation?.cashIn ?? shift.cashIn ?? "",
      shift.reconciliation?.cashOut ?? shift.cashOut ?? "",
      shift.reconciliation?.expectedCash ?? "",
      shift.reconciliation?.countedCash ?? "",
      shift.reconciliation?.cashDifference ?? "",
      shift.reconciliation?.voidedOrders ?? shift.summary?.voidedOrders ?? "",
      shift.reconciliation?.pendingSyncTotal ?? "",
      shift.reconciliation?.inventoryReviewPending ?? shift.summary?.inventoryReviewPending ?? "",
      shift.reconciliation?.simplePayPending ?? "",
      shift.reconciliation?.affiliatePending ?? "",
      shift.reconciliation?.note || ""
    ]);
  }
  downloadCsv(`shifts-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportBackup() {
  if (!requireAdmin()) return;
  const backup = {
    schemaVersion: 2,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: appSettings,
    branches,
    authorizedUsers,
    products,
    sales,
    pendingSales,
    pendingSaleUpdates,
    pendingProducts,
    pendingStockAdjustments,
    pendingAuditLogs,
    pendingManagement,
    stockAdjustments,
    auditLogs,
    currentShift,
    shifts,
    storageRecovery: getStorageRecoveryEntries(),
    preferences: {
      paymentMethod: preferredPaymentMethod
    }
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `simple-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function validateBackupData(backup) {
  const issues = [];
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    return { ok: false, issues: ["备份根内容不是对象"], summary: null };
  }
  for (const field of ["branches", "products", "sales"]) {
    if (!Array.isArray(backup[field])) issues.push(`${field} 必须是数组`);
  }
  if (issues.length) return { ok: false, issues, summary: null };

  const branchIds = new Set();
  for (const branch of backup.branches) {
    if (!branch?.id || !branch?.name) {
      issues.push("存在缺少 ID 或名称的分行");
      continue;
    }
    if (branchIds.has(branch.id)) issues.push(`分行 ID 重复：${branch.id}`);
    branchIds.add(branch.id);
  }
  if (!branchIds.size) issues.push("备份至少需要一个分行");

  const productIds = new Set();
  for (const product of backup.products) {
    if (!product?.id || !product?.name || !Number.isFinite(Number(product.price))) {
      issues.push(`商品资料异常：${product?.id || product?.name || "未知商品"}`);
      continue;
    }
    if (productIds.has(product.id)) issues.push(`商品 ID 重复：${product.id}`);
    productIds.add(product.id);
    for (const [branchId, stock] of Object.entries(product.branchStock || {})) {
      if (!branchIds.has(branchId) || !Number.isFinite(Number(stock)) || Number(stock) < 0) {
        issues.push(`商品 ${product.name} 的 ${branchId} 库存无效`);
      }
    }
  }

  const saleIds = new Set();
  for (const sale of backup.sales) {
    const branchId = sale?.branchId || "hq";
    if (!sale?.id || !Array.isArray(sale.items) || !Number.isFinite(Number(sale.total))) {
      issues.push(`订单资料异常：${sale?.id || "未知订单"}`);
      continue;
    }
    if (saleIds.has(sale.id)) issues.push(`订单号重复：${sale.id}`);
    saleIds.add(sale.id);
    if (!branchIds.has(branchId)) issues.push(`订单 ${sale.id} 的分行不存在：${branchId}`);
    if (!sale.createdAt || Number.isNaN(new Date(sale.createdAt).getTime())) issues.push(`订单 ${sale.id} 时间无效`);
    for (const item of sale.items) {
      if (!item?.id || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0) {
        issues.push(`订单 ${sale.id} 含有无效商品明细`);
      }
    }
  }

  const users = Array.isArray(backup.authorizedUsers) ? backup.authorizedUsers : [];
  for (const user of users) {
    if (!user?.email || !branchIds.has(user.branchId || "hq")) {
      issues.push(`授权用户资料异常：${user?.email || "未知用户"}`);
    }
  }
  if (backup.currentShift && (!backup.currentShift.id || !branchIds.has(backup.currentShift.branchId || "hq"))) {
    issues.push("进行中班次资料异常");
  }

  const pendingCount = [
    backup.pendingSales,
    backup.pendingSaleUpdates,
    backup.pendingProducts,
    backup.pendingStockAdjustments,
    backup.pendingAuditLogs
  ].reduce((count, items) => count + (Array.isArray(items) ? items.length : 0), 0)
    + (Array.isArray(backup.pendingManagement?.branches) ? backup.pendingManagement.branches.length : 0)
    + (Array.isArray(backup.pendingManagement?.users) ? backup.pendingManagement.users.length : 0)
    + (backup.pendingManagement?.settings ? 1 : 0);

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      exportedAt: backup.exportedAt || "",
      branches: backup.branches.length,
      users: users.length,
      products: backup.products.length,
      sales: backup.sales.length,
      shifts: Array.isArray(backup.shifts) ? backup.shifts.length : 0,
      pendingCount
    }
  };
}

function buildRestoredState(backup) {
  return {
    branches: structuredClone(backup.branches),
    authorizedUsers: structuredClone(Array.isArray(backup.authorizedUsers) ? backup.authorizedUsers : defaultAuthorizedUsers),
    products: structuredClone(backup.products),
    sales: backup.sales.map(normalizeSaleExternalReferences),
    pendingSales: (Array.isArray(backup.pendingSales) ? backup.pendingSales : []).map(normalizeSaleExternalReferences),
    pendingSaleUpdates: (Array.isArray(backup.pendingSaleUpdates) ? backup.pendingSaleUpdates : []).map(normalizeSaleExternalReferences),
    pendingProducts: structuredClone(Array.isArray(backup.pendingProducts) ? backup.pendingProducts : []),
    pendingStockAdjustments: structuredClone(Array.isArray(backup.pendingStockAdjustments) ? backup.pendingStockAdjustments : []),
    pendingAuditLogs: structuredClone(Array.isArray(backup.pendingAuditLogs) ? backup.pendingAuditLogs : []),
    pendingManagement: normalizePendingManagement(backup.pendingManagement),
    stockAdjustments: structuredClone(Array.isArray(backup.stockAdjustments) ? backup.stockAdjustments : []),
    auditLogs: structuredClone(Array.isArray(backup.auditLogs) ? backup.auditLogs : []),
    currentShift: backup.currentShift ? structuredClone(backup.currentShift) : null,
    shifts: structuredClone(Array.isArray(backup.shifts) ? backup.shifts : []),
    appSettings: { ...defaultSettings, ...(backup.settings || {}) },
    paymentMethod: backup.preferences?.paymentMethod || preferredPaymentMethod
  };
}

function restoreBackupFile(file) {
  if (!requireAdmin()) return;
  if (file.size > 25 * 1024 * 1024) {
    alert("备份文件超过 25 MB，已停止读取。请确认选择的是简单POS JSON 备份。");
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const backup = JSON.parse(String(reader.result || "{}"));
      const validation = validateBackupData(backup);
      if (!validation.ok) {
        alert(`备份验证失败，当前资料没有改变：\n\n${validation.issues.slice(0, 8).join("\n")}`);
        return;
      }
      const summary = validation.summary;
      const exportedAt = summary.exportedAt ? new Date(summary.exportedAt).toLocaleString() : "未知时间";
      if (!confirm(`备份验证通过。\n\n导出时间：${exportedAt}\n分行：${summary.branches}\n员工：${summary.users}\n商品：${summary.products}\n订单：${summary.sales}\n交班：${summary.shifts}\n待同步：${summary.pendingCount}\n\n确定覆盖当前本机资料吗？`)) return;

      const restored = buildRestoredState(backup);
      const stored = saveStorageBatch([
        [STORAGE_KEYS.branches, restored.branches],
        [STORAGE_KEYS.authorizedUsers, restored.authorizedUsers],
        [STORAGE_KEYS.products, restored.products],
        [STORAGE_KEYS.sales, restored.sales],
        [STORAGE_KEYS.pendingSales, restored.pendingSales],
        [STORAGE_KEYS.pendingSaleUpdates, restored.pendingSaleUpdates],
        [STORAGE_KEYS.pendingProducts, restored.pendingProducts],
        [STORAGE_KEYS.pendingStockAdjustments, restored.pendingStockAdjustments],
        [STORAGE_KEYS.pendingAuditLogs, restored.pendingAuditLogs],
        [STORAGE_KEYS.pendingManagement, restored.pendingManagement],
        [STORAGE_KEYS.stockAdjustments, restored.stockAdjustments],
        [STORAGE_KEYS.auditLogs, restored.auditLogs],
        [STORAGE_KEYS.currentShift, restored.currentShift],
        [STORAGE_KEYS.shifts, restored.shifts],
        [STORAGE_KEYS.settings, restored.appSettings]
      ], { allowProtected: true });
      if (!stored) {
        alert("恢复未执行：本机无法完整写入备份，原资料已经回滚。");
        return;
      }

      branches = restored.branches;
      authorizedUsers = restored.authorizedUsers;
      products = restored.products;
      sales = restored.sales;
      pendingSales = restored.pendingSales;
      pendingSaleUpdates = restored.pendingSaleUpdates;
      pendingProducts = restored.pendingProducts;
      pendingStockAdjustments = restored.pendingStockAdjustments;
      pendingAuditLogs = restored.pendingAuditLogs;
      pendingManagement = restored.pendingManagement;
      stockAdjustments = restored.stockAdjustments;
      auditLogs = restored.auditLogs;
      currentShift = restored.currentShift;
      shifts = restored.shifts;
      appSettings = restored.appSettings;
      preferredPaymentMethod = restored.paymentMethod;
      paymentMethodInitialized = false;
      try {
        localStorage.setItem(STORAGE_KEYS.paymentMethod, preferredPaymentMethod);
      } catch (error) {
        reportStorageError(error);
      }
      migrateManagementData();
      migrateProductsForBranches();
      renderAll();
      writeAuditLog("backup.restore", {
        branches: branches.length,
        users: authorizedUsers.length,
        products: products.length,
        sales: sales.length
      });
      alert("备份已恢复到本机。需要同步到云端时，请点击初始化云端数据。");
    } catch (error) {
      alert(`恢复失败：${error.message}`);
    }
  });
  reader.readAsText(file, "utf-8");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateNetworkStatus() {
  els.networkStatus.textContent = navigator.onLine ? "在线" : "离线可用";
  els.networkStatus.style.color = navigator.onLine ? "#0f766e" : "#8a5a00";
}

function resetAllData() {
  if (!requireAdmin()) return;
  if (!confirm("确定重置本机商品、订单、分行、员工授权、库存流水、班次和购物车吗？此操作不会自动删除云端资料。")) return;
  if (prompt('请输入 RESET 确认清空本机数据。') !== "RESET") {
    alert("已取消清空。");
    return;
  }
  const nextBranches = structuredClone(defaultBranches);
  const nextProducts = sampleProducts.map((product) => ({
    ...structuredClone(product),
    branchStock: Object.fromEntries(
      nextBranches.map((branch) => [branch.id, Number(product.branchStock?.[branch.id] || 0)])
    )
  }));
  const nextPendingManagement = normalizePendingManagement();
  const resetSaved = saveStorageBatch([
    [STORAGE_KEYS.products, nextProducts],
    [STORAGE_KEYS.sales, []],
    [STORAGE_KEYS.pendingSales, []],
    [STORAGE_KEYS.pendingSaleUpdates, []],
    [STORAGE_KEYS.pendingProducts, []],
    [STORAGE_KEYS.pendingStockAdjustments, []],
    [STORAGE_KEYS.pendingAuditLogs, []],
    [STORAGE_KEYS.pendingManagement, nextPendingManagement],
    [STORAGE_KEYS.stockAdjustments, []],
    [STORAGE_KEYS.auditLogs, []],
    [STORAGE_KEYS.currentShift, null],
    [STORAGE_KEYS.shifts, []],
    [STORAGE_KEYS.branches, nextBranches],
    [STORAGE_KEYS.authorizedUsers, structuredClone(defaultAuthorizedUsers)]
  ]);
  if (!resetSaved) {
    alert("重置未执行：本机无法完整保存重置结果，原资料已经回滚。");
    return;
  }
  products = nextProducts;
  sales = [];
  pendingSales = [];
  pendingSaleUpdates = [];
  cart = [];
  branches = nextBranches;
  authorizedUsers = structuredClone(defaultAuthorizedUsers);
  pendingProducts = [];
  pendingStockAdjustments = [];
  pendingAuditLogs = [];
  pendingManagement = nextPendingManagement;
  stockAdjustments = [];
  auditLogs = [];
  currentShift = null;
  shifts = [];
  currentBranchId = "hq";
  localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
  writeAuditLog("data.reset", {});
  renderAll();
}

els.searchInput.addEventListener("input", renderProducts);
els.categoryFilter.addEventListener("change", () => {
  renderProducts();
  renderCategoryFilter();
});
els.refreshCloudBtn.addEventListener("click", syncThenLoadCloudData);
els.menuToggleBtn.addEventListener("click", () => {
  const open = !els.appMenu.classList.contains("open");
  els.appMenu.classList.toggle("open", open);
  els.menuToggleBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    els.cashierMenu.classList.remove("open");
    els.cashierToggleBtn.setAttribute("aria-expanded", "false");
  }
});
els.cashierToggleBtn.addEventListener("click", () => {
  const open = !els.cashierMenu.classList.contains("open");
  els.cashierMenu.classList.toggle("open", open);
  els.cashierToggleBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    els.appMenu.classList.remove("open");
    els.menuToggleBtn.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!els.appMenu.contains(target) && !els.cashierMenu.contains(target)) {
    els.appMenu.classList.remove("open");
    els.cashierMenu.classList.remove("open");
    els.menuToggleBtn.setAttribute("aria-expanded", "false");
    els.cashierToggleBtn.setAttribute("aria-expanded", "false");
  }
});
for (const button of document.querySelectorAll("[data-app-view]")) {
  button.addEventListener("click", () => setAppView(button.dataset.appView));
}
els.branchSelect.addEventListener("change", () => {
  if (hasOpenShift()) {
    currentBranchId = currentShift.branchId;
    localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
    alert(`当前班次属于 ${getCurrentShiftLabel()}，请先完成交班再切换分行。`);
    renderAll();
    return;
  }
  if (isBranchLockedToOperator()) {
    const operator = getOperator();
    currentBranchId = operator.branchId;
    localStorage.setItem(STORAGE_KEYS.branchId, currentBranchId);
    alert(`此收银员只被授权使用 ${getBranchName(operator.branchId)}，不能切换到其他分行。`);
    renderAll();
    return;
  }
  syncCurrentBranchFromSelect();
  cart = [];
  renderAll();
});
els.operatorLoginForm.addEventListener("submit", loginOperator);
els.googleLoginBtn.addEventListener("click", signInWithGoogle);
els.operatorLogoutBtn.addEventListener("click", logoutOperator);
els.closeShiftBtn.addEventListener("click", closeCurrentShift);
els.cashMovementBtn.addEventListener("click", () => openCashMovementDialog(false));
els.cashMovementForm.addEventListener("submit", recordCashMovement);
els.closeCashMovementBtn.addEventListener("click", closeCashMovementDialog);
els.cashMovementDialog.addEventListener("close", handleCashMovementDialogClosed);
els.shiftSettlementForm.addEventListener("submit", confirmShiftSettlement);
els.closeSettlementBtn.addEventListener("click", closeShiftSettlementDialog);
els.settlementCashMovementBtn.addEventListener("click", () => openCashMovementDialog(true));
els.settlementCountedCash.addEventListener("input", updateSettlementDifference);
els.settlementOpeningCash.addEventListener("input", updateSettlementDifference);
els.settlementCashIn.addEventListener("input", updateSettlementDifference);
els.settlementCashOut.addEventListener("input", updateSettlementDifference);
els.exportCurrentSettlementBtn.addEventListener("click", () => exportCurrentShiftSettlement());
els.clearCartBtn.addEventListener("click", () => {
  cart = [];
  autoFillPaid = true;
  els.paidInput.value = "";
  renderCart();
});
els.orderOptionsToggle.addEventListener("click", () => {
  els.orderOptionsPanel.classList.toggle("hidden");
});
els.discountInput.addEventListener("input", renderCart);
els.paidInput.addEventListener("input", () => {
  autoFillPaid = false;
  renderCart();
});
els.quickPaidButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick-paid]");
  if (!button) return;
  if (button.dataset.quickPaid === "custom") {
    els.customPaidPanel.classList.remove("hidden");
    els.paidInput.focus();
    els.paidInput.select();
    return;
  }
  els.customPaidPanel.classList.add("hidden");
  const value = button.dataset.quickPaid === "due" ? getCartDueAmount() : Number(button.dataset.quickPaid);
  els.paidInput.value = Number(value || 0).toFixed(2);
  autoFillPaid = false;
  renderCart();
});
els.paymentMethodInput.addEventListener("change", () => {
  preferredPaymentMethod = els.paymentMethodInput.value;
  localStorage.setItem(STORAGE_KEYS.paymentMethod, preferredPaymentMethod);
  renderCart();
});
els.quickPaymentButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-payment-method]");
  if (!button) return;
  preferredPaymentMethod = button.dataset.paymentMethod;
  els.paymentMethodInput.value = preferredPaymentMethod;
  localStorage.setItem(STORAGE_KEYS.paymentMethod, preferredPaymentMethod);
  renderCart();
});
els.salesDateInput.addEventListener("change", () => {
  showAllSalesDates = false;
  renderSales();
});
els.salesSearchInput.addEventListener("input", renderSales);
els.salesBranchFilter.addEventListener("change", renderSales);
els.salesPaymentFilter.addEventListener("change", renderSales);
els.salesIntegrationFilter.addEventListener("change", renderSales);
els.exportDailySettlementBtn.addEventListener("click", exportDailySettlement);
els.exportIntegrationQueueBtn.addEventListener("click", exportIntegrationQueue);
els.menuSearchInput.addEventListener("input", renderMenuProductList);
els.inventoryBranchFilter.addEventListener("change", renderInventoryOverview);
els.inventorySearchInput.addEventListener("input", renderInventoryOverview);
els.toggleSalesLimitBtn.addEventListener("click", () => {
  showMoreSales = !showMoreSales;
  renderSales();
});
els.todaySalesBtn.addEventListener("click", () => {
  showAllSalesDates = false;
  els.salesDateInput.value = inputDate();
  renderSales();
});
els.allSalesDatesBtn.addEventListener("click", () => {
  showAllSalesDates = true;
  renderSales();
});
els.runDiagnosticsBtn.addEventListener("click", runLocalDiagnostics);
els.checkIntegrationConnectionsBtn.addEventListener("click", checkIntegrationConnectionsFromCloud);
els.traceIntegrationOrderBtn.addEventListener("click", traceIntegrationOrderFromCloud);
els.checkIntegrationJobsBtn.addEventListener("click", checkIntegrationJobsFromCloud);
els.refreshAffiliateCatalogBtn.addEventListener("click", refreshAffiliateCatalogFromCloud);
els.quickCheckoutBtn.addEventListener("click", () => {
  setAppView("order");
  if (!isOperatorAllowedForCurrentBranch()) {
    els.cashierMenu.classList.add("open");
    els.cashierToggleBtn.setAttribute("aria-expanded", "true");
    els.operatorEmailInput.focus();
  } else if (cart.length) {
    openPaymentDialog();
  } else {
    if (!ensureCurrentShift()) return;
    renderAll();
    els.searchInput.focus();
  }
});
els.reportStartInput.addEventListener("change", renderGlobalDashboard);
els.reportEndInput.addEventListener("change", renderGlobalDashboard);
els.reportTodayBtn.addEventListener("click", () => setReportRange(inputDate(), inputDate()));
els.reportMonthBtn.addEventListener("click", () => setReportRange(monthStartDate(), monthEndDate()));
els.reportAllBtn.addEventListener("click", () => setReportRange("", ""));
els.checkoutBtn.addEventListener("click", openPaymentDialog);
els.confirmPaymentBtn.addEventListener("click", checkout);
els.closePaymentBtn.addEventListener("click", () => els.paymentDialog.close());
els.adminLoginForm.addEventListener("submit", loginAdmin);
els.adminGoogleLoginBtn.addEventListener("click", signInWithGoogle);
els.adminLogoutBtn.addEventListener("click", logoutAdmin);
els.branchForm.addEventListener("submit", addBranch);
els.userForm.addEventListener("submit", addAuthorizedUser);
els.settingsForm.addEventListener("submit", saveSettings);
els.adminOfflinePasswordForm.addEventListener("submit", saveAdminOfflinePassword);
els.productForm.addEventListener("submit", saveProduct);
els.cancelProductEditBtn.addEventListener("click", resetProductFormEditor);
els.initCloudBtn.addEventListener("click", initializeCloudData);
els.syncPendingBtn.addEventListener("click", syncPendingChanges);
els.exportBtn.addEventListener("click", exportSales);
els.exportSummaryBtn.addEventListener("click", exportBranchSummary);
els.exportPaymentSummaryBtn.addEventListener("click", exportPaymentSummary);
els.exportProductSalesBtn.addEventListener("click", exportProductSales);
els.exportInventoryBtn.addEventListener("click", exportInventory);
els.exportCustomersBtn.addEventListener("click", exportCustomers);
els.exportAuditBtn.addEventListener("click", exportAuditLogs);
els.exportStockBtn.addEventListener("click", exportStockAdjustments);
els.exportShiftsBtn.addEventListener("click", exportShifts);
els.backupBtn.addEventListener("click", exportBackup);
els.restoreBtn.addEventListener("click", () => els.restoreInput.click());
els.restoreInput.addEventListener("change", () => {
  const [file] = els.restoreInput.files;
  if (file) restoreBackupFile(file);
  els.restoreInput.value = "";
});
els.resetDataBtn.addEventListener("click", resetAllData);
els.seedBtn.addEventListener("click", () => {
  if (!requireAdmin()) return;
  products = cloneSampleProductsForBranches();
  save(STORAGE_KEYS.products, products);
  renderAll();
});
els.closeReceiptBtn.addEventListener("click", () => els.receiptDialog.close());
els.receiptCheckPaymentBtn.addEventListener("click", () => {
  if (lastReceiptSale) refreshSimplePayPayment(lastReceiptSale.id, els.receiptCheckPaymentBtn);
});
els.printReceiptBtn.addEventListener("click", () => window.print());
els.integrationForm.addEventListener("submit", saveIntegrationDetails);
els.closeIntegrationBtn.addEventListener("click", closeIntegrationEditor);
els.copyIntegrationOrderIdBtn.addEventListener("click", copyIntegrationOrderId);
els.bluetoothPrintReceiptBtn.addEventListener("click", () => printBluetoothReceipt());
els.printerPaperWidth.addEventListener("change", savePrinterSettings);
els.printerAutoPrint.addEventListener("change", savePrinterSettings);
els.printerConnectBtn.addEventListener("click", reconnectBluetoothPrinter);
els.printerPairBtn.addEventListener("click", pairBluetoothPrinter);
els.printerTestBtn.addEventListener("click", testBluetoothPrinter);
els.printerForgetBtn.addEventListener("click", forgetBluetoothPrinter);
window.addEventListener("thermal-printer-status", (event) => {
  const { state, message, deviceId, deviceName } = event.detail;
  if (deviceId) {
    printerSettings.deviceId = deviceId;
    printerSettings.deviceName = deviceName;
    save(STORAGE_KEYS.printerSettings, printerSettings);
  }
  updatePrinterStatus(message, state);
  renderPrinterSettings();
});
window.addEventListener("online", async () => {
  updateNetworkStatus();
  if (lockOfflineSessionForOnlineVerification()) return;
  const authorized = await refreshCloudAuthorization({ force: true });
  if (authorized) syncThenLoadCloudData();
});
window.addEventListener("offline", updateNetworkStatus);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshCloudAuthorization();
});

setInterval(() => {
  refreshCloudAuthorization();
}, AUTHORIZATION_REFRESH_INTERVAL_MS);

window.addEventListener("cloud-ready", (event) => {
  updateCloudStatus(`云端已连接：${event.detail.projectId}`, true);
});

window.addEventListener("cloud-auth-change", (event) => {
  const { firebaseUser, appUser } = event.detail;
  if (!firebaseUser) {
    if (navigator.onLine && lockOfflineSessionForOnlineVerification()) return;
    if (cloudSessionActive) {
      adminEmail = "";
      operatorEmail = "";
      currentCloudUser = null;
      lastAuthorizationCheckAt = 0;
      cart = [];
      clearSessionEmail(STORAGE_KEYS.adminEmail);
      clearSessionEmail(STORAGE_KEYS.operatorEmail);
      cloudSessionActive = false;
    }
    updateCloudStatus("云端未登录");
    renderAll();
    return;
  }
  applyCloudUser(appUser, firebaseUser);
});

window.addEventListener("cloud-error", (event) => {
  updateCloudStatus("云端错误");
  console.warn("Cloud error", event.detail.message);
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  els.installBtn.classList.remove("hidden");
});

els.installBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installBtn.classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}

setAppView(isAdmin() ? "report" : "order");
migrateManagementData();
migrateProductsForBranches();
renderAll();
if (window.thermalPrinter?.isSupported()) {
  window.thermalPrinter.restore(printerSettings.deviceId).catch((error) => {
    console.warn("Bluetooth printer restore failed", error);
  });
}
