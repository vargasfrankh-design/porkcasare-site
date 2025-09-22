// js/comisiones.js
// Usa auth & db ya inicializados en tu módulo firebase.js
// Asegúrate de que existe: export { auth, db } from './firebase.js'

// Firestore / Auth helpers (v10)
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// IMPORTA tus instancias ya inicializadas (ajusta la ruta si tu archivo está en otra carpeta)
import { auth, db } from "/src/firebase-config.js"; // <-- si tu archivo se llama distinto, cámbialo

// -------- Elementos DOM (de tu index.html) --------
const elTotal = document.getElementById("totalCommissions");
const elPending = document.getElementById("pendingCommissions");
const elWallet = document.getElementById("walletBalance");
const btnCobrar = document.getElementById("btnCobrar");
const lastTxInfo = document.getElementById("lastTxInfo");
const refInput = document.getElementById("refCode");
const historyEl = document.getElementById("history");

// -------- Utilidades --------
function formatCurrency(amount = 0) {
  try {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
      .format(Number(amount));
  } catch {
    return "$" + Number(amount).toLocaleString();
  }
}

function showCommissionsUI({ total = 0, pending = 0, wallet = 0 } = {}) {
  if (elTotal) elTotal.textContent = formatCurrency(total);
  if (elPending) {
    elPending.textContent = formatCurrency(pending);
    elPending.classList.toggle("pending", pending > 0);
  }
  if (elWallet) elWallet.textContent = formatCurrency(wallet);
}

// -------- Firestore listeners & helpers --------
let unsubscribeUserDoc = null;
let unsubscribeTxs = null;

function attachRealtimeUserAndTransactions(uid) {
  const userRef = doc(db, "usuarios", uid);

  // user doc listener
  if (unsubscribeUserDoc) { try { unsubscribeUserDoc(); } catch {} unsubscribeUserDoc = null; }
  unsubscribeUserDoc = onSnapshot(userRef, (snap) => {
    if (!snap.exists()) {
      // No existe: inicializamos (función inicializadora hará update)
      initializeUserDoc(uid).catch(console.error);
      showCommissionsUI({ total: 0, pending: 0, wallet: 0 });
      return;
    }
    const d = snap.data();
    const pending = Number(d.balance ?? 0);
    // totalCommissions debe reflejar todo lo generado históricamente
    const total = d.totalCommissions !== undefined ? Number(d.totalCommissions) : pending;
    const wallet = Number(d.walletBalance ?? 0);
    if (refInput && d.referralLink) refInput.value = d.referralLink;
    showCommissionsUI({ total, pending, wallet });
  }, (err) => console.error("user onSnapshot error:", err));

  // transactions listener (últimos 50)
  if (unsubscribeTxs) { try { unsubscribeTxs(); } catch {} unsubscribeTxs = null; }
  const txCol = collection(db, "usuarios", uid, "transactions");
  const txQ = query(txCol, orderBy("timestamp", "desc"), limit(50));
  unsubscribeTxs = onSnapshot(txQ, (snap) => {
    const txs = [];
    snap.forEach(docSnap => txs.push({ id: docSnap.id, ...docSnap.data() }));
    renderHistory(txs);
  }, (err) => console.error("transactions onSnapshot error:", err));
}

async function initializeUserDoc(uid) {
  const uRef = doc(db, "usuarios", uid);
  try {
    await runTransaction(db, async (tx) => {
      const s = await tx.get(uRef);
      if (!s.exists()) {
        // creamos con merge / set
        tx.set ? tx.set(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0, createdAt: serverTimestamp() }) : null;
      } else {
        const data = s.data();
        const updates = {};
        if (data.balance === undefined) updates.balance = 0;
        if (data.totalCommissions === undefined) updates.totalCommissions = 0;
        if (data.walletBalance === undefined) updates.walletBalance = 0;
        if (Object.keys(updates).length) tx.update(uRef, updates);
      }
    });
  } catch (e) {
    // fallback: intentar update simple si runTransaction falla
    const snap = await getDocSafe(doc(db, "usuarios", uid));
    if (!snap || !snap.exists()) {
      try { await updateDoc(doc(db, "usuarios", uid), { balance: 0, totalCommissions: 0, walletBalance: 0 }); } catch {}
    }
  }
}

// helper seguro getDoc (evita crash si import faltante)
async function getDocSafe(ref) {
  try {
    // dynamic import of getDoc to avoid duplicate import name above
    const mod = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    return await mod.getDoc(ref);
  } catch (e) {
    console.warn("getDocSafe failed", e);
    return null;
  }
}

