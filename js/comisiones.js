// js/comisiones.js
// Módulo ES: manejo de comisiones partiendo del campo 'balance' ya existente.
// Requisitos:
//  - Firebase v9 modular (imports abajo).
//  - SweetAlert2 cargado en el HTML.
//  - Firestore rules: usuario solo puede leer/escribir su propio doc users/{uid}.
//  - Reemplaza firebaseConfig por tu configuración real.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import {
  getAuth,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';

// -------- CONFIG: PON AQUI TU firebaseConfig ----------
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_DOMINIO.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_BUCKET.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};
// ------------------------------------------------------

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// DOM elements (IDs según tu index.html)
const elTotal = document.getElementById('totalCommissions');    // historial total ganado
const elPending = document.getElementById('pendingCommissions'); // balance (por cobrar) = campo 'balance'
const elWallet = document.getElementById('walletBalance');      // walletBalance (donde va al cobrar)
const btnCobrar = document.getElementById('btnCobrar');
const lastTxInfo = document.getElementById('lastTxInfo');
const refInput = document.getElementById('refCode');

// Formateador de moneda (ajusta locale/currency si quieres)
function formatCurrency(amount = 0) {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(amount));
  } catch (e) {
    return '$' + Number(amount).toLocaleString();
  }
}

// UI update
function showCommissionsUI({ total = 0, pending = 0, wallet = 0, lastTx = null } = {}) {
  if (elTotal) elTotal.textContent = formatCurrency(total);
  if (elPending) {
    elPending.textContent = formatCurrency(pending);
    if (pending > 0) elPending.classList.add('pending');
    else elPending.classList.remove('pending');
  }
  if (elWallet) elWallet.textContent = formatCurrency(wallet);

  if (lastTxInfo) {
    if (lastTx && lastTx.amount && lastTx.date) {
      const d = lastTx.date.toDate ? lastTx.date.toDate() : new Date(lastTx.date);
      lastTxInfo.textContent = `Última operación: ${formatCurrency(lastTx.amount)} — ${d.toLocaleString()}`;
    } else {
      lastTxInfo.textContent = '';
    }
  }
}

// Inicialización: escuchamos cambios en el doc del usuario y actualizamos UI
function attachRealtimeListener(uid) {
  if (!uid) return;
  const userRef = doc(db, 'users', uid);

  // onSnapshot mantiene UI sincronizada en tiempo real
  return onSnapshot(userRef, (snap) => {
    if (!snap.exists()) {
      // Si no existe, inicializamos con campos básicos
      initializeUserDoc(uid).then(() => {
        // nada extra
      }).catch(console.error);
      showCommissionsUI({ total: 0, pending: 0, wallet: 0 });
      return;
    }
    const data = snap.data();
    // Interpretamos: 'balance' es lo que se acumula como "por cobrar"
    const pending = Number(data.balance ?? 0);
    const total = Number(data.totalCommissions ?? 0);
    const wallet = Number(data.walletBalance ?? 0);

    // opcional: mostrar código de referido si existe
    if (refInput && data.referralLink) refInput.value = data.referralLink;

    showCommissionsUI({ total, pending, wallet });
  }, (err) => {
    console.error('Listener error:', err);
  });
}

// Inicializa campos del documento del usuario si faltan
async function initializeUserDoc(uid) {
  const uRef = doc(db, 'users', uid);
  try {
    // Run a transaction to create fields only if missing
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(uRef);
      if (!snap.exists()) {
        // crea documento con campos base
        tx.set ? tx.set(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0 }) : null;
        // Note: tx.set may not be available via tx variable depending on sdk; if so, fallback a updateDoc fuera.
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
  } catch (err) {
    // si runTransaction no puede setear inicialmente por incompatibilidad, fallback simple:
    const snap = await getDoc(uRef);
    if (!snap.exists()) {
      await updateDoc(uRef, { balance: 0, totalCommissions: 0, walletBalance: 0 }).catch(async () => {
        // si tampoco existe updateDoc, usar addDoc en collection users (no ideal): omitimos por seguridad.
      });
    } else {
      const data = snap.data();
      const updates = {};
      if (data.balance === undefined) updates.balance = 0;
      if (data.totalCommissions === undefined) updates.totalCommissions = 0;
      if (data.walletBalance === undefined) updates.walletBalance = 0;
      if (Object.keys(updates).length) await updateDoc(uRef, updates);
    }
  }
}

