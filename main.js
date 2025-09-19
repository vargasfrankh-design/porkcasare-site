import { auth, db } from "./src/firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { setDoc, doc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

async function verifySponsorExists(sponsorCode) {
  if (!sponsorCode) return false;
  const usuariosCol = collection(db, 'usuarios');
  const q = query(usuariosCol, where('usuario', '==', sponsorCode));
  const snap = await getDocs(q);
  return !snap.empty;
}

// uso dentro del submit del registerForm:
const sponsor = document.getElementById('patrocinador').value || null;
const sponsorOk = await verifySponsorExists(sponsor);
if (!sponsorOk) {
  alert('El código del patrocinador no es válido. Verifique el enlace o escriba un patrocinador válido.');
  return;
}

// ---- Datos de ubicación ----
const dataUbicacion = {
  "Colombia": {
    "Boyacá": ["Tunja", "Duitama", "Sogamoso"],
    "Cundinamarca": ["Bogotá", "Soacha", "Chía"]
  },
  "Ecuador": {
    "Pichincha": ["Quito", "Cayambe"],
    "Guayas": ["Guayaquil", "Daule"]
  }
};

// ---- Poblar select dinámico ----
const paisSelect = document.getElementById("pais");
const provinciaSelect = document.getElementById("provincia");
const ciudadSelect = document.getElementById("ciudad");

// Agregar países
Object.keys(dataUbicacion).forEach(pais => {
  let option = document.createElement("option");
  option.value = pais;
  option.textContent = pais;
  paisSelect.appendChild(option);
});

paisSelect.addEventListener("change", () => {
  provinciaSelect.innerHTML = "<option value=''>Seleccione...</option>";
  ciudadSelect.innerHTML = "<option value=''>Seleccione...</option>";

  let provincias = Object.keys(dataUbicacion[paisSelect.value] || {});
  provincias.forEach(prov => {
    let option = document.createElement("option");
    option.value = prov;
    option.textContent = prov;
    provinciaSelect.appendChild(option);
  });
});

provinciaSelect.addEventListener("change", () => {
  ciudadSelect.innerHTML = "<option value=''>Seleccione...</option>";
  let ciudades = dataUbicacion[paisSelect.value]?.[provinciaSelect.value] || [];
  ciudades.forEach(c => {
    let option = document.createElement("option");
    option.value = c;
    option.textContent = c;
    ciudadSelect.appendChild(option);
  });
});

// Evento de submit del formulario de registro
document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    alert("❌ Las contraseñas no coinciden");
    return;
  }

  try {
    // Crear usuario en Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    // Guardar datos adicionales en Firestore
    await setDoc(doc(db, "usuarios", userCredential.user.uid), {
      tipoRegistro: document.getElementById("tipoRegistro").value,
      pais: document.getElementById("pais").value,
      provincia: document.getElementById("provincia").value,
      ciudad: document.getElementById("ciudad").value,
      patrocinador: document.getElementById("patrocinador").value,
      usuario: document.getElementById("usuario").value,
      nombre: document.getElementById("nombre").value,
      apellido: document.getElementById("apellido").value,
      sexo: document.getElementById("sexo").value,
      fechaNacimiento: document.getElementById("fechaNacimiento").value,
      tipoDocumento: document.getElementById("tipoDocumento").value,
      numeroDocumento: document.getElementById("numeroDocumento").value,
      email: email,
      direccion: document.getElementById("direccion").value,
      celular: document.getElementById("celular").value,
      codigoPostal: document.getElementById("codigoPostal").value,
      creadoEn: new Date()
    });

    alert("✅ Registro exitoso. Ahora puede iniciar sesión.");
    window.location.href = "distribuidor-login.html"; // Redirección automática

  } catch (error) {
    console.error("Error en registro:", error.message);
    alert("❌ Error: " + error.message);
  }
});
