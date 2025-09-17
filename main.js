import { auth, db } from "./src/firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { setDoc, doc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

// ---- Registro de Usuario ----
document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    alert("Las contraseñas no coinciden");
    return;
  }

  try {
    // Crear usuario en Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    // Guardar datos adicionales en Firestore
    await setDoc(doc(db, "usuarios", userCredential.user.uid), {
      tipoRegistro: document.getElementById("tipoRegistro").value,
      pais: countrySelect.value,
      provincia: provinceSelect.value,
      ciudad: citySelect.value,
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
    window.location.href = "distribuidor-login.html";

  } catch (error) {
    console.error("Error en registro:", error.message);
    alert("❌ Error: " + error.message);
  }
});
