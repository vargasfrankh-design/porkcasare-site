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

const POINT_VALUE = 3800;
const LEVEL_PERCENTS = [0.05, 0.03, 0.02, 0.01, 0.005];

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

function formatCOP(num) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0
  }).format(num);
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
    for (let level = 0; level < LEVEL_PERCENTS.length; level++) {
      if (!sponsorCode) break;
      const sponsor = await findUserByUsername(sponsorCode);
      if (!sponsor) break;

      const sponsorRef = doc(db, "usuarios", sponsor.id);

      await updateDoc(sponsorRef, { teamPoints: increment(pointsEarned) });

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

  // 👉 Crear orden en Firestore
  const orderRef = await addDoc(collection(db, "orders"), {
    productId: prod.id,
    productName: prod.nombre,
    price: prod.precio,
    points: prod.puntos,
    buyerUid,
    status: "pending",
    createdAt: new Date().toISOString(),
    isInitial: prod.id === "paquete-inicio",   // 👈 agregado
    initialBonusPaid: false                   // 👈 agregado
  });

  // Patch: reemplaza el confirm(...) por un modal bonito de un solo botón.
// Inserta este fragmento justo después de la creación de orderRef en oficina-virtual/js/productos.js

// Mostrar modal bonito con una sola opción ("Efectivo o Transferencia") y un botón Aceptar.
await new Promise((resolve) => {
  const overlay = document.createElement('div');
  overlay.setAttribute('id','payment-modal-overlay');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.background = 'rgba(0,0,0,0.45)';
  overlay.style.zIndex = '9999';
  overlay.style.backdropFilter = 'blur(2px)';

  const box = document.createElement('div');
  box.style.maxWidth = '420px';
  box.style.width = '90%';
  box.style.padding = '20px';
  box.style.borderRadius = '12px';
  box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
  box.style.background = 'linear-gradient(180deg, #ffffff, #fbfbfb)';
  box.style.textAlign = 'center';
  box.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';

  const h = document.createElement('h3');
  h.textContent = 'Confirmar compra';
  h.style.margin = '0 0 8px 0';
  h.style.fontSize = '18px';
  h.style.fontWeight = '700';
  box.appendChild(h);

  const p = document.createElement('p');
  p.innerHTML = 'Método de pago: <strong>Efectivo o Transferencia</strong>';
  p.style.margin = '0 0 18px 0';
  p.style.fontSize = '14px';
  p.style.color = '#333';
  box.appendChild(p);

  const btn = document.createElement('button');
  btn.textContent = 'Aceptar';
  btn.style.padding = '10px 18px';
  btn.style.border = 'none';
  btn.style.borderRadius = '10px';
  btn.style.cursor = 'pointer';
  btn.style.fontWeight = '600';
  btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)';
  btn.style.background = 'linear-gradient(90deg,#34D399,#10B981)';
  btn.style.color = 'white';
  btn.addEventListener('mouseenter', ()=> btn.style.transform='translateY(-1px)');
  btn.addEventListener('mouseleave', ()=> btn.style.transform='translateY(0)');
  btn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    resolve();
  });

  box.appendChild(btn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
});

// Guardar como si fuera pago en efectivo (estatus y redirección)
await updateDoc(orderRef, { status: "pending_cash" });
window.location.href = `checkout.html?orderId=${orderRef.id}`;

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

  await distributePointsUpline(sponsorCode, prod.puntos, buyerData?.usuario || "desconocido", orderRef.id);

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
