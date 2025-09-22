// comisiones_reparado_both.js
// Versión reparada que mantiene la subcolección usuarios/{uid}/transactions
// y además muestra en el index ambas fuentes (campo history[] y subcolección transactions).
// Ajusta la ruta a firebase-config.js si es necesario.

console.log("comisiones_reparado_both.js cargado");

// IMPORTS (Firebase v10 modular)
import {
  doc, collection, addDoc, serverTimestamp, arrayUnion,
  onSnapshot, query, orderBy, limit, runTransaction, updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth, db } from "/src/firebase-config.js"; // ajusta si tu ruta es distinta

// DOM elements — ajusta IDs a tu HTML
const elTotal = document.getElementById("totalCommissions");
const elPending = document.getElementById("pendingCommissions");
const elWallet = document.getElementById("walletBalance");
const btnCobrar = document.getElementById("btnCobrar");
const historyEl = document.getElementById("history");

// Utilidades
function formatCurrency(amount = 0) {
  try {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
      .format(Number(amount));
  } catch {
    return "$" + Number(amount).toLocaleString();
  }
}

// ---- Manejo combinado de historiales ----
let unsubscribeUserDoc = null;
let unsubscribeTxs = null;

let userHistoryArray = []; // entries desde usuarios/{uid}.history (campo array)
let txDocsArray = [];      // entries desde usuarios/{uid}/transactions (subcolección)

// Normaliza entrada a formato común
function normalizeEntry(entry, source, docId = null) {
  let ts = entry.timestamp ?? entry.date ?? null;
  if (ts && typeof ts.toDate === "function") {
    ts = ts.toDate();
  } else if (ts && typeof ts.seconds === "number") {
    ts = new Date(ts.seconds * 1000);
  } else if (typeof ts === "string" || typeof ts === "number") {
    ts = new Date(ts);
  } else {
    ts = new Date();
  }

  const id = docId ? `tx_${docId}` : `h_${ts.getTime()}_${entry.type || 'x'}_${entry.amount ?? 0}`;

  return {
    _id: id,
    source,
    type: entry.type || "unknown",
    amount: Number(entry.amount ?? 0),
    ts,
    meta: entry.meta || {},
    note: entry.note || entry.action || "",
    raw: entry
  };
}

function buildCombinedList() {
  const all = [];
  userHistoryArray.forEach(e => all.push(normalizeEntry(e, "historyField", null)));
  txDocsArray.forEach(e => all.push(normalizeEntry(e.data, "transactionsCollection", e.id)));

  // Deduplicate by _id
  const map = new Map();
  for (const it of all) map.set(it._id, it);
  const merged = Array.from(map.values());

  // Sort desc by timestamp
  merged.sort((a, b) => b.ts - a.ts);
  return merged;
}

function renderCombinedHistory() {
  const merged = buildCombinedList();
  if (!historyEl) return;
  if (!merged.length) {
    historyEl.innerHTML = '<div class="history-empty">No hay transacciones aún.</div>';
    return;
  }

  historyEl.innerHTML = merged.map(entry => {
    const when = entry.ts.toLocaleString();
    const sign = entry.type === "withdraw" ? "-" : (entry.type === "earning" ? "+" : "");
    const desc = entry.note || (entry.meta && entry.meta.action) || entry.type;
    return `
      <div class="entry">
        <div><strong>${sign} ${formatCurrency(entry.amount)}</strong></div>
        <div class="muted">${when} • ${desc} <span class="source">(${entry.source})</span></div>
      </div>
    `;
  }).join("");
}

// Attach listeners para ambas fuentes
function attachRealtimeForUserBoth(uid) {
  if (!uid) return;

  if (unsubscribeUserDoc) { try { unsubscribeUserDoc(); } catch {} unsubscribeUserDoc = null; }
  if (unsubscribeTxs) { try { unsubscribeTxs(); } catch {} unsubscribeTxs = null; }

  const uRef = doc(db, "usuarios", uid);
  unsubscribeUserDoc = onSnapshot(uRef, (snap) => {
    const data = snap.exists() ? snap.data() : {};
    if (Array.isArray(data.history)) {
      userHistoryArray = data.history.slice();
    } else {
      userHistoryArray = [];
    }

    // Actualiza balances visibles si existen
    if (elPending) elPending.textContent = formatCurrency(Number(data.balance ?? 0));
    if (elTotal) elTotal.textContent = formatCurrency(Number(data.totalCommissions ?? 0));
    if (elWallet) elWallet.textContent = formatCurrency(Number(data.walletBalance ?? 0));

    renderCombinedHistory();
  }, (err) => console.error("onSnapshot usuarios error:", err));

  const txCol = collection(db, "usuarios", uid, "transactions");
  const txQ = query(txCol, orderBy("timestamp", "desc"), limit(200));
  unsubscribeTxs = onSnapshot(txQ, (snap) => {
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, data: d.data() }));
    txDocsArray = arr;
    renderCombinedHistory();
  }, (err) => console.error("onSnapshot transactions error:", err));
}

// ---- Funciones para crear transacciones (escriben en subcolección y actualizan el campo history[]) ----

