// oficina-virtual/js/productos.js
import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
  arrayUnion,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/*
  Productos y reglas:
  - Paquete Inicial (15 kg) => precio 300000 => 50 puntos
  - Otros productos 3kg => 60000 => 10 puntos
  - POINT_VALUE = 3800 (valor por punto para liquidaciones)
  - Distribución de comisiones por nivel: [5%, 3%, 2%, 1%, 0.5%]
  - Las "puntos" se suman hacia arriba (teamPoints en cada sponsor).
  - Además agregamos 'balance' (dinero) calculado por comisión. (Puedes usar balance para pagar luego)
*/

const POINT_VALUE = 3800;
const LEVEL_PERCENTS = [0.05, 0.03, 0.02, 0.01, 0.005];

const productos = [
  {
    id: "paquete-inicio",
    nombre: "Paquete Inicial – 15 kg",
    descripcion:
      "Lista para tu cocina. Este paquete incluye 15 kilos combinados de chuletas, costillas y paticas.",
    imagen: "../images/productos/inicio.jpg",
    precio: 300000,
    puntos: 50
  },
  {
    id: "chuletas-3kg",
    nombre: "Chuletas – 3 kg",
    descripcion: "Chuletas de cerdo frescas y jugosas, empacadas al vacío.",
    imagen: "../images/productos/chuleta.jpg",
    precio: 60000,
    puntos: 10
  },
  {
    id: "costillas-3kg",
    nombre: "Costillitas – 3 kg",
    descripcion: "Costillitas tiernas y llenas de sabor.",
    imagen: "../images/productos/costillas.jpg",
    precio: 60000,
    puntos: 10
  },
  {
    id: "paticas-3kg",
    nombre: "Paticas – 3 kg",
    descripcion: "Paticas o pezuñitas, perfectas para caldos y guisos.",
    imagen: "../images/productos/paticas.jpg",
    precio: 60000,
    puntos: 10
  }
];

function formatCOP(num) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(num);
}

async function findUserByUsername(username) {
  if (!username) return null;
  const usuariosCol = collection(db, "usuarios");
  const q = query(usuariosCol, where("usuario", "==", username));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, data: docSnap.data() };
}

async function distributePointsUpline(startSponsorCode, pointsEarned, buyerUsername, orderId) {
  try {
    let sponsorCode = startSponsorCode;
    for (let level = 0; level < 5; level++) {
      if (!sponsorCode) break;
      const sponsor = await findUserByUsername(sponsorCode);
      if (!sponsor) break;

      const sponsorRef = doc(db, "usuarios", sponsor.id);

      // sumamos teamPoints
      await updateDoc(sponsorRef, { teamPoints: increment(pointsEarned) });

      // calculamos comisión monetaria
      const percent = LEVEL_PERCENTS[level] || 0;
      const commissionValue = Math.round(pointsEarned * POINT_VALUE * percent);

      // actualizamos balance y agregamos registro en history
      await updateDoc(sponsorRef, {
        balance: increment(commissionValue),
        history: arrayUnion({
          action: `Comisión nivel ${level + 1} por compra de ${buyerUsername}`,
          amount: commissionValue,
          points: pointsEarned,
          orderId,
          date: new Date().toISOString()
        })
      });

      // avanzar al siguiente nivel
      sponsorCode = sponsor.data.patrocinador || null;
    }
  } catch (err) {
    console.error("Error distribuyendo puntos:", err);
  }
}

function renderProductos() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  grid.innerHTML = productos
    .map(
      (prod) => `
    <div class="product-card" data-id="${prod.id}">
      <img src="${prod.imagen}" alt="${prod.nombre}">
      <h4>${prod.nombre}</h4>
      <p>${prod.descripcion}</p>
      <p><strong>${formatCOP(prod.precio)}</strong></p>
      <button class="btn small btn-buy" data-id="${prod.id}">Comprar</button>
    </div>
  `
    )
    .join("");

  // attach handlers
  document.querySelectorAll(".btn-buy").forEach((btn) => {
    btn.addEventListener("click", onBuyClick);
  });
}

