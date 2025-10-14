// js/admin-orders.js
import { auth, db } from "/src/firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  arrayUnion,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/*
  Admin Orders manager
  - Lista órdenes con estado "pendiente_confirmacion"
  - Al confirmar: actualiza orden, agrega a historial del comprador y distribuye puntos 5 niveles arriba
*/

// Config
const MAX_LEVELS = 5;
const ORDERS_COLLECTION = "orders";

// util: buscar usuario por 'usuario' (username)
async function findUserByUsername(username) {
  if (!username) return null;
  const usuariosCol = collection(db, "usuarios");
  const q = query(usuariosCol, where("usuario", "==", username));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, data: docSnap.data() };
}

// util: buscar usuario por uid
async function findUserByUid(uid) {
  const ref = doc(db, "usuarios", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() };
}

// Distribuir puntos hacia arriba N niveles (mismo puntos a cada nivel)
async function distributePointsUpwards(startSponsorCode, points, buyerUsername, orderId, adminUid) {
  try {
    let sponsorCode = startSponsorCode;
    for (let level = 1; level <= MAX_LEVELS; level++) {
      if (!sponsorCode) break;
      const sponsor = await findUserByUsername(sponsorCode);
      if (!sponsor) break;

      const sponsorRef = doc(db, "usuarios", sponsor.id);

      // sumar puntos al sponsor
      await updateDoc(sponsorRef, {
        puntos: increment(points),
        // opcional: mantener teamPoints o balance si los usas
      });

      // añadir entry en history del sponsor
      await updateDoc(sponsorRef, {
        history: arrayUnion({
          action: `Comisión por compra (nivel ${level}) de ${buyerUsername}`,
          points: points,
          orderId: orderId,
          date: new Date().toISOString(),
          confirmedBy: adminUid || null
        })
      });

      // avanzar hacia arriba
      sponsorCode = sponsor.data.patrocinador || null;
    }
    return true;
  } catch (err) {
    console.error("Error en distributePointsUpwards:", err);
    return false;
  }
}

// Render tabla de órdenes pendientes
async function loadPendingOrders() {
  log("Cargando órdenes pendientes...");
  const ordersTbody = document.getElementById("ordersBody");
  ordersTbody.innerHTML = `<tr><td colspan="8" class="text-center small-muted">Cargando...</td></tr>`;

  const ordersCol = collection(db, ORDERS_COLLECTION);
  const q = query(ordersCol, where("status", "in", ["pending_mp", "pending_cash", "pendiente_confirmacion"]));
  const snap = await getDocs(q);

  if (snap.empty) {
    ordersTbody.innerHTML = `<tr><td colspan="8" class="text-center small-muted">No hay órdenes pendientes.</td></tr>`;
    return;
  }

  const rows = [];
  snap.forEach(docSnap => {
    const d = { id: docSnap.id, ...docSnap.data() };
    rows.push(d);
  });

  ordersTbody.innerHTML = rows.map(o => {
    const productosHTML = (o.items || o.productos || []).map(it => `<div><strong>${it.title || it.productName}</strong> <span class="small-muted">(${it.quantity || 1})</span></div>`).join("");
    const puntos = (o.pointsTotal || o.puntos || (o.items?.reduce?.((a,it)=>a + (it.points||0),0) || o.productos?.reduce?.((a,it)=>a + (it.puntos||0),0) || 0));
    const precio = o.priceTotal || o.price || o.productos?.reduce?.((a,it)=>a + (it.precio||0),0) || (o.items?.reduce?.((a,it)=>a + (it.unit_price*(it.quantity||1)),0) || 0);
    const fecha = o.createdAt ? new Date(o.createdAt).toLocaleString() : (o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000).toLocaleString() : "");
    return `
      <tr>
        <td><code>${o.id}</code></td>
        <td>${o.buyerUid ? `<small class="small-muted">uid:</small><br>${o.buyerUid}` : "—"}</td>
        <td>${productosHTML}</td>
        <td>${puntos}</td>
        <td>${new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(precio)}</td>
        <td>${fecha}</td>
        <td>${o.status}</td>
        <td>
          <button class="btn btn-sm btn-success btn-confirm" data-id="${o.id}">Confirmar</button>
          <button class="btn btn-sm btn-outline-secondary btn-view" data-id="${o.id}">Ver</button>
        </td>
      </tr>
    `;
  }).join("");

  // attach events
  document.querySelectorAll(".btn-confirm").forEach(b => b.addEventListener("click", onConfirmClick));
  document.querySelectorAll(".btn-view").forEach(b => b.addEventListener("click", onViewClick));
}

function log(msg) {
  const box = document.getElementById("logBox");
  const now = new Date().toLocaleTimeString();
  box.innerHTML = `<div>[${now}] ${msg}</div>` + box.innerHTML;
}