// --------------- Función: registrar ingreso de comisión ----------------
// Usa transacción para incrementar: balance (campo existente) y totalCommissions.
// amount: número > 0
async function addEarnings(uid, amount = 0, meta = {}) {
  if (!uid) throw new Error('Usuario no autenticado.');
  amount = Number(amount);
  if (isNaN(amount) || amount <= 0) throw new Error('Monto inválido.');

  const uRef = doc(db, 'users', uid);
  let txResult = null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(uRef);
    if (!snap.exists()) {
      // crear doc inicial si no existe
      tx.update ? tx.update(uRef, { balance: amount, totalCommissions: amount, walletBalance: 0 }) : null;
      txResult = { newBalance: amount, newTotal: amount };
      return;
    }
    const data = snap.data();
    const oldBalance = Number(data.balance ?? 0);
    const oldTotal = Number(data.totalCommissions ?? 0);

    const newBalance = oldBalance + amount;
    const newTotal = oldTotal + amount;

    tx.update(uRef, { balance: newBalance, totalCommissions: newTotal });
    txResult = { newBalance, newTotal };
  });

  // Registrar en subcolección transactions fuera de la transacción principal (addDoc no puede estar dentro de runTransaction)
  try {
    const txCol = collection(doc(db, 'users', uid), 'transactions'); // collection reference under users/{uid}/transactions
    await addDoc(txCol, {
      type: 'earning',
      amount,
      meta: meta || {},
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn('No se pudo registrar la transacción de earning:', err);
  }

  return txResult;
}

// --------------- Función: cobrar (total o parcial) ----------------
// Si amount === undefined o null => cobra TODO (balance completo).
// Se hace transacción que reduce 'balance' y aumenta 'walletBalance'.
// Registra transacción en users/{uid}/transactions
async function cobrarPending(uid, amount = null) {
  if (!uid) throw new Error('Usuario no autenticado.');

  // Confirmación con SweetAlert2 (si está disponible en window)
  if (window.Swal) {
    const confirm = await Swal.fire({
      title: '¿Deseas cobrar ahora?',
      text: amount ? `Se cobrará ${formatCurrency(amount)} de tus comisiones.` : 'Se cobrará todo tu balance disponible.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, cobrar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return null;
  }

  const uRef = doc(db, 'users', uid);
  let result = null;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(uRef);
      if (!snap.exists()) throw new Error('Usuario no encontrado.');

      const data = snap.data();
      const currentBalance = Number(data.balance ?? 0);
      const wallet = Number(data.walletBalance ?? 0);

      const toWithdraw = (amount === null || amount === undefined) ? currentBalance : Number(amount);
      if (isNaN(toWithdraw) || toWithdraw <= 0) throw new Error('Monto a cobrar inválido.');
      if (toWithdraw > currentBalance) throw new Error('No tienes suficiente balance para recibir ese cobro.');

      const newBalance = currentBalance - toWithdraw;
      const newWallet = wallet + toWithdraw;

      tx.update(uRef, { balance: newBalance, walletBalance: newWallet });

      result = { withdrawn: toWithdraw, newBalance, newWallet };
    });

    // Registrar transacción afuera de la tx principal
    try {
      const txCol = collection(doc(db, 'users', uid), 'transactions');
      await addDoc(txCol, {
        type: 'withdraw',
        amount: result.withdrawn,
        timestamp: serverTimestamp(),
        note: 'Cobro realizado desde la oficina virtual (cliente)'
      });
    } catch (err) {
      console.warn('No se pudo registrar la transacción de withdraw:', err);
    }

    // Confirmación
    if (window.Swal) Swal.fire('¡Hecho!', `Se transfirieron ${formatCurrency(result.withdrawn)} a tu balance.`, 'success');

    return result;
  } catch (err) {
    if (window.Swal) Swal.fire('Error', err.message || 'No se pudo procesar el cobro', 'error');
    throw err;
  }
}

// --------------- Export / Hook a UI y Auth ----------------
let currentListenerUnsubscribe = null;

onAuthStateChanged(auth, async (user) => {
  // limpia listener previo
  if (currentListenerUnsubscribe) {
    try { currentListenerUnsubscribe(); } catch(e){/*ignore*/ }
    currentListenerUnsubscribe = null;
  }

  if (!user) {
    // No autenticado: limpiar UI y deshabilitar botón
    showCommissionsUI({ total: 0, pending: 0, wallet: 0 });
    if (btnCobrar) { btnCobrar.disabled = true; btnCobrar.textContent = 'Cobrar'; }
    return;
  }

  const uid = user.uid;
  // aseguramos doc inicial
  await initializeUserDoc(uid).catch(console.error);

  // attach listener y guardamos la función de unsubscribe
  currentListenerUnsubscribe = attachRealtimeListener(uid);

  // Habilitar botón cobrar y vincular acción
  if (btnCobrar) {
    btnCobrar.disabled = false;
    btnCobrar.textContent = 'Cobrar';
    // evitar múltiples listeners
    btnCobrar.replaceWith(btnCobrar.cloneNode(true));
    const newBtn = document.getElementById('btnCobrar');
    if (newBtn) {
      newBtn.addEventListener('click', async () => {
        // Usamos cobrarPending que por defecto cobrará todo
        try {
          newBtn.disabled = true;
          newBtn.textContent = 'Procesando...';
          await cobrarPending(uid, null);
        } catch (err) {
          console.error(err);
        } finally {
          newBtn.disabled = false;
          newBtn.textContent = 'Cobrar';
        }
      });
    }
  }
});

// --------------- Exports: disponibles para otros módulos --------------
export {
  addEarnings,      // (uid, amount, meta) -> suma a balance y totalCommissions
  cobrarPending,    // (uid, amount?) -> cobra total o parcial
  initializeUserDoc,
  formatCurrency
};