async function onBuyClick(e) {
  if (!auth.currentUser) {
    alert("Debes iniciar sesión para comprar.");
    window.location.href = "/distribuidor-login.html";
    return;
  }

  const prodId = e.currentTarget.dataset.id;
  const prod = productos.find((p) => p.id === prodId);
  if (!prod) return;

  // Confirmación y método de pago (simple)
  const want = confirm(`Vas a comprar:\n\n${prod.nombre}\n${formatCOP(prod.precio)}\n\nPresiona Aceptar para pagar con Mercado Pago, Cancelar para pago en efectivo/transferencia.`);
  const buyerUid = auth.currentUser.uid;

  // create order record in Firestore (status pending)
  const orderData = {
    productId: prod.id,
    productName: prod.nombre,
    price: prod.precio,
    points: prod.puntos,
    buyerUid,
    createdAt: new Date().toISOString()
  };

  try {
    // save pending order
    const ordersCol = collection(db, "orders");
    const orderRef = await addDoc(ordersCol, {
      ...orderData,
      status: want ? "pending_mp" : "pending_cash"
    });

    // If user picked MercadoPago (want === true)
    if (want) {
      // Llamada al serverless para crear preference
      // Ajusta la ruta si tu función está en otro endpoint
      const res = await fetch("/.netlify/functions/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderRef.id,
          items: [{ title: prod.nombre, unit_price: prod.precio, quantity: 1 }],
          payerUid: buyerUid
        })
      });

      if (!res.ok) throw new Error("Error creando preferencia MercadoPago");

      const data = await res.json();
      // data debe tener init_point o url para redirigir
      // Guardamos preferenceId si viene
      await updateDoc(orderRef, { preferenceId: data.preferenceId || null, mp_init_point: data.init_point || data.sandbox_init_point || null });

      // Redirigir al init_point
      if (data.init_point) {
        window.location.href = data.init_point;
        return;
      } else if (data.sandbox_init_point) {
        window.location.href = data.sandbox_init_point;
        return;
      } else {
        alert("Preferencia creada, revisa la respuesta del servidor.");
      }
    } else {
      // Pago en efectivo/transferencia -> redirigir a página de checkout local para elegir domicilio o recoger
      // pasamos orderId para que checkout.html cargue la orden y permita editar dirección/teléfono
      window.location.href = `/checkout.html?orderId=${orderRef.id}`;
      return;
    }

    // ** Distribución inmediata (solo para demo/efectivo). **
    // Si quieres que la distribución ocurra sólo cuando MP confirme el pago,
    // elimina la llamada inmediata y realiza la distribución en el webhook.
    const buyerDoc = await getDoc(doc(db, "usuarios", buyerUid));
    const buyerData = buyerDoc.exists() ? buyerDoc.data() : null;
    const sponsorCode = buyerData ? buyerData.patrocinador : null;

    // Para demo, distribuimos ahora:
    await distributePointsUpline(sponsorCode, prod.puntos, buyerData ? buyerData.usuario : "desconocido", orderRef.id);

    // Actualizamos el historial del comprador con la compra (aunque no sumen puntos a él)
    await updateDoc(orderRef, { status: "completed_demo", completedAt: new Date().toISOString() });
    await updateDoc(doc(db, "usuarios", buyerUid), {
      history: arrayUnion({
        action: `Compra ${prod.nombre}`,
        amount: prod.precio,
        points: prod.puntos,
        orderId: orderRef.id,
        date: new Date().toISOString()
      })
    });

    alert("Compra registrada (demo). La distribución de puntos se aplicó en la red.");
  } catch (err) {
    console.error("Error en compra:", err);
    alert("Ocurrió un error al procesar la compra. Revisa consola.");
  }
}

// Render inicial
document.addEventListener("DOMContentLoaded", () => {
  renderProductos();
});
