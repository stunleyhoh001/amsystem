import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

let configModule;
try {
  configModule = await import("./firebase-config.local.js");
} catch {
  configModule = await import("./firebase-config.js");
}

const { adminEmail, firebaseConfig } = configModule;

if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_")) {
  window.dispatchEvent(new CustomEvent("cloud-error", {
    detail: { message: "Firebase config is missing. Create firebase-config.local.js." }
  }));
  throw new Error("Firebase config is missing. Create firebase-config.local.js.");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const cloudFunctions = getFunctions(app);
const provider = new GoogleAuthProvider();

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function getCloudUser(email) {
  const normalized = normalizeEmail(email);
  const snapshot = await getDoc(doc(db, "users", normalized));
  if (snapshot.exists()) return { id: snapshot.id, ...snapshot.data() };
  if (normalized === adminEmail) {
    const adminUser = {
      email: adminEmail,
      name: "Stanley Hoh",
      role: "admin",
      branchId: "hq",
      active: true,
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, "users", adminEmail), adminUser, { merge: true });
    return { id: adminEmail, ...adminUser };
  }
  return null;
}

async function refreshAuthorization() {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return { firebaseUser: null, appUser: null };
  const appUser = await getCloudUser(firebaseUser.email);
  return {
    firebaseUser: {
      email: firebaseUser.email,
      uid: firebaseUser.uid
    },
    appUser
  };
}

