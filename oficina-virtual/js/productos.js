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

// --- Modal grande para que el cliente edite y confirme sus datos ---
// Incluye opción de 'A domicilio' o 'Recoger en oficina'
function showCustomerFormModal(initial = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.zIndex = '10000';
    overlay.style.backdropFilter = 'blur(3px)';

    const box = document.createElement('div');
    box.style.width = 'min(900px, 96%)';
    box.style.maxHeight = '90vh';
    box.style.overflow = 'auto';
    box.style.padding = '22px';
    box.style.borderRadius = '14px';
    box.style.boxShadow = '0 18px 50px rgba(0,0,0,0.35)';
    box.style.background = 'linear-gradient(180deg,#ffffff,#f8fafc)';
    box.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';

    const title = document.createElement('h2');
    title.textContent = 'Completa tus datos para finalizar la compra';
    title.style.margin = '0 0 10px 0';
    title.style.fontSize = '20px';
    title.style.fontWeight = '700';
    box.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Revisa o edita la información que usaremos para procesar tu pedido.';
    subtitle.style.margin = '0 0 12px 0';
    subtitle.style.color = '#374151';
    box.appendChild(subtitle);

    // --- Delivery method radios ---
    const deliveryWrapper = document.createElement('div');
    deliveryWrapper.style.display = 'flex';
    deliveryWrapper.style.alignItems = 'center';
    deliveryWrapper.style.gap = '12px';
    deliveryWrapper.style.marginBottom = '12px';

    const labelDM = document.createElement('span');
    labelDM.textContent = 'Entrega:';
    labelDM.style.fontWeight = '600';
    labelDM.style.color = '#111827';
    deliveryWrapper.appendChild(labelDM);

    const createRadio = (value, text) => {
      const id = `dm-${value}-${Date.now() + Math.floor(Math.random()*1000)}`;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'deliveryMethod';
      radio.value = value;
      radio.id = id;

      const lab = document.createElement('label');
      lab.htmlFor = id;
      lab.textContent = text;
      lab.style.marginRight = '8px';
      lab.style.cursor = 'pointer';

      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.gap = '6px';
      container.appendChild(radio);
      container.appendChild(lab);
      return { container, radio };
    };

    const dmHome = createRadio('home', 'A domicilio');
    const dmPickup = createRadio('pickup', 'Recoger en oficina');

    deliveryWrapper.appendChild(dmHome.container);
    deliveryWrapper.appendChild(dmPickup.container);
    box.appendChild(deliveryWrapper);

    // --- Form ---
    const form = document.createElement('form');
    form.style.display = 'grid';
    form.style.gridTemplateColumns = '1fr 1fr';
    form.style.gap = '12px';

    const createField = (name, label, value = '', placeholder = '') => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';

      const lab = document.createElement('label');
      lab.textContent = label;
      lab.style.fontSize = '13px';
      lab.style.marginBottom = '6px';
      lab.style.color = '#111827';
      wrapper.appendChild(lab);

      const input = document.createElement('input');
      input.name = name;
      input.value = value || '';
      input.placeholder = placeholder;
      input.style.padding = '10px 12px';
      input.style.border = '1px solid rgba(15,23,42,0.08)';
      input.style.borderRadius = '8px';
      input.style.fontSize = '14px';
      input.style.outline = 'none';
      input.addEventListener('focus', () => input.style.boxShadow = '0 6px 18px rgba(16,185,129,0.12)');
      input.addEventListener('blur', () => input.style.boxShadow = 'none');
      wrapper.appendChild(input);

      return { wrapper, input };
    };

    const fNombre = createField('firstName', 'Nombre', initial.firstName || initial.nombre || '', 'Tu nombre');
    const fApellido = createField('lastName', 'Apellido', initial.lastName || initial.apellido || '', 'Tu apellido');
    const fEmail = createField('email', 'Correo electrónico', initial.email || '', 'tucorreo@ejemplo.com');
    const fTelefono = createField('phone', 'Teléfono', initial.phone || initial.telefono || '', '+57 300 0000000');
    const fDireccion = createField('address', 'Dirección', initial.address || initial.direccion || '', 'Calle, número, barrio');
    const fCiudad = createField('city', 'Ciudad', initial.city || '', 'Ciudad');

    form.appendChild(fNombre.wrapper);
    form.appendChild(fApellido.wrapper);
    form.appendChild(fEmail.wrapper);
    form.appendChild(fTelefono.wrapper);
    form.appendChild(fDireccion.wrapper);
    form.appendChild(fCiudad.wrapper);

    const notasWrapper = document.createElement('div');
    notasWrapper.style.gridColumn = '1 / -1';
    const labNotas = document.createElement('label');
    labNotas.textContent = 'Notas (opcional)';
    labNotas.style.fontSize = '13px';
    labNotas.style.marginBottom = '6px';
    notasWrapper.appendChild(labNotas);
    const ta = document.createElement('textarea');
    ta.name = 'notes';
    ta.placeholder = 'Instrucciones para la entrega, referencia, etc.';
    ta.value = initial.notes || '';
    ta.style.minHeight = '84px';
    ta.style.padding = '10px 12px';
    ta.style.borderRadius = '8px';
    ta.style.border = '1px solid rgba(15,23,42,0.08)';
    ta.style.fontSize = '14px';
    notasWrapper.appendChild(ta);
    form.appendChild(notasWrapper);

    box.appendChild(form);

    // Pickup info area (hidden unless pickup)
    const pickupInfo = document.createElement('div');
    pickupInfo.style.marginTop = '10px';
    pickupInfo.style.padding = '10px';
    pickupInfo.style.borderRadius = '8px';
    pickupInfo.style.background = 'rgba(15,23,42,0.03)';
    pickupInfo.style.fontSize = '13px';
    pickupInfo.style.color = '#111827';
    pickupInfo.innerHTML = `
      <strong>Recoger en oficina:</strong> Puedes recoger tu pedido en nuestra oficina principal.
      <br>Dirección: Calle 123 #45-67, Ciudad.
      <br>Horario: Lun-Vie 9:00 - 17:00.
    `;
    pickupInfo.style.display = 'none';
    box.appendChild(pickupInfo);

    // Determine initial delivery method
    const initialDM = initial.deliveryMethod || initial.delivery || 'home';
    if (initialDM === 'pickup') {
      dmPickup.radio.checked = true;
      pickupInfo.style.display = 'block';
      fDireccion.wrapper.style.display = 'none';
      fCiudad.wrapper.style.display = 'none';
    } else {
      dmHome.radio.checked = true;
      pickupInfo.style.display = 'none';
      fDireccion.wrapper.style.display = '';
      fCiudad.wrapper.style.display = '';
    }

    // When delivery method changes, show/hide address fields
    const updateDeliveryUI = (method) => {
      if (method === 'pickup') {
        pickupInfo.style.display = 'block';
        fDireccion.wrapper.style.display = 'none';
        fCiudad.wrapper.style.display = 'none';
      } else {
        pickupInfo.style.display = 'none';
        fDireccion.wrapper.style.display = '';
        fCiudad.wrapper.style.display = '';
      }
    };
    dmHome.radio.addEventListener('change', () => updateDeliveryUI('home'));
    dmPickup.radio.addEventListener('change', () => updateDeliveryUI('pickup'));

    // Buttons
    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.justifyContent = 'flex-end';
    buttons.style.gap = '10px';
    buttons.style.marginTop = '16px';

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.textContent = 'Cancelar';
    btnCancel.style.padding = '10px 14px';
    btnCancel.style.borderRadius = '10px';
    btnCancel.style.border = '1px solid rgba(15,23,42,0.06)';
    btnCancel.style.background = 'transparent';
    btnCancel.style.cursor = 'pointer';
    btnCancel.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(null);
    });

    const btnConfirm = document.createElement('button');
    btnConfirm.type = 'button';
    btnConfirm.textContent = 'Confirmar y pagar (Efectivo/Transferencia)';
    btnConfirm.style.padding = '10px 16px';
    btnConfirm.style.border = 'none';
    btnConfirm.style.borderRadius = '10px';
    btnConfirm.style.background = 'linear-gradient(90deg,#34D399,#10B981)';
    btnConfirm.style.color = 'white';
    btnConfirm.style.cursor = 'pointer';
    btnConfirm.style.fontWeight = '700';

    btnConfirm.addEventListener('click', () => {
      const deliveryMethod = dmPickup.radio.checked ? 'pickup' : 'home';

      const payload = {
        firstName: fNombre.input.value.trim(),
        lastName: fApellido.input.value.trim(),
        email: fEmail.input.value.trim(),
        phone: fTelefono.input.value.trim(),
        address: fDireccion.input.value.trim(),
        city: fCiudad.input.value.trim(),
        notes: ta.value.trim(),
        deliveryMethod
      };

      // Validaciones
      if (!payload.firstName) { alert('Por favor ingresa tu nombre.'); fNombre.input.focus(); return; }
      if (!payload.email || !/\S+@\S+\.\S+/.test(payload.email)) { alert('Por favor ingresa un correo válido.'); fEmail.input.focus(); return; }
      if (!payload.phone) { alert('Por favor ingresa un teléfono de contacto.'); fTelefono.input.focus(); return; }
      if (deliveryMethod === 'home' && !payload.address) { alert('Por favor ingresa la dirección de entrega.'); fDireccion.input.focus(); return; }
      if (deliveryMethod === 'home' && !payload.city) { alert('Por favor ingresa la ciudad.'); fCiudad.input.focus(); return; }

      // Si es pickup, opcionalmente crear un campo que marque la oficina
      if (deliveryMethod === 'pickup') {
        payload.pickupLocation = {
          name: 'Oficina PorkCasaRe',
          address: 'Calle 123 #45-67, Ciudad',
          hours: 'Lun-Vie 9:00 - 17:00'
        };
        // limpiar address fields o mantener para registro
        // payload.address = payload.address || '';
      }

      document.body.removeChild(overlay);
      resolve(payload);
    });

    buttons.appendChild(btnCancel);
    buttons.appendChild(btnConfirm);
    box.appendChild(buttons);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    setTimeout(() => fNombre.input.focus(), 120);
  });
}

