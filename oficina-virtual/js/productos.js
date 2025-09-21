// oficina-virtual/js/productos.js
import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
  arrayUnion,
  increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/*
  Reglas:
  - Paquete Inicial (15 kg) => 300000 => 50 puntos
  - Otros productos 3kg => 60000 => 10 puntos
  - POINT_VALUE = 3800 COP
  - Distribución comisiones: [5%, 3%, 2%, 1%, 0.5%] hacia arriba
*/

const POINT_VALUE = 3800;
const LEVEL_PERCENTS = [0.05, 0.03, 0.02, 0.01, 0.005];

// Catálogo de productos
const productos = [
  {
    id: "paquete-inicio",
    nombre: "Paquete Inicial – 15 kg",
    descripcion: "Incluye 15 kilos de chuletas, costillas y paticas empacadas al vacío.",
    imagen: "../images/productos/inicio.jpg",
    precio: 300000,
    puntos: 50
  },
  {
    id: "chuletas-3kg",
    nombre: "Chuletas – 3 kg",
    descripcion: "Chuletas frescas y jugosas, empacadas al vacío.",
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
    descripcion: "Paticas perfectas para caldos y guisos.",
    imagen: "../images/productos/paticas.jpg",
    precio: 60000,
    puntos: 10
  }
];

// Formatear precio COP
function formatCOP(num) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0
  }).format(num);
}

// Buscar usuario por username
async function findUserByUsername(username) {
  if (!username) return null;
  const usuariosCol = collection(db, "usuarios");
  const q = query(usuariosCol, where("usuario", "==", username));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, data: docSnap.data() };
}

// Distribuir puntos y comisiones hacia arriba
async function distributePointsUpline(startSponsorCode, pointsEarned, buyerUsername, orderId) {
  try {
    let sponsorCode = startSponsorCode;
    for (let level = 0; level < LEVEL_PERCENTS.length; level++) {
      if (!sponsorCode) break;
      const sponsor = await findUserByUsername(sponsorCode);
      if (!sponsor) break;

      const sponsorRef = doc(db, "usuarios", sponsor.id);

      // Puntos de equipo
      await updateDoc(sponsorRef, { teamPoints: increment(pointsEarned) });

      // Comisión monetaria
      const percent = LEVEL_PERCENTS[level];
      const commissionValue = Math.round(pointsEarned * POINT_VALUE * percent);

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

      sponsorCode = sponsor.data.patrocinador || null;
    }
  } catch (err) {
    console.error("Error distribuyendo puntos:", err);
  }
}

// Render de productos
function renderProductos() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  grid.innerHTML = productos.map((prod) => `
    <div class="product-card" data-id="${prod.id}">
      <img src="${prod.imagen}" alt="${prod.nombre}">
      <h4>${prod.nombre}</h4>
      <p>${prod.descripcion}</p>
      <p><strong>${formatCOP(prod.precio)}</strong></p>
      <button class="btn small btn-buy" data-id="${prod.id}">Comprar</button>
    </div>
  `).join("");

  document.querySelectorAll(".btn-buy").forEach((btn) => {
    btn.addEventListener("click", onBuyClick);
  });
}

// Handler de compra
async function onBuyClick(e) {
  if (!auth.currentUser) {
    alert("Debes iniciar sesión para comprar.");
    window.location.href = "distribuidor-login.html";
    return;
  }

  const prodId = e.currentTarget.dataset.id;
  const prod = productos.find((p) => p.id === prodId);
  if (!prod) return;

  const buyerUid = auth.currentUser.uid;

  // Crear orden
  const orderRef = await addDoc(collection(db, "orders"), {
    productId: prod.id,
    productName: prod.nombre,
    price: prod.precio,
    points: prod.puntos,
    buyerUid,
    status: "pending",
    createdAt: new Date().toISOString()
  });

  // Método de pago
  const wantMP = confirm(`¿Cómo deseas pagar?\n\nAceptar = Transferencia/MercadoPago\nCancelar = Efectivo`);
  
  if (wantMP) {
    const res = await fetch("/.netlify/functions/create-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: orderRef.id,
        items: [{ title: prod.nombre, unit_price: prod.precio, quantity: 1 }],
        payerUid: buyerUid
      })
    });

    const data = await res.json();
    await updateDoc(orderRef, {
      status: "pending_mp",
      preferenceId: data.preferenceId || null,
      mp_init_point: data.init_point || data.sandbox_init_point || null
    });

    if (data.init_point) window.location.href = data.init_point;
    else if (data.sandbox_init_point) window.location.href = data.sandbox_init_point;
  } else {
    await updateDoc(orderRef, { status: "pending_cash" });
    window.location.href = `checkout.html?orderId=${orderRef.id}`;
  }

  const buyerDoc = await getDoc(doc(db, "usuarios", buyerUid));
  const buyerData = buyerDoc.exists() ? buyerDoc.data() : null;
  const sponsorCode = buyerData ? buyerData.patrocinador : null;

  // Bono rápido (solo paquete inicial)
  if (prod.id === "paquete-inicio" && sponsorCode) {
    try {
      const sponsor = await findUserByUsername(sponsorCode);
      if (sponsor) {
        const sponsorRef = doc(db, "usuarios", sponsor.id);

        const fastStartPoints = Math.round(prod.puntos * 0.30);
        const fastStartValue = fastStartPoints * POINT_VALUE;

        await updateDoc(sponsorRef, {
          balance: increment(fastStartValue),
          history: arrayUnion({
            action: `Bono de inicio rápido por compra de ${buyerData?.usuario || "desconocido"}`,
            amount: fastStartValue,
            points: fastStartPoints,
            orderId: orderRef.id,
            date: new Date().toISOString()
          })
        });

        console.log(`✅ Bono de inicio rápido asignado: ${fastStartValue} COP (${fastStartPoints} pts)`);
      }
    } catch (err) {
      console.error("❌ Error asignando bono de inicio rápido:", err);
    }
  }

  // Distribución normal
  await distributePointsUpline(sponsorCode, prod.puntos, buyerData?.usuario || "desconocido", orderRef.id);

  // Historial comprador
  await updateDoc(doc(db, "usuarios", buyerUid), {
    history: arrayUnion({
      action: `Compra ${prod.nombre}`,
      amount: prod.precio,
      points: prod.puntos,
      orderId: orderRef.id,
      date: new Date().toISOString()
    })
  });

  console.log("Compra registrada, bono rápido (si aplica) y puntos distribuidos.");
}

document.addEventListener("DOMContentLoaded", () => {
  renderProductos();
});
