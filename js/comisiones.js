// js/comisiones.js
// Manejo de comisiones (Firebase 10)

// -------- IMPORTS --------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  collection,
  addDoc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// -------- CONFIG (tus credenciales) --------
const apiKey = "AIzaSyA" + "jj3AluF19BBbPfafimJoK7SJbdMrvhWY";
const authDomain = "porkcasare-915ff.firebaseapp.com";
const projectId = "porkcasare-915ff";
const storageBucket = "porkcasare-915ff.firebasestorage.app";
const messagingSenderId = "147157887309";
const appId = "1:147157887309:web:5c6db76a20474f172def04";
const measurementId = "G-X0DJ5Y1S6X";

const firebaseConfig = {
  apiKey,
  authDomain,
  projectId,
  storageBucket,
  messagingSenderId,
  appId,
  measurementId
};

// -------- Inicializar Firebase --------
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// -------- Elementos DOM --------
const elTotal = document.getElementById("totalCommissions");
const elPending = document.getElementById("pendingCommissions");
const elWallet = document.getElementById("walletBalance");
const btnCobrar = document.getElementById("btnCobrar");
const lastTxInfo = document.getElementById("lastTxInfo");
const refInput = document.getElementById("refCode");

// -------- Utilidades --------
function formatCurrency(amount = 0) {
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0
    }).format(Number(amount));
  } catch {
    return "$" + Number(amount).toLocaleString();
  }
}

function showCommissionsUI({ total = 0, pending = 0, wallet = 0, lastTx = null } = {}) {
  if (elTotal) elTotal.textContent = formatCurrency(total);
  if (elPending) {
    elPending.textContent = formatCurrency(pending);
    elPending.classList.toggle("pending", pending > 0);
  }
  if (elWallet) elWallet.textContent = formatCurrency(wallet);

  if (lastTxInfo) {
    if (lastTx?.amount && lastTx?.date) {
      const d = lastTx.date.toDate ? lastTx.date.toDate() : new Date(lastTx.date);
      lastTxInfo.textContent = `Última operación: ${formatCurrency(lastTx.amount)} — ${d.toLocaleString()}`;
    } else lastTxInfo.textContent = "";
  }
}

// -------- Firestore --------
function attachRealtimeListener(uid) {
  const userRef = doc(db, "usuarios", uid);
  return onSnapshot(userRef, (snap) => {
    if (!snap.exists()) {
      initializeUserDoc(uid).catch(console.error);
      showCommissionsUI({ total: 0, pending: 0, wallet: 0 });
      return;
    }
    const d = snap.data();
    const pending = Number(d.balance ?? 0);
    const total = Number(d.totalCommissions ?? 0);
    const wallet = Number(d.walletBalance ?? 0);
    if (refInput && d.referralLink) refInput.value = d.referralLink;
    showCommissionsUI({ total, pending, wallet });
  });
}

async function initializeUserDoc(uid) {
  const uRef = doc(db, "usuarios", uid);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(uRef);
      if (!snap.exists()) {
        tx.set(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0 });
      } else {
        const up = {};
        const data = snap.data();
        if (data.balance === undefined) up.balance = 0;
        if (data.totalCommissions === undefined) up.totalCommissions = 0;
        if (data.walletBalance === undefined) up.walletBalance = 0;
        if (Object.keys(up).length) tx.update(uRef, up);
      }
    });
  } catch (err) {
    const snap = await getDoc(uRef);
    if (!snap.exists()) {
      await updateDoc(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0 }).catch(() => {});
    }
  }
}

async function addEarnings(uid, amount = 0, meta = {}) {
  amount = Number(amount);
  if (!uid || isNaN(amount) || amount <= 0) throw new Error("Monto inválido");
  const uRef = doc(db, "usuarios", uid);
  let result = null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    const data = snap.exists() ? snap.data() : {};
    const newBal = (data.balance ?? 0) + amount;
    const newTot = (data.totalCommissions ?? 0) + amount;
    tx.set(uRef, { ...data, balance: newBal, totalCommissions: newTot }, { merge: true });
    result = { newBalance: newBal, newTotal: newTot };
  });

  const txCol = collection(uRef, "transactions");
  await addDoc(txCol, { type: "earning", amount, meta, timestamp: serverTimestamp() }).catch(console.warn);
  return result;
}

async function cobrarPending(uid, amount = null) {
  if (!uid) throw new Error("Usuario no autenticado");
  if (window.Swal) {
    const r = await Swal.fire({
      title: "¿Cobrar ahora?",
      text: amount ? `Se cobrará ${formatCurrency(amount)}` : "Se cobrará todo tu balance disponible.",
      icon: "question",
      showCancelButton: true
    });
    if (!r.isConfirmed) return null;
  }

  const uRef = doc(db, "usuarios", uid);
  let result = null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    const d = snap.exists() ? snap.data() : {};
    const bal = Number(d.balance ?? 0);
    const wal = Number(d.walletBalance ?? 0);
    const toW = amount == null ? bal : Number(amount);
    if (toW <= 0 || toW > bal) throw new Error("Monto inválido");
    tx.update(uRef, { balance: bal - toW, walletBalance: wal + toW });
    result = { withdrawn: toW, newBalance: bal - toW, newWallet: wal + toW };
  });

  const txCol = collection(uRef, "transactions");
  await addDoc(txCol, { type: "withdraw", amount: result.withdrawn, timestamp: serverTimestamp() }).catch(console.warn);
  if (window.Swal) Swal.fire("¡Hecho!", `Se transfirieron ${formatCurrency(result.withdrawn)} a tu balance.`, "success");
  return result;
}

// -------- Auth --------
let unsub = null;
onAuthStateChanged(auth, async (user) => {
  if (unsub) { try { unsub(); } catch {} unsub = null; }
  if (!user) {
    showCommissionsUI();
    if (btnCobrar) btnCobrar.disabled = true;
    return;
  }
  await initializeUserDoc(user.uid);
  unsub = attachRealtimeListener(user.uid);

  if (btnCobrar) {
    btnCobrar.disabled = false;
    btnCobrar.replaceWith(btnCobrar.cloneNode(true));
    const btn = document.getElementById("btnCobrar");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Procesando...";
        try { await cobrarPending(user.uid); } finally {
          btn.disabled = false;
          btn.textContent = "Cobrar";
        }
      });
    }
  }
});

export { addEarnings, cobrarPending, initializeUserDoc, formatCurrency };