// Añade earning: actualiza balances (transaction), push a history[] y crea doc en subcolección
async function addEarnings(uid, amount = 0, meta = {}) {
  if (!uid) throw new Error("Usuario no autenticado");
  amount = Number(amount);
  if (isNaN(amount) || amount <= 0) throw new Error("Monto inválido");

  const uRef = doc(db, "usuarios", uid);
  // Entrada para history[]
  const entry = {
    type: "earning",
    amount,
    timestamp: serverTimestamp(),
    meta,
    note: meta.action || "",
    by: meta.by || (auth.currentUser ? auth.currentUser.uid : "system")
  };

  // Transaction: actualizar balances y push a history[]
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    const data = snap.exists() ? snap.data() : {};
    const oldBalance = Number(data.balance ?? 0);
    const oldTotal = Number(data.totalCommissions ?? 0);
    const newBalance = oldBalance + amount;
    const newTotal = oldTotal + amount;
    tx.update(uRef, {
      balance: newBalance,
      totalCommissions: newTotal,
      history: arrayUnion(entry)
    });
  });

  // Crear documento en subcolección transactions (no dentro de la transaction)
  const txCol = collection(db, "usuarios", uid, "transactions");
  await addDoc(txCol, {
    type: "earning",
    amount,
    timestamp: serverTimestamp(),
    meta,
    ownerUid: uid
  });

  return { success: true };
}

// Cobrar balance pendiente: transaction para balances + history[], y doc en subcolección
async function cobrarPending(uid, amount = null) {
  if (!uid) throw new Error("Usuario no autenticado");

  const uRef = doc(db, "usuarios", uid);
  let result = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    if (!snap.exists()) throw new Error("Usuario no encontrado");
    const data = snap.data();
    const currentBalance = Number(data.balance ?? 0);
    const wallet = Number(data.walletBalance ?? 0);
    const toWithdraw = (amount === null || amount === undefined) ? currentBalance : Number(amount);
    if (isNaN(toWithdraw) || toWithdraw <= 0) throw new Error("Monto inválido");
    if (toWithdraw > currentBalance) throw new Error("Saldo insuficiente");
    const newBalance = currentBalance - toWithdraw;
    const newWallet = wallet + toWithdraw;

    const entry = {
      type: "withdraw",
      amount: toWithdraw,
      timestamp: serverTimestamp(),
      note: "Cobro desde UI",
      by: (auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : "system"
    };

    tx.update(uRef, {
      balance: newBalance,
      walletBalance: newWallet,
      history: arrayUnion(entry)
    });

    result = { withdrawn: toWithdraw, newBalance, newWallet };
  });

  // Registrar en subcolección
  const txCol = collection(db, "usuarios", uid, "transactions");
  await addDoc(txCol, {
    type: "withdraw",
    amount: result.withdrawn,
    timestamp: serverTimestamp(),
    note: "Cobro desde UI",
    ownerUid: uid
  });

  return result;
}

// ---- Hook de autenticación: conectar listeners y botón cobrar ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (btnCobrar) btnCobrar.disabled = true;
    if (unsubscribeUserDoc) { try { unsubscribeUserDoc(); } catch {} unsubscribeUserDoc = null; }
    if (unsubscribeTxs) { try { unsubscribeTxs(); } catch {} unsubscribeTxs = null; }
    return;
  }
  const uid = user.uid;

  // Inicializa campos mínimos si es necesario (no obligatorio aquí)
  try {
    await runTransaction(db, async (tx) => {
      const uRef = doc(db, "usuarios", uid);
      const s = await tx.get(uRef);
      if (!s.exists()) {
        tx.set(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0, history: [], createdAt: serverTimestamp() });
      } else {
        const data = s.data();
        const updates = {};
        if (data.balance === undefined) updates.balance = 0;
        if (data.totalCommissions === undefined) updates.totalCommissions = 0;
        if (data.walletBalance === undefined) updates.walletBalance = 0;
        if (!Array.isArray(data.history)) updates.history = [];
        if (Object.keys(updates).length) tx.update(uRef, updates);
      }
    });
  } catch (e) {
    console.warn("initializeUserDoc failed:", e);
  }

  // Attach listeners for both sources
  attachRealtimeForUserBoth(uid);

  // Conectar botón cobrar (clonar para evitar múltiples listeners)
  if (btnCobrar) {
    const newBtn = btnCobrar.cloneNode(true);
    btnCobrar.parentNode.replaceChild(newBtn, btnCobrar);
    newBtn.disabled = false;
    newBtn.addEventListener("click", async () => {
      newBtn.disabled = true;
      const originalText = newBtn.textContent;
      newBtn.textContent = "Procesando...";
      try {
        await cobrarPending(uid);
        console.log("Cobro realizado");
      } catch (e) {
        console.error("Error cobrando:", e);
        if (window.Swal) Swal.fire("Error", e.message || "Error al cobrar", "error");
      } finally {
        newBtn.disabled = false;
        newBtn.textContent = originalText || "Cobrar";
      }
    });
  }
});

// Exportar funciones útiles
export { addEarnings, cobrarPending, attachRealtimeForUserBoth, normalizeEntry };