// -------- Registrar earning (usar cuando generes comisiones) --------
async function addEarnings(uid, amount = 0, meta = {}) {
  if (!uid) throw new Error("Usuario no autenticado");
  amount = Number(amount);
  if (isNaN(amount) || amount <= 0) throw new Error("Monto inválido");

  const uRef = doc(db, "usuarios", uid);
  let txResult = null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    const data = snap.exists() ? snap.data() : {};
    const oldBalance = Number(data.balance ?? 0);
    const oldTotal = Number(data.totalCommissions ?? 0);
    const newBalance = oldBalance + amount;
    const newTotal = oldTotal + amount;
    // usar set con merge si tx.set disponible, si no update
    if (tx.set) {
      tx.set(uRef, { balance: newBalance, totalCommissions: newTotal }, { merge: true });
    } else {
      tx.update(uRef, { balance: newBalance, totalCommissions: newTotal });
    }
    txResult = { newBalance, newTotal };
  });

  // registrar transacción
  try {
    const txCol = collection(db, "usuarios", uid, "transactions");
    await addDoc(txCol, { type: "earning", amount, meta: meta || {}, timestamp: serverTimestamp() });
  } catch (err) {
    console.warn("addEarnings: registrar transaction falló", err);
  }

  return txResult;
}

// -------- Cobrar (balance -> walletBalance) --------
async function cobrarPending(uid, amount = null) {
  if (!uid) throw new Error("Usuario no autenticado");

  if (window.Swal) {
    const res = await Swal.fire({
      title: "¿Deseas cobrar ahora?",
      text: amount ? `Se cobrará ${formatCurrency(amount)}.` : "Se cobrará todo tu balance disponible.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Sí, cobrar"
    });
    if (!res.isConfirmed) return null;
  }

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
    tx.update(uRef, { balance: newBalance, walletBalance: newWallet });
    result = { withdrawn: toWithdraw, newBalance, newWallet };
  });

  // registrar withdraw
  try {
    const txCol = collection(db, "usuarios", uid, "transactions");
    await addDoc(txCol, { type: "withdraw", amount: result.withdrawn, timestamp: serverTimestamp(), note: "Cobro desde UI" });
  } catch (err) {
    console.warn("cobrarPending: registrar withdraw falló", err);
  }

  if (window.Swal) Swal.fire("¡Hecho!", `Se transfirieron ${formatCurrency(result.withdrawn)} a tu balance.`, "success");
  return result;
}

// -------- Render historial --------
function renderHistory(txs = []) {
  if (!historyEl) return;
  if (!txs.length) {
    historyEl.innerHTML = '<div class="history-empty">No hay transacciones aún.</div>';
    return;
  }
  historyEl.innerHTML = txs.map(tx => {
    const date = tx.timestamp && tx.timestamp.toDate ? tx.timestamp.toDate() : (tx.timestamp ? new Date(tx.timestamp) : new Date());
    const when = date.toLocaleString();
    if (tx.type === "earning") {
      return `<div class="entry"><div><strong>+ ${formatCurrency(tx.amount)}</strong> — Comisión</div><div class="muted">${when}${tx.meta?.action ? ' • ' + tx.meta.action : ''}</div></div>`;
    } else if (tx.type === "withdraw") {
      return `<div class="entry"><div><strong>- ${formatCurrency(tx.amount)}</strong> — Cobro</div><div class="muted">${when}${tx.note ? ' • ' + tx.note : ''}</div></div>`;
    } else {
      return `<div class="entry"><div><strong>${formatCurrency(tx.amount)}</strong> — ${tx.type}</div><div class="muted">${when}</div></div>`;
    }
  }).join("");
}

// -------- Auth hookup (usa tu auth exportado) --------
onAuthStateChanged(auth, async (user) => {
  // limpiar listeners previos
  if (unsubscribeUserDoc) { try { unsubscribeUserDoc(); } catch {} unsubscribeUserDoc = null; }
  if (unsubscribeTxs) { try { unsubscribeTxs(); } catch {} unsubscribeTxs = null; }

  if (!user) {
    showCommissionsUI({ total: 0, pending: 0, wallet: 0 });
    if (btnCobrar) { btnCobrar.disabled = true; btnCobrar.textContent = "Cobrar"; }
    if (historyEl) historyEl.innerHTML = '<div class="history-empty">Inicia sesión para ver historial.</div>';
    return;
  }

  const uid = user.uid;
  await initializeUserDoc(uid).catch(console.error);
  attachRealtimeUserAndTransactions(uid);

  // configurar botón Cobrar (evitar listeners duplicados)
  if (btnCobrar) {
    btnCobrar.disabled = false;
    btnCobrar.textContent = "Cobrar";
    const newBtn = btnCobrar.cloneNode(true);
    btnCobrar.parentNode.replaceChild(newBtn, btnCobrar);
    newBtn.addEventListener("click", async () => {
      newBtn.disabled = true;
      newBtn.textContent = "Procesando...";
      try { await cobrarPending(uid); } catch (e) { console.error(e); } finally {
        newBtn.disabled = false;
        newBtn.textContent = "Cobrar";
      }
    });
  }
});

// -------- Exports (para poder usar addEarnings desde otros módulos) --------
export { addEarnings, cobrarPending, initializeUserDoc, formatCurrency };