// Ver detalle (simple modal)
async function onViewClick(e) {
  const orderId = e.currentTarget.dataset.id;
  const docRef = doc(db, ORDERS_COLLECTION, orderId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return Swal.fire('No existe', 'No se encontró la orden', 'error');
  const o = snap.data();
  Swal.fire({
    title: `Orden ${orderId}`,
    html: `
      <div style="text-align:left">
        <p><strong>Buyer UID:</strong> ${o.buyerUid || '—'}</p>
        <p><strong>Estado:</strong> ${o.status || '—'}</p>
        <p><strong>Productos:</strong></p>
        <pre style="text-align:left;background:#f7f9fc;padding:8px;border-radius:6px;max-height:180px;overflow:auto">${JSON.stringify(o.items || o.productos || o, null, 2)}</pre>
      </div>
    `,
    width: 800
  });
}

// Confirmar orden (proceso principal)
async function onConfirmClick(e) {
  const orderId = e.currentTarget.dataset.id;
  const { value: confirm } = await Swal.fire({
    title: `Confirmar orden ${orderId}?`,
    text: "Esto marcará la orden como confirmada y distribuirá puntos 5 niveles arriba.",
    showCancelButton: true,
    confirmButtonText: "Sí, confirmar",
    cancelButtonText: "Cancelar",
    icon: "warning"
  });
  if (!confirm) return;

  try {
    const orderRef = doc(db, ORDERS_COLLECTION, orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) return Swal.fire('Error', 'Orden no encontrada', 'error');

    const order = orderSnap.data();
    // calcular puntos totales de la orden (buscamos varios campos posibles)
    const puntos = order.pointsTotal || order.puntos || (order.items?.reduce?.((s,i)=>s + (i.points||0),0)) || (order.productos?.reduce?.((s,p)=>s + (p.puntos||0),0)) || 0;

    // obtener comprador para historial y patrocinador
    const buyerUid = order.buyerUid;
    const buyer = buyerUid ? await findUserByUid(buyerUid) : null;

    // update orden: estado confirmado
    await updateDoc(orderRef, {
      status: "confirmado",
      confirmedAt: new Date().toISOString(),
      confirmedBy: auth.currentUser ? auth.currentUser.uid : null
    });

    // agregar orden al historial del comprador (subcolección)
    if (buyerUid) {
      const histRef = doc(db, "usuarios", buyerUid, "historial", orderId);
      await setDoc(histRef, {
        orderId,
        ...order,
        confirmedAt: new Date().toISOString()
      });
    }

    // distribuir puntos hacia arriba empezando por el patrocinador del comprador
    const sponsorCode = buyer && buyer.data ? (buyer.data.patrocinador || null) : (order.patron || order.patrocinador || null);

    await distributePointsUpwards(sponsorCode, puntos, buyer && buyer.data ? buyer.data.usuario : (order.buyerUsername || 'desconocido'), orderId, auth.currentUser ? auth.currentUser.uid : null);

    log(`Orden ${orderId} confirmada. Puntos (${puntos}) distribuidos hacia arriba.`);

    Swal.fire('Confirmado', 'Orden confirmada y puntos distribuidos.', 'success');
    await loadPendingOrders();

  } catch (err) {
    console.error("Error confirmando orden:", err);
    Swal.fire('Error', 'Ocurrió un error al confirmar (mira consola).', 'error');
  }
}

// check admin: si quieres restringir, añade campo isAdmin o role en tu documento de usuario
async function checkIsAdmin(user) {
  if (!user) return false;
  try {
    const me = await findUserByUid(user.uid);
    if (!me) return false;
    // si tienes un campo role/isAdmin en el perfil:
    if (me.data.role === "admin" || me.data.isAdmin === true) return true;
    // si no existe campo y confías en el correo:
    const adminEmails = [/* "tu.email@ejemplo.com" */];
    if (adminEmails.includes(user.email)) return true;
    // por defecto: permite (si quieres desactivar, cambia a false)
    return true;
  } catch (e) {
    console.error("Error checkIsAdmin:", e);
    return false;
  }
}

// inicio
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // si no está logueado, redirige a login admin (puedes cambiar ruta)
    window.location.href = "distribuidor-login.html";
    return;
  }

  const isAdmin = await checkIsAdmin(user);
  if (!isAdmin) {
    Swal.fire('Acceso denegado', 'No tienes permisos para ver esta página.', 'error');
    // opcional: cerrar sesión o redirigir
    return;
  }

  // mostrar botones funcionales
  document.getElementById("btnRefresh").addEventListener("click", loadPendingOrders);

  // carga inicial
  await loadPendingOrders();
});