async function finalizeOrderWithCustomerData(orderRef, buyerUid) {
  // Información fija de la oficina (si quieres cambiarla, actualiza aquí)
  const OFFICE_INFO = {
    name: 'Oficina PorkCasaRe',
    address: 'Calle 123 #45-67, Ciudad',
    hours: 'Lun-Vie 9:00 - 17:00',
    contact: '+57 300 0000000'
  };

  let initial = {};
  try {
    if (buyerUid) {
      const userDoc = await getDoc(doc(db, 'usuarios', buyerUid));
      if (userDoc.exists()) initial = userDoc.data();
    }
  } catch (err) {
    console.warn('No se pudo leer perfil del usuario para prefill:', err);
  }

  const customerData = await showCustomerFormModal(initial);
  if (!customerData) {
    // Usuario canceló: no continuar
    return false;
  }

  const toSave = {
    status: 'pending_cash',
    buyerInfo: customerData,
    deliveryMethod: customerData.deliveryMethod || 'home',
    updatedAt: new Date()
  };

  if (customerData.deliveryMethod === 'pickup') {
    toSave.pickupInfo = customerData.pickupLocation || OFFICE_INFO;
    // Si quieres, puedes sobrescribir buyerInfo.address por la oficina:
    toSave.buyerInfo.address = toSave.pickupInfo.address;
    toSave.buyerInfo.city = ''; // opcional
  }

  await updateDoc(orderRef, toSave);

  window.location.href = `checkout.html?orderId=${orderRef.id}`;
  return true;
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

// Abrir modal grande para que el cliente confirme/edite datos y finalizar la orden
const finalized = await finalizeOrderWithCustomerData(orderRef, buyerUid);
if (!finalized) {
  // Si el usuario canceló en el modal grande, detén el flujo (no redirigimos)
  return;
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