async function loadCollection(name) {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function loadCollectionSafe(name) {
  try {
    return await loadCollection(name);
  } catch (error) {
    console.warn(`Cloud collection load skipped: ${name}`, error);
    return [];
  }
}

async function loadAllData() {
  const [branches, users, products, sales, stockAdjustments, auditLogs] = await Promise.all([
    loadCollectionSafe("branches"),
    loadCollectionSafe("users"),
    loadCollectionSafe("products"),
    loadCollectionSafe("sales"),
    loadCollectionSafe("stockAdjustments"),
    loadCollectionSafe("auditLogs")
  ]);
  return { branches, users, products, sales, stockAdjustments, auditLogs };
}

async function loadUserData(appUser) {
  if (!appUser) return { branches: [], users: [], products: [], sales: [], stockAdjustments: [], auditLogs: [] };
  if (appUser.role === "admin" || normalizeEmail(appUser.email) === adminEmail) {
    return loadAllData();
  }

  const [branches, products, salesSnapshot] = await Promise.all([
    loadCollectionSafe("branches"),
    loadCollectionSafe("products"),
    getDocs(query(collection(db, "sales"), where("branchId", "==", appUser.branchId))).catch((error) => {
      console.warn("Cloud branch sales load skipped", error);
      return { docs: [] };
    })
  ]);
  return {
    branches,
    users: [appUser],
    products,
    sales: salesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    stockAdjustments: [],
    auditLogs: []
  };
}

async function saveBranch(branch) {
  await setDoc(doc(db, "branches", branch.id), {
    ...branch,
    active: branch.active ?? true,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveAuthorizedUser(user) {
  const email = normalizeEmail(user.email);
  await setDoc(doc(db, "users", email), {
    ...user,
    email,
    active: user.active ?? true,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveProduct(product) {
  await setDoc(doc(db, "products", product.id), {
    ...product,
    active: product.active ?? true,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function deleteProduct(productId) {
  await deleteDoc(doc(db, "products", productId));
}

async function saveStockAdjustment(adjustment) {
  await setDoc(doc(db, "stockAdjustments", adjustment.id), {
    ...adjustment,
    syncedAt: serverTimestamp()
  }, { merge: true });
}

async function saveAuditLog(log) {
  await setDoc(doc(db, "auditLogs", log.id), {
    ...log,
    syncedAt: serverTimestamp()
  }, { merge: true });
}

async function saveSettings(settings) {
  await setDoc(doc(db, "settings", "app"), {
    ...settings,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function loadSettings() {
  const snapshot = await getDoc(doc(db, "settings", "app"));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function saveSale(sale) {
  await setDoc(doc(db, "sales", sale.id), {
    ...sale,
    syncStatus: "synced",
    syncedAt: serverTimestamp()
  }, { merge: true });
}

async function loadSale(saleId) {
  const snapshot = await getDoc(doc(db, "sales", saleId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

function writeIntegrationJobs(transaction, sale, eventType) {
  if (!window.integrationContract) return [];
  const jobs = window.integrationContract.buildJobs(sale, eventType);
  for (const job of jobs) {
    transaction.set(doc(db, "integrationJobs", job.id), {
      ...job,
      cloudCreatedAt: serverTimestamp(),
      cloudUpdatedAt: serverTimestamp()
    });
  }
  return jobs;
}

async function readCheckoutIntegrationJobs(transaction, sale) {
  const jobIds = Array.isArray(sale.integrationOutbox?.checkoutJobIds)
    ? sale.integrationOutbox.checkoutJobIds
    : [];
  const snapshots = [];
  for (const jobId of jobIds) {
    snapshots.push(await transaction.get(doc(db, "integrationJobs", jobId)));
  }
  return snapshots;
}

function cancelOpenIntegrationJobs(transaction, snapshots, saleId) {
  const cancellable = new Set([
    "pending",
    "processing",
    "retry",
    "blocked",
    "awaiting-customer-authorization",
    "dispatched"
  ]);
  for (const snapshot of snapshots) {
    if (!snapshot.exists() || !cancellable.has(snapshot.data().status)) continue;
    transaction.update(snapshot.ref, {
      status: "canceled",
      cancelReason: "pos-order-canceled",
      canceledPosOrderId: saleId,
      canceledAt: new Date().toISOString(),
      cloudUpdatedAt: serverTimestamp()
    });
  }
}

async function saveCheckout(sale) {
  return runTransaction(db, async (transaction) => {
    const saleRef = doc(db, "sales", sale.id);
    const existingSale = await transaction.get(saleRef);
    if (existingSale.exists()) {
      const existing = existingSale.data();
      return {
        status: existing.inventoryReview?.status === "required" ? "inventory-review" : "already-synced",
        inventoryReview: existing.inventoryReview || null
      };
    }

    const productRefs = sale.items.map((item) => doc(db, "products", item.id));
    const snapshots = [];
    for (const productRef of productRefs) {
      snapshots.push(await transaction.get(productRef));
    }

    const conflicts = [];
    snapshots.forEach((snapshot, index) => {
      const item = sale.items[index];
      if (!snapshot.exists()) {
        conflicts.push({
          productId: item.id,
          productName: item.name,
          requestedQty: Number(item.qty || 0),
          cloudStock: null,
          reason: "云端商品不存在"
        });
        return;
      }
      const product = snapshot.data();
      const branchStock = { ...(product.branchStock || {}) };
      const currentStock = Number(branchStock[sale.branchId] || 0);
      if (currentStock < item.qty) {
        conflicts.push({
          productId: item.id,
          productName: item.name,
          requestedQty: Number(item.qty || 0),
          cloudStock: currentStock,
          reason: "云端库存不足"
        });
      }
    });

    if (conflicts.length) {
      const inventoryReview = {
        status: "required",
        detectedAt: new Date().toISOString(),
        branchId: sale.branchId,
        conflicts
      };
      transaction.set(saleRef, {
        ...sale,
        inventoryReview,
        syncStatus: "review-required",
        syncedAt: serverTimestamp()
      }, { merge: true });
      const integrationJobs = writeIntegrationJobs(transaction, sale, "checkout");
      return {
        status: "inventory-review",
        inventoryReview,
        integrationJobIds: integrationJobs.map((job) => job.id)
      };
    }

    snapshots.forEach((snapshot, index) => {
      const item = sale.items[index];
      const product = snapshot.data();
      const branchStock = { ...(product.branchStock || {}) };
      const currentStock = Number(branchStock[sale.branchId] || 0);
      branchStock[sale.branchId] = currentStock - item.qty;
      transaction.update(snapshot.ref, {
        branchStock,
        stock: sale.branchId === "hq" ? branchStock[sale.branchId] : product.stock,
        updatedAt: serverTimestamp()
      });
    });

    transaction.set(saleRef, {
      ...sale,
      syncStatus: "synced",
      syncedAt: serverTimestamp()
    }, { merge: true });
    const integrationJobs = writeIntegrationJobs(transaction, sale, "checkout");
    return {
      status: "synced",
      inventoryReview: null,
      integrationJobIds: integrationJobs.map((job) => job.id)
    };
  });
}

async function saveVoid(sale) {
  return runTransaction(db, async (transaction) => {
    const saleRef = doc(db, "sales", sale.id);
    const existingSnapshot = await transaction.get(saleRef);
    if (!existingSnapshot.exists()) {
      const integrationJobSnapshots = await readCheckoutIntegrationJobs(transaction, sale);
      transaction.set(saleRef, {
        ...sale,
        syncStatus: "synced",
        syncedAt: serverTimestamp()
      }, { merge: true });
      cancelOpenIntegrationJobs(transaction, integrationJobSnapshots, sale.id);
      return {
        status: "voided",
        stockStatus: "not-required",
        inventoryReview: sale.inventoryReview || null
      };
    }

    const existingSale = existingSnapshot.data();
    if (existingSale.status === "voided") {
      return {
        status: "already-voided",
        stockStatus: existingSale.inventoryReview?.status === "required" ? "review-required" : "already-processed",
        inventoryReview: existingSale.inventoryReview || null
      };
    }

    const integrationJobSnapshots = await readCheckoutIntegrationJobs(transaction, existingSale);
    const hadInventoryConflict = existingSale.inventoryReview?.status === "required";
    const saleItems = Array.isArray(existingSale.items) ? existingSale.items : (sale.items || []);
    const productSnapshots = [];
    if (!hadInventoryConflict) {
      for (const item of saleItems) {
        productSnapshots.push(await transaction.get(doc(db, "products", item.id)));
      }
    }

    const missingProducts = productSnapshots.flatMap((snapshot, index) => {
      if (snapshot.exists()) return [];
      const item = saleItems[index];
      return [{
        productId: item.id,
        productName: item.name,
        requestedQty: Number(item.qty || 0),
        cloudStock: null,
        reason: "退款回补时云端商品不存在"
      }];
    });

    let inventoryReview = existingSale.inventoryReview || sale.inventoryReview || null;
    if (hadInventoryConflict) {
      inventoryReview = {
        ...inventoryReview,
        status: "resolved",
        resolvedAt: sale.voidedAt || new Date().toISOString(),
        resolvedBy: sale.voidedBy || null,
        resolution: "order-voided"
      };
    } else if (missingProducts.length) {
      inventoryReview = {
        status: "required",
        type: "void-restock",
        detectedAt: new Date().toISOString(),
        branchId: existingSale.branchId || sale.branchId,
        conflicts: missingProducts
      };
    } else {
      productSnapshots.forEach((snapshot, index) => {
        const item = saleItems[index];
        const product = snapshot.data();
        const branchId = existingSale.branchId || sale.branchId;
        const branchStock = { ...(product.branchStock || {}) };
        branchStock[branchId] = Number(branchStock[branchId] || 0) + Number(item.qty || 0);
        transaction.update(snapshot.ref, {
          branchStock,
          stock: branchId === "hq" ? branchStock[branchId] : product.stock,
          updatedAt: serverTimestamp()
        });
      });
    }

    const voidedSale = {
      ...existingSale,
      ...sale,
      status: "voided",
      inventoryReview
    };
    const integrationJobs = writeIntegrationJobs(transaction, voidedSale, "void");
    transaction.update(saleRef, {
      status: "voided",
      voidedAt: sale.voidedAt || new Date().toISOString(),
      voidedBy: sale.voidedBy || null,
      integrationOutbox: sale.integrationOutbox || existingSale.integrationOutbox || null,
      inventoryReview,
      syncStatus: missingProducts.length ? "review-required" : "synced",
      updatedAt: serverTimestamp(),
      syncedAt: serverTimestamp()
    });
    cancelOpenIntegrationJobs(transaction, integrationJobSnapshots, sale.id);
    return {
      status: "voided",
      stockStatus: hadInventoryConflict
        ? "not-required"
        : (missingProducts.length ? "review-required" : "restored"),
      inventoryReview,
      integrationJobIds: integrationJobs.map((job) => job.id)
    };
  });
}

async function signInWithGoogle() {
  await signInWithPopup(auth, provider);
}

async function signOutGoogle() {
  await signOut(auth);
}

async function refreshAffiliateCatalog() {
  const result = await httpsCallable(cloudFunctions, "refreshAffiliateCatalog")({});
  return result.data;
}

async function loadIntegrationJobs() {
  const snapshot = await getDocs(query(
    collection(db, "integrationJobs"),
    orderBy("cloudUpdatedAt", "desc"),
    limit(50)
  ));
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      ...data,
      cloudUpdatedAt: data.cloudUpdatedAt?.toDate
        ? data.cloudUpdatedAt.toDate().toISOString()
        : data.cloudUpdatedAt
    };
  });
}

async function retryIntegrationJob(jobId) {
  const result = await httpsCallable(cloudFunctions, "retryIntegrationJob")({ jobId });
  return result.data;
}

async function checkIntegrationConnections() {
  const result = await httpsCallable(cloudFunctions, "checkIntegrationConnections")({});
  return result.data;
}

async function traceIntegrationOrder(posOrderId) {
  const result = await httpsCallable(cloudFunctions, "traceIntegrationOrder")({ posOrderId });
  return result.data;
}

window.cloudPOS = {
  auth,
  db,
  signInWithGoogle,
  signOutGoogle,
  getCloudUser,
  refreshAuthorization,
  loadCollection,
  loadAllData,
  loadUserData,
  saveBranch,
  saveAuthorizedUser,
  saveProduct,
  deleteProduct,
  saveStockAdjustment,
  saveAuditLog,
  saveSettings,
  loadSettings,
  loadSale,
  saveSale,
  saveCheckout,
  saveVoid,
  refreshAffiliateCatalog,
  loadIntegrationJobs,
  retryIntegrationJob,
  checkIntegrationConnections,
  traceIntegrationOrder
};

onAuthStateChanged(auth, async (firebaseUser) => {
  if (!firebaseUser) {
    emit("cloud-auth-change", { firebaseUser: null, appUser: null });
    return;
  }

  try {
    const appUser = await getCloudUser(firebaseUser.email);
    emit("cloud-auth-change", { firebaseUser, appUser });
  } catch (error) {
    emit("cloud-error", { message: error.message });
  }
});

emit("cloud-ready", { projectId: firebaseConfig.projectId });
