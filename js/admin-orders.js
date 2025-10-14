// admin-orders.js
import { auth, db } from "/src/firebase-config.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, query, where, getDocs, doc, getDoc, updateDoc, setDoc, deleteDoc,
  arrayUnion, increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const MAX_LEVELS = 5;
const ORDERS_COLLECTION = "orders";

async function findUserByUid(uid) {
  const ref = doc(db, "usuarios", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() };
}

async function distributePointsUpwards(startSponsorCode, points, buyerUsername, orderId, adminUid) {
  try {
    let sponsorCode = startSponsorCode;
    for (let level = 1; level <= MAX_LEVELS; level++) {
      if (!sponsorCode) break;
      const q = query(collection(db, "usuarios"), where("usuario", "==", sponsorCode));
      const snap = await getDocs(q);
      if (snap.empty) break;
      const sponsorDoc = snap.docs[0];
      const sponsorRef = doc(db, "usuarios", sponsorDoc.id);

      await updateDoc(sponsorRef, {
        puntos: increment(points),
        history: arrayUnion({
          action: `Comisión por compra (nivel ${level}) de ${buyerUsername}`,
          points,
          orderId,
          date: new Date().toISOString(),
          confirmedBy: adminUid || null
        })
      });

      sponsorCode = sponsorDoc.data().patrocinador || null;
    }
  } catch (err) {
    console.error("Error en distributePointsUpwards:", err);
  }
}

function log(msg) {
  const box = document.getElementById("logBox");
  const now = new Date().toLocaleTimeString();
  box.innerHTML = `<div>[${now}] ${msg}</div>` + box.innerHTML;
}

async function loadPendingOrders() {
  const ordersTbody = document.getElementById("ordersBody");
  const q = query(collection(db, ORDERS_COLLECTION), where("status", "in", ["pending_mp", "pending_cash", "pendiente_confirmacion"]));
  const snap = await getDocs(q);
  renderOrders(snap, true);
}

async function loadConfirmedOrders() {
  const ordersTbody = document.getElementById("ordersBody");
  const q = query(collection(db, ORDERS_COLLECTION), where("status", "==", "confirmado"));
  const snap = await getDocs(q);
  renderOrders(snap, false);
}

function renderOrders(snap, pending) {
  const ordersTbody = document.getElementById("ordersBody");
  if (snap.empty) {
    ordersTbody.innerHTML = `<tr><td colspan="7" class="text-center small-muted">No hay órdenes ${pending ? 'pendientes' : 'confirmadas'}.</td></tr>`;
    return;
  }
  const rows = [];
  snap.forEach(docSnap => {
    const o = { id: docSnap.id, ...docSnap.data() };
    const productosHTML = (o.items || o.productos || []).map(it => `<div><strong>${it.title || it.productName}</strong> (${it.quantity || 1})</div>`).join("");
    const puntos = o.pointsTotal || o.puntos || 0;
    const precio = o.priceTotal || o.price || 0;
    const actions = pending
      ? `<button class='btn btn-sm btn-success btn-confirm' data-id='${o.id}'>Confirmar</button>`
      : `<button class='btn btn-sm btn-outline-danger btn-delete' data-id='${o.id}'>Eliminar</button>`;
    rows.push(`<tr>
      <td><code>${o.id}</code></td>
      <td>${o.buyerUid || "—"}</td>
      <td>${productosHTML}</td>
      <td>${puntos}</td>
      <td>${new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(precio)}</td>
      <td>${o.status}</td>
      <td>${actions}</td>
    </tr>`);
  });
  ordersTbody.innerHTML = rows.join("");
  document.querySelectorAll(".btn-confirm").forEach(b => b.addEventListener("click", onConfirmClick));
  document.querySelectorAll(".btn-delete").forEach(b => b.addEventListener("click", onDeleteClick));
}

async function onConfirmClick(e) {
  const orderId = e.currentTarget.dataset.id;
  const confirm = await Swal.fire({
    title: `Confirmar orden ${orderId}?`,
    showCancelButton: true,
    confirmButtonText: "Sí, confirmar",
    cancelButtonText: "Cancelar",
    icon: "warning"
  });
  if (!confirm.isConfirmed) return;
  const ref = doc(db, ORDERS_COLLECTION, orderId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const order = snap.data();
  const buyer = await findUserByUid(order.buyerUid);
  const puntos = order.pointsTotal || order.puntos || 0;
  await updateDoc(ref, { status: "confirmado", confirmedAt: new Date().toISOString(), confirmedBy: auth.currentUser?.uid || null });
  if (buyer) {
    const histRef = doc(db, "usuarios", buyer.id, "historial", orderId);
    await setDoc(histRef, { ...order, confirmedAt: new Date().toISOString() });
    await distributePointsUpwards(buyer.data.patrocinador || null, puntos, buyer.data.usuario, orderId, auth.currentUser?.uid);
  }
  Swal.fire("Confirmado", "Orden confirmada.", "success");
  loadPendingOrders();
}

async function onDeleteClick(e) {
  const orderId = e.currentTarget.dataset.id;
  const confirm = await Swal.fire({
    title: `¿Eliminar orden ${orderId}?`,
    text: "Esta acción no se puede deshacer.",
    showCancelButton: true,
    confirmButtonText: "Eliminar",
    cancelButtonText: "Cancelar",
    icon: "warning"
  });
  if (!confirm.isConfirmed) return;
  await deleteDoc(doc(db, ORDERS_COLLECTION, orderId));
  Swal.fire("Eliminada", "Orden eliminada correctamente.", "success");
  loadConfirmedOrders();
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  document.getElementById("btnRefresh").addEventListener("click", () => {
    const active = document.querySelector(".tab.active").id;
    active === "tabPending" ? loadPendingOrders() : loadConfirmedOrders();
  });
  document.getElementById("tabPending").addEventListener("click", () => {
    document.getElementById("tabPending").classList.add("active");
    document.getElementById("tabConfirmed").classList.remove("active");
    loadPendingOrders();
  });
  document.getElementById("tabConfirmed").addEventListener("click", () => {
    document.getElementById("tabConfirmed").classList.add("active");
    document.getElementById("tabPending").classList.remove("active");
    loadConfirmedOrders();
  });
  loadPendingOrders();
});
