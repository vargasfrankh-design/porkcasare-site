import { auth, db } from "./src/firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { setDoc, doc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// --------- Función: Verificar existencia del patrocinador ---------
async function verifySponsorExists(sponsorCode) {
  if (!sponsorCode) return false;
  const usuariosCol = collection(db, 'usuarios');
  const q = query(usuariosCol, where('usuario', '==', sponsorCode));
  const snap = await getDocs(q);
  return !snap.empty;
}

// --------- Datos de ubicación (puedes mover esto a un JSON externo si crece) ---------
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

// --------- Poblar selects dinámicamente ---------
const paisSelect = document.getElementById("pais");
const provinciaSelect = document.getElementById("provincia");
const ciudadSelect = document.getElementById("ciudad");

Object.keys(dataUbicacion).forEach(pais => {
  const option = document.createElement("option");
  option.value = pais;
  option.textContent = pais;
  paisSelect.appendChild(option);
});

paisSelect.addEventListener("change", () => {
  provinciaSelect.innerHTML = "<option value=''>Seleccione...</option>";
  ciudadSelect.innerHTML = "<option value=''>Seleccione...</option>";

  const provincias = Object.keys(dataUbicacion[paisSelect.value] || {});
  provincias.forEach(prov => {
    const option = document.createElement("option");
    option.value = prov;
    option.textContent = prov;
    provinciaSelect.appendChild(option);
  });
});

provinciaSelect.addEventListener("change", () => {
  ciudadSelect.innerHTML = "<option value=''>Seleccione...</option>";

  const ciudades = dataUbicacion[paisSelect.value]?.[provinciaSelect.value] || [];
  ciudades.forEach(ciudad => {
    const option = document.createElement("option");
    option.value = ciudad;
    option.textContent = ciudad;
    ciudadSelect.appendChild(option);
  });
});

// --------- Evento: Envío del formulario ---------
document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmPassword = document.getElementById("confirmPassword").value.trim();
  const sponsor = document.getElementById("patrocinador").value.trim();

  if (password !== confirmPassword) {
    alert("❌ Las contraseñas no coinciden");
    return;
  }

  // Validar patrocinador
  const sponsorOk = await verifySponsorExists(sponsor);
  if (!sponsorOk) {
    alert("❌ El código del patrocinador no es válido. Verifique el enlace o escriba un patrocinador válido.");
    return;
  }

  try {
    // Crear usuario en Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // Guardar datos en Firestore
    await setDoc(doc(db, "usuarios", uid), {
      tipoRegistro: document.getElementById("tipoRegistro").value,
      pais: document.getElementById("pais").value,
      provincia: document.getElementById("provincia").value,
      ciudad: document.getElementById("ciudad").value,
      patrocinador: sponsor,
      usuario: document.getElementById("usuario").value.trim(),
      nombre: document.getElementById("nombre").value.trim(),
      apellido: document.getElementById("apellido").value.trim(),
      sexo: document.getElementById("sexo").value,
      fechaNacimiento: document.getElementById("fechaNacimiento").value,
      tipoDocumento: document.getElementById("tipoDocumento").value,
      numeroDocumento: document.getElementById("numeroDocumento").value.trim(),
      email: email,
      direccion: document.getElementById("direccion").value.trim(),
      celular: document.getElementById("celular").value.trim(),
      codigoPostal: document.getElementById("codigoPostal").value.trim(),
      creadoEn: new Date()
    });

    alert("✅ Registro exitoso. Ahora puede iniciar sesión.");
    window.location.href = "distribuidor-login.html";

  } catch (error) {
    console.error("Error en registro:", error);
    alert("❌ Error en el registro: " + error.message);
  }
});
