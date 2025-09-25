// comisiones_reparado_both_styled.js
// Versión con estilos diferenciados y manejo de puntos grupales.
// Reemplaza tu JS anterior por este.
// Ajusta la ruta a firebase-config.js si es necesaria.

console.log("comisiones_reparado_both_styled.js cargado");

import {
  doc, collection, addDoc, serverTimestamp, arrayUnion,
  onSnapshot, query, orderBy, limit, runTransaction, updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth, db } from "/src/firebase-config.js"; // ajustar ruta si es distinto

// DOM elements — ajusta IDs a tu HTML
const elTotal = document.getElementById("totalCommissions");
const elComisionesCobradas = document.getElementById("totalComisionesCobradas");
const elPending = document.getElementById("pendingCommissions");
const elWallet = document.getElementById("walletBalance");
const elGroupPoints = document.getElementById("groupPoints"); // elemento que mostrará puntos grupales
const btnCobrar = document.getElementById("btnCobrar");
const historyEl = document.getElementById("history");

// Inject CSS styles for entries
(function injectStyles(){
  const css = `
  /* Contenedor general de historial */
  #history { font-family: Inter, Roboto, Arial, sans-serif; }
  .entry { padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); display: flex; flex-direction: column; gap:6px; }
  .entry .amount { font-size: 16px; }
  .entry .meta { color: #6b7280; font-size: 13px; }
  .entry.history-field { background: #ffffff; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 1px 0 rgba(0,0,0,0.02); }
  .entry.transactions-collection { background: transparent; }
  .entry.withdraw .amount { color: #166534; } /* green-700 */
  .entry.earning .amount { color: #111827; }
  .entry .source { color: #9ca3af; font-size: 12px; margin-left: 8px; }
  .entry .bold-name { font-weight: 700; }
  `;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
})();

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

