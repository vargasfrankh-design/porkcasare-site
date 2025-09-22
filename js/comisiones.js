// js/comisiones.js
// Archivo completo y corregido para gestionar comisiones, wallet y cobros.
// Reemplaza el archivo existente en tu proyecto por este.

// Importar auth y db inicializados en /src/firebase-config.js
import { auth, db } from "/src/firebase-config.js";

// Firestore modular (v10)
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

/* ----------------- Helpers ----------------- */

function formatCurrency(v = 0) {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v));
  } catch (e) {
    return `$${Number(v).toLocaleString()}`;
  }
}

/* Elementos del DOM (pueden ser null si no están presentes) */
const elPending = document.getElementById("pendingCommissions");
const elWallet = document.getElementById("walletBalance");
const btnCobrar = document.getElementById("btnCobrar");
const lastTxInfo = document.getElementById("lastTxInfo");
const refInput = document.getElementById("refCode");
const historyEl = document.getElementById("history") || document.getElementById("historyWrap");

/* Estado de suscripciones a listeners para poder limpiarlas */
let unsubscribeUserDoc = null;
let unsubscribeTxs = null;

/* Inicializar el documento del usuario si no existe (merge para no borrar campos) */
export async function initializeUserDoc(uid) {
  const uRef = doc(db, "usuarios", uid);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(uRef);
      if (!snap.exists()) {
        tx.set(uRef, {
          balance: 0,
          totalCommissions: 0,
          walletBalance: 0,
          createdAt: serverTimestamp()
        }, { merge: true });
      } else {
        const data = snap.data();
        const updates = {};
        if (data.balance === undefined) updates.balance = 0;
        if (data.totalCommissions === undefined) updates.totalCommissions = 0;
        if (data.walletBalance === undefined) updates.walletBalance = 0;
        if (Object.keys(updates).length) {
          tx.update(uRef, updates);
        }
      }
    });
    return true;
  } catch (err) {
    console.error("initializeUserDoc error:", err);
    throw err;
  }
}

/* Añadir un earning (registro de ganancia) en subcolección transactions */
export async function addEarnings(uid, { amount = 0, meta = {}, timestamp = null } = {}) {
  try {
    const txCol = collection(db, "usuarios", uid, "transactions");
    const txResult = await addDoc(txCol, {
      type: "earning",
      amount: Number(amount),
      meta: meta || {},
      timestamp: timestamp || serverTimestamp(),
      ownerUid: uid
    });
    return txResult;
  } catch (err) {
    console.warn("addEarnings error:", err);
    throw err;
  }
}

/* ----------------- Cobrar (transferir balance -> walletBalance) -----------------
   - Verifica saldo, actualiza el documento del usuario dentro de una transacción,
   - registra el withdraw en usuarios/{uid}/transactions,
   - y agrega una entrada en users.history usando arrayUnion para compatibilidad UI.
*/
export async function cobrarPending(uid, amount = null) {
  if (!uid) throw new Error("Usuario no autenticado");

  // Si existe SweetAlert2 (Swal), pedir confirmación al usuario
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

  // Actualizar balances en una transacción
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

  // Registrar withdraw en la subcolección transactions y añadir a history del doc usuario
  try {
    const txCol = collection(db, "usuarios", uid, "transactions");
    const txRef = await addDoc(txCol, {
      type: "withdraw",
      amount: result.withdrawn,
      timestamp: serverTimestamp(),
      note: "Cobro desde UI",
      ownerUid: uid
    });

    // Añadir registro también al array `history` en el documento del usuario (compatibilidad UI)
    try {
      await updateDoc(uRef, {
        history: arrayUnion({
          action: "Cobro",
          amount: result.withdrawn,
          date: new Date().toISOString(),
          points: 0,
          orderId: txRef.id
        })
      });
    } catch (err2) {
      console.warn("cobrarPending: update history falló", err2);
    }

  } catch (err) {
    console.warn("cobrarPending: registrar withdraw falló", err);
  }

  if (window.Swal) Swal.fire("¡Hecho!", `Se transfirieron ${formatCurrency(result.withdrawn)} a tu balance.`, "success");
  return result;
}

