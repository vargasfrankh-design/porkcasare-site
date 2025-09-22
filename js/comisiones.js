// comisiones_reparado.js
// Repaired/completed version of js/comisiones.js
// Asegúrate de que la ruta a firebase-config.js es correcta en tu proyecto (ej. /src/firebase-config.js)
// Nota: incluye console.log para verificar carga.
console.log("comisiones_reparado.js cargado");

// IMPORTS (ajusta versiones si necesitas)
import {
  doc, getDoc, onSnapshot, runTransaction, collection, addDoc, serverTimestamp,
  updateDoc, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth, db } from "/src/firebase-config.js"; // asegúrate de que la ruta coincide

// DOM elements (asegúrate de que existen en el HTML)
const elTotal = document.getElementById("totalCommissions");
const elPending = document.getElementById("pendingCommissions");
const elWallet = document.getElementById("walletBalance");
const btnCobrar = document.getElementById("btnCobrar");
const lastTxInfo = document.getElementById("lastTxInfo");
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

// Render simple del historial (puedes adaptar diseño)
function renderHistory(txs = []) {
  if (!historyEl) return;
  if (!txs.length) {
    historyEl.innerHTML = '<div class="history-empty">No hay transacciones aún.</div>';
    return;
  }
  historyEl.innerHTML = txs.map(tx => {
    const ts = tx.timestamp && tx.timestamp.toDate ? tx.timestamp.toDate() : (tx.timestamp ? new Date(tx.timestamp) : new Date());
    const when = ts.toLocaleString();
    if (tx.type === "earning") {
      return `<div class="entry"><div><strong>+ ${formatCurrency(tx.amount)}</strong></div><div class="muted">${when}${tx.meta?.action ? ' • ' + tx.meta.action : ''}</div></div>`;
    } else if (tx.type === "withdraw") {
      return `<div class="entry"><div><strong>- ${formatCurrency(tx.amount)}</strong></div><div class="muted">${when}${tx.note ? ' • ' + tx.note : ''}</div></div>`;
    } else {
      return `<div class="entry"><div><strong>${formatCurrency(tx.amount)} — ${tx.type}</strong></div><div class="muted">${when}</div></div>`;
    }
  }).join("");
}

// Subscribir datos en tiempo real del usuario
let unsubscribeUserDoc = null;
let unsubscribeTxs = null;
function attachRealtimeForUser(uid) {
  if (!uid) return;
  // user doc
  if (unsubscribeUserDoc) { try { unsubscribeUserDoc(); } catch {} unsubscribeUserDoc = null; }
  const uRef = doc(db, "usuarios", uid);
  unsubscribeUserDoc = onSnapshot(uRef, (snap) => {
    const data = snap.exists() ? snap.data() : {};
    const pending = Number(data.balance ?? 0);
    const total = Number(data.totalCommissions ?? pending);
    const wallet = Number(data.walletBalance ?? 0);
    if (elPending) elPending.textContent = formatCurrency(pending);
    if (elTotal) elTotal.textContent = formatCurrency(total);
    if (elWallet) elWallet.textContent = formatCurrency(wallet);
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

// Asegurarse de que el doc de usuario tiene campos básicos
async function initializeUserDoc(uid) {
  const uRef = doc(db, "usuarios", uid);
  try {
    await runTransaction(db, async (tx) => {
      const s = await tx.get(uRef);
      if (!s.exists()) {
        tx.set(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0, createdAt: serverTimestamp() }, { merge: true });
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
    console.warn("initializeUserDoc transaction failed:", e);
    // no fatal, pero sería bueno revisar consola si esto ocurre
  }
}

// Registrar earning (ej. cuando generas comisiones)
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
    tx.set(uRef, { balance: newBalance, totalCommissions: newTotal }, { merge: true });
    txResult = { newBalance, newTotal };
  });

  try {
    const txCol = collection(db, "usuarios", uid, "transactions");
    await addDoc(txCol, {
      type: "earning",
      amount,
      timestamp: serverTimestamp(),
      meta,
      ownerUid: uid
    });
  } catch (e) {
    console.error("addEarnings addDoc error:", e);
    throw e;
  }
  return txResult;
}

// Cobrar balance pendiente -> mueve a wallet / registra withdraw
async function cobrarPending(uid, amount = null) {
  if (!uid) throw new Error("Usuario no autenticado");

  // Confirmación opcional con SweetAlert si está disponible
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

  try {
    const txCol = collection(db, "usuarios", uid, "transactions");
    await addDoc(txCol, {
      type: "withdraw",
      amount: result.withdrawn,
      timestamp: serverTimestamp(),
      note: "Cobro desde UI",
      ownerUid: uid
    });
  } catch (err) {
    console.error("cobrarPending addDoc error:", err);
    throw err;
  }

  if (window.Swal) Swal.fire("¡Hecho!", `Se transfirieron ${formatCurrency(result.withdrawn)} a tu wallet.`, "success");
  return result;
}

// Hook auth
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // usuario no autenticado: desactivar botón
    if (btnCobrar) btnCobrar.disabled = true;
    if (unsubscribeUserDoc) { try { unsubscribeUserDoc(); } catch {} unsubscribeUserDoc = null; }
    if (unsubscribeTxs) { try { unsubscribeTxs(); } catch {} unsubscribeTxs = null; }
    return;
  }
  const uid = user.uid;
  // inicializar doc por si no existe
  await initializeUserDoc(uid);
  attachRealtimeForUser(uid);

  // conectar botón cobrar
  if (btnCobrar) {
    const newBtn = btnCobrar.cloneNode(true);
    btnCobrar.parentNode.replaceChild(newBtn, btnCobrar);
    newBtn.disabled = false;
    newBtn.addEventListener("click", async () => {
      newBtn.disabled = true;
      newBtn.textContent = "Procesando...";
      try {
        await cobrarPending(uid);
      } catch (e) {
        console.error("Error cobrando:", e);
        if (window.Swal) Swal.fire("Error", e.message || "Error al cobrar", "error");
      } finally {
        newBtn.disabled = false;
        newBtn.textContent = "Cobrar";
      }
    });
  }
});

// Exporta funciones si quieres usarlas desde otros módulos
export { addEarnings, cobrarPending, initializeUserDoc, formatCurrency };