// Intenta detectar y poner en negrilla el nombre de usuario dentro de la descripción.
// Estrategia:
// 1) Si existe entry.meta.byName o entry.meta.by, lo usa.
// 2) Si no, busca patrones comunes: "por compra de NAME", "Por NAME", "de NAME", "por compra: NAME".
// 3) Si no encuentra, aplica heurística de palabras capitalizadas.
function highlightNameInText(text, entry) {
  if (!text || typeof text !== 'string') return text || '';
  // 1) meta.byName or meta.by
  const byName = entry.meta && (entry.meta.byName || entry.meta.by);
  if (byName && typeof byName === 'string') {
    // replace exact occurrence(s)
    const nameEsc = escapeRegExp(byName.trim());
    return text.replace(new RegExp('(' + nameEsc + ')', 'g'), '<span class="bold-name">$1</span>');
  }

  // 2) common patterns
  // pattern: "por compra de NAME" or "por compra: NAME"
  const patterns = [
    /por compra de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i,
    /Por ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/,
    /de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      return text.replace(m[1], `<span class="bold-name">${m[1]}</span>`);
    }
  }

  // 3) fallback: bold first capitalized token sequence (heurística)
  const cap = text.match(/([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/);
  if (cap && cap[1]) {
    return text.replace(cap[1], `<span class="bold-name">${cap[1]}</span>`);
  }
  return text;
}

function escapeRegExp(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  // Prefer explicit IDs if present (earningId, withdrawId), then docId from transactions collection,
  // otherwise fallback to timestamp-based id for history entries.
  let id = null;
  if (entry && entry.earningId) {
    id = `e_${entry.earningId}`;
  } else if (entry && entry.withdrawId) {
    id = `w_${entry.withdrawId}`;
  } else if (docId) {
    id = `tx_${docId}`;
  } else {
    id = `h_${ts.getTime()}_${entry.type || 'x'}_${entry.amount ?? 0}`;
  }

  return {
    _id: id,
    source,
    type: entry.type || "unknown",
    amount: Number(entry.amount ?? 0),
    ts,
    meta: entry.meta || {},
    note: entry.note || entry.action || "",
    points: entry.points ?? entry.pointsUsed ?? null,
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
    // For withdraws, show PLUS sign and green style; for earnings show normal
    const isWithdraw = entry.type === "withdraw";
    const sign = isWithdraw ? '+' : (entry.type === "earning" ? '' : '');
    const amountHTML = `<div class="amount ${entry.type}">${sign} ${formatCurrency(entry.amount)}</div>`;

    // Description: try highlight name
    const rawNote = entry.note || (entry.meta && entry.meta.action) || entry.type;
    const noteWithBold = highlightNameInText(rawNote, entry);

    const containerClass = entry.source === "historyField" ? 'entry history-field' : 'entry transactions-collection';
    const typeClass = entry.type === "withdraw" ? " withdraw" : (entry.type === "earning" ? " earning" : "");

    return `
      <div class="${containerClass}${typeClass}" data-id="${entry._id}">
        ${amountHTML}
        <div class="meta">${when} • ${noteWithBold} <span class="source">(${entry.source})</span></div>
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
  unsubscribeUserDoc = onSnapshot(uRef, async (snap) => {
    const data = snap.exists() ? snap.data() : {};
    if (Array.isArray(data.history)) {
      userHistoryArray = data.history.slice();
    } else {
      userHistoryArray = [];
    }

    // Actualiza balances visibles si existen
    if (elPending) elPending.textContent = formatCurrency(Number(data.balance ?? 0));
    if (elTotal) elTotal.textContent = formatCurrency(Number(data.totalCommissions ?? 0));
    if (elComisionesCobradas) elComisionesCobradas.textContent = formatCurrency(Number(data.totalComisionesCobradas ?? 0));
    if (elWallet) elWallet.textContent = formatCurrency(Number(data.walletBalance ?? 0));
    if (elGroupPoints) elGroupPoints.textContent = (data.groupPoints !== undefined) ? String(data.groupPoints) : (data.puntosGrupales !== undefined ? String(data.puntosGrupales) : '0');

    renderCombinedHistory();
    // --- Recomputar puntos grupales a partir del history y groupPointsConsumedAt para evitar recontar puntos ya cobrados ---
    try {
      const consumedAt = data.groupPointsConsumedAt ? (data.groupPointsConsumedAt.toMillis ? data.groupPointsConsumedAt.toMillis() : (typeof data.groupPointsConsumedAt === 'number' ? data.groupPointsConsumedAt : null)) : null;
      let computedGroupPoints = 0;
      if (Array.isArray(userHistoryArray)) {
        for (const e of userHistoryArray) {
          const pts = e && (e.points ?? e.pointsUsed) ? Number(e.points ?? e.pointsUsed) : 0;
          if (!pts || pts <= 0) continue;
          // Determinar timestamp del entry en ms
          let entryTs = null;
          // Prefer originMs si existe
          if (e.originMs !== undefined && e.originMs !== null) {
            entryTs = Number(e.originMs);
          } else if (e.timestamp !== undefined && e.timestamp !== null) {
            // timestamp podría ser número (ms) o Date objeto convertido
            if (typeof e.timestamp === 'number') entryTs = Number(e.timestamp);
            else if (e.timestamp && typeof e.timestamp.getTime === 'function') entryTs = e.timestamp.getTime();
            else if (typeof e.timestamp === 'string') {
              const parsed = Date.parse(e.timestamp);
              if (!isNaN(parsed)) entryTs = parsed;
            }
          } else if (e.date !== undefined && e.date !== null) {
            const parsed = Date.parse(e.date);
            if (!isNaN(parsed)) entryTs = parsed;
          }
          // Si existe consumedAt: solo sumar si entryTs > consumedAt
          if (consumedAt) {
            if (entryTs && entryTs > consumedAt) {
              computedGroupPoints += pts;
            }
            // si entryTs no está disponible, no sumamos (no podemos asegurar que fue posterior)
          } else {
            // Si no hay consumedAt, sumar todo (comportamiento legacy)
            computedGroupPoints += pts;
          }
        }
      }
      // Normalizar valor en DB solo si difiere (y solo si computedGroupPoints es diferente)
      const dbGroupPoints = Number(data.groupPoints ?? data.puntosGrupales ?? 0);
      if (dbGroupPoints !== computedGroupPoints) {
        try {
          await runTransaction(db, async (tx) => {
            const s = await tx.get(uRef);
            if (!s.exists()) return;
            const d = s.data();
            const currentDbGroup = Number(d.groupPoints ?? d.puntosGrupales ?? 0);
            if (currentDbGroup !== computedGroupPoints) {
              tx.update(uRef, { groupPoints: computedGroupPoints });
            }
          });
        } catch (e) {
          console.warn("No se pudo normalizar groupPoints:", e);
        }
      }
    } catch (e) {
      console.warn("Error al recomputar puntos grupales:", e);
    }
    // --- fin recomputo ---
    
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

/*
  addEarnings(uid, amount, meta)
    meta: { action, by, byName, points }
*/
async function addEarnings(uid, amount = 0, meta = {}) {
  if (!uid) throw new Error("Usuario no autenticado");
  amount = Number(amount);
  if (isNaN(amount) || amount <= 0) throw new Error("Monto inválido");

  const uRef = doc(db, "usuarios", uid);
  const earningId = (uid || 'u') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
  const entry = {
    earningId,
    type: "earning",
    amount,
    timestamp: Date.now(),
    originMs: meta && meta.originMs ? Number(meta.originMs) : Date.now(),
    meta,
    note: meta.action || "",
    by: meta.by || (auth.currentUser ? auth.currentUser.uid : "system"),
    points: meta.points ?? null
  };

  // Transaction: actualizar balances y push a history[] (y ajustar groupPoints si aplica)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    const data = snap.exists() ? snap.data() : {};
    const oldBalance = Number(data.balance ?? 0);
    const oldTotal = Number(data.totalCommissions ?? 0);
    const oldGroupPoints = Number(data.groupPoints ?? data.puntosGrupales ?? 0);

    const newBalance = oldBalance + amount;
    const newTotal = oldTotal + amount;
    let newGroupPoints = oldGroupPoints;
    // Si se provee meta.originMs (timestamp en ms) y ya existe un groupPointsConsumedAt posterior
    // entonces no sumamos estos puntos al acumulado grupal (evita recontar puntos ya cobrados).
    const consumedAt = data.groupPointsConsumedAt ? (data.groupPointsConsumedAt.toMillis ? data.groupPointsConsumedAt.toMillis() : null) : null;
    const originMs = meta && meta.originMs ? Number(meta.originMs) : null;
    if (entry.points && !isNaN(Number(entry.points))) {
      if (consumedAt && originMs && originMs <= consumedAt) {
        // No sumar: este earning corresponde a antes del último cobro grupal
        newGroupPoints = oldGroupPoints;
      } else {
        newGroupPoints = oldGroupPoints + Number(entry.points);
      }
    }

    tx.update(uRef, {
      balance: newBalance,
      totalCommissions: newTotal,
      groupPoints: newGroupPoints,
      history: arrayUnion(entry)
    });
  });

  // Crear documento en subcolección transactions
  const txCol = collection(db, "usuarios", uid, "transactions");
  await addDoc(txCol, {
    earningId: earningId,
    type: "earning",
    amount,
    timestamp: serverTimestamp(),
    meta,
    ownerUid: uid,
    points: meta.points ?? null
  });

  return { success: true };
}

/*
  cobrarPending(uid, amount = null, options = {})
    options: { pointsToUse: number|null, clearGroupPoints: bool }
*/

async function cobrarPending(uid, amount = null, options = {}) {
  if (!uid) throw new Error("Usuario no autenticado");
  const { pointsToUse = null, clearGroupPoints = false } = options;
  const withdrawId = (uid || 'u') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);

  const uRef = doc(db, "usuarios", uid);
  let result = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    if (!snap.exists()) throw new Error("Usuario no encontrado");
    const data = snap.data();
    const currentBalance = Number(data.balance ?? 0);
    const wallet = Number(data.walletBalance ?? 0);
    const currentGroupPoints = Number(data.groupPoints ?? data.puntosGrupales ?? 0);

    const toWithdraw = (amount === null || amount === undefined) ? currentBalance : Number(amount);
    if (isNaN(toWithdraw) || toWithdraw <= 0) throw new Error("Monto inválido");
    if (toWithdraw > currentBalance) throw new Error("Saldo insuficiente");

    // mover de balance -> wallet
    const newBalance = currentBalance - toWithdraw;
    const newWallet = wallet + toWithdraw;

    // calcular y registrar puntos usados (si aplica)
    let newGroupPoints = currentGroupPoints;
    let pointsUsed = null;
    if (clearGroupPoints) {
      pointsUsed = currentGroupPoints;
      newGroupPoints = 0;
    } else if (pointsToUse !== null && !isNaN(Number(pointsToUse))) {
      pointsUsed = Number(pointsToUse);
      newGroupPoints = Math.max(0, currentGroupPoints - Number(pointsToUse));
    } else if (data.lastPoints && !isNaN(Number(data.lastPoints))) {
      pointsUsed = Number(data.lastPoints);
      newGroupPoints = Math.max(0, currentGroupPoints - Number(data.lastPoints));
    } else {
      // no se usan puntos
      pointsUsed = null;
      newGroupPoints = currentGroupPoints;
    }

    // actualizar total de comisiones cobradas (nuevo campo). Si quieres otro nombre de campo, cámbialo aquí.
    const oldCharged = Number(data.totalComisionesCobradas ?? data.totalComisionesCobradas ?? 0);
    const newCharged = oldCharged + toWithdraw;

    const entry = {
      withdrawId,
      type: "withdraw",
      amount: toWithdraw,
      timestamp: Date.now(),
      note: "Cobro desde UI",
      by: (auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : "system",
      pointsUsed: pointsUsed
    };

    tx.update(uRef, {
      balance: newBalance,
      walletBalance: newWallet,
      groupPoints: newGroupPoints,
      // guardamos el acumulado de comisiones cobradas
      totalComisionesCobradas: newCharged,
      history: arrayUnion(entry),
      groupPointsConsumedAt: serverTimestamp(),
    });

    result = { withdrawn: toWithdraw, newBalance, newWallet, newGroupPoints, pointsUsed };
  });

  // Registrar en subcolección de transacciones
  const txCol = collection(db, "usuarios", uid, "transactions");
  await addDoc(txCol, {
    withdrawId: withdrawId ?? null,
    type: "withdraw",
    amount: result.withdrawn,
    timestamp: serverTimestamp(),
    originMs: Date.now(),
    note: "Cobro desde UI",
    ownerUid: uid,
    pointsUsed: result.pointsUsed !== undefined ? result.pointsUsed : null
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

  // Inicializa campos mínimos si es necesario
  try {
    await runTransaction(db, async (tx) => {
      const uRef = doc(db, "usuarios", uid);
      const s = await tx.get(uRef);
      if (!s.exists()) {
        tx.set(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0, groupPoints: 0, history: [], createdAt: serverTimestamp() });
      } else {
        const data = s.data();
        const updates = {};
        if (data.balance === undefined) updates.balance = 0;
        if (data.totalCommissions === undefined) updates.totalCommissions = 0;
        if (data.walletBalance === undefined) updates.walletBalance = 0;
        if (data.groupPoints === undefined && data.puntosGrupales === undefined) updates.groupPoints = 0;
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
        // Aquí asumimos que quieres limpiar puntos grupales al cobrar:
        // cambiamos clearGroupPoints:true para poner groupPoints a 0.
        // Si prefieres usar una cantidad concreta, pásala como segundo parámetro.
        await cobrarPending(uid, null, { clearGroupPoints: true });
        console.log("Cobro realizado y puntos grupales actualizados");
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