/* ----------------- Render historial (transactions) ----------------- */
/* renderHistory espera un array de txs con campos tipo, amount, timestamp, meta, note */
function renderHistory(txs = []) {
  if (!historyEl) return;
  if (!txs || !txs.length) {
    historyEl.innerHTML = '<div class="history-empty">No hay transacciones aún.</div>';
    return;
  }

  historyEl.innerHTML = txs.map(tx => {
    // timestamp puede ser un Timestamp de Firestore o un ISO/string
    const date = tx.timestamp && tx.timestamp.toDate ? tx.timestamp.toDate() : (tx.timestamp ? new Date(tx.timestamp) : new Date());
    const when = date.toLocaleString();

    if (tx.type === "earning") {
      // mostrar una entrada positiva
      return `<div class="entry">
                <div>
                  <strong>+ ${formatCurrency(tx.amount)}</strong> — Comisión
                </div>
                <div class="muted">${when}${tx.meta?.action ? ' • ' + tx.meta.action : ''}</div>
              </div>`;
    } else if (tx.type === "withdraw") {
      return `<div class="entry">
                <div><strong>- ${formatCurrency(tx.amount)}</strong> — Cobro</div>
                <div class="muted">${when}${tx.note ? ' • ' + tx.note : ''}</div>
              </div>`;
    } else {
      // otro tipo
      return `<div class="entry"><div><strong>${formatCurrency(tx.amount)}</strong> — ${tx.type}</div><div class="muted">${when}</div></div>`;
    }
  }).join("");
}

/* ----------------- Listeners en tiempo real: usuario + transactions ----------------- */
export function attachRealtimeUserAndTransactions(uid) {
  const userRef = doc(db, "usuarios", uid);

  // user doc listener
  if (unsubscribeUserDoc) {
    try { unsubscribeUserDoc(); } catch {}
    unsubscribeUserDoc = null;
  }
  unsubscribeUserDoc = onSnapshot(userRef, (snap) => {
    if (!snap.exists()) {
      // Inicializar si no existe
      initializeUserDoc(uid).catch(console.error);
      showCommissionsUI({ total: 0, pending: 0, wallet: 0 });
      return;
    }
    const d = snap.data();
    const pending = Number(d.balance ?? 0);
    const total = d.totalCommissions !== undefined ? Number(d.totalCommissions) : pending;
    const wallet = Number(d.walletBalance ?? 0);
    if (refInput && d.referralLink) refInput.value = d.referralLink;
    showCommissionsUI({ total, pending, wallet });
  }, (err) => console.error("user onSnapshot error:", err));

  // transactions listener (últimos 50)
  if (unsubscribeTxs) {
    try { unsubscribeTxs(); } catch {}
    unsubscribeTxs = null;
  }
  const txCol = collection(db, "usuarios", uid, "transactions");
  const txQ = query(txCol, orderBy("timestamp", "desc"), limit(50));
  console.log("attachRealtime for uid:", uid, "path: usuarios/" + uid + "/transactions");
  unsubscribeTxs = onSnapshot(txQ, (snap) => {
    const txs = [];
    snap.forEach(docSnap => txs.push({ id: docSnap.id, ...docSnap.data() }));
    renderHistory(txs);
  }, (err) => console.error("transactions onSnapshot error:", err));
}

/* ----------------- UI helpers ----------------- */
function showCommissionsUI({ total = 0, pending = 0, wallet = 0 } = {}) {
  if (elPending) {
    elPending.textContent = formatCurrency(pending);
    // marcar como 'pending' si > 0
    if (pending > 0) elPending.classList.add('pending'); else elPending.classList.remove('pending');
  }
  if (elWallet) {
    elWallet.textContent = formatCurrency(wallet);
  }
  if (btnCobrar) {
    // habilitar si wallet > 0 y pending > 0 (regla de negocio adaptable)
    const canWithdraw = Number(wallet) > 0 && Number(pending) > 0;
    btnCobrar.disabled = !canWithdraw;
    btnCobrar.textContent = "Cobrar";
  }
}

/* ----------------- Inicialización: detectar usuario autenticado ----------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // limpiar UI cuando no hay usuario
    showCommissionsUI({ total: 0, pending: 0, wallet: 0 });
    if (historyEl) historyEl.innerHTML = '<div class="history-empty">Inicia sesión para ver historial.</div>';
    // quitar listeners
    if (unsubscribeUserDoc) { try { unsubscribeUserDoc(); } catch {} unsubscribeUserDoc = null; }
    if (unsubscribeTxs) { try { unsubscribeTxs(); } catch {} unsubscribeTxs = null; }
    return;
  }

  const uid = user.uid;
  await initializeUserDoc(uid).catch(console.error);
  attachRealtimeUserAndTransactions(uid);

  // configurar botón Cobrar (evitar listeners duplicados)
  if (btnCobrar) {
    // remover listener previo si existiera
    try { btnCobrar.onclick = null; } catch {}
    btnCobrar.addEventListener("click", async () => {
      btnCobrar.disabled = true;
      const prevText = btnCobrar.textContent;
      btnCobrar.textContent = "Procesando...";
      try {
        await cobrarPending(uid);
      } catch (err) {
        console.error("Error en cobrarPending:", err);
        if (window.Swal) Swal.fire("Error", err.message || "No se pudo procesar el cobro.", "error");
      } finally {
        btnCobrar.disabled = false;
        btnCobrar.textContent = prevText || "Cobrar";
      }
    });
  }
}

/* ----------------- Exports ----------------- */
export { addEarnings, cobrarPending, initializeUserDoc, formatCurrency };
