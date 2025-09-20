import { auth, db } from "./src/firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { setDoc, doc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------- Función: Verificar existencia del patrocinador ----------
async function verifySponsorExists(sponsorCode) {
  if (!sponsorCode) return false;
  const usuariosCol = collection(db, 'usuarios');
  const q = query(usuariosCol, where('usuario', '==', sponsorCode));
  const snap = await getDocs(q);
  return !snap.empty;
}

// ---------- Función: Verificar si el nombre de usuario ya existe ----------
async function isUsernameTaken(username) {
  const usuariosCol = collection(db, 'usuarios');
  const q = query(usuariosCol, where('usuario', '==', username));
  const snap = await getDocs(q);
  return !snap.empty;
}

// ---------- Datos de ubicación ----------
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

// ---------- Poblar selects de ubicación ----------
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

// ---------- Evento de envío del formulario ----------
document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  // Obtener datos del formulario
  const tipoRegistro = document.getElementById("tipoRegistro").value;
  const pais = document.getElementById("pais").value;
  const provincia = document.getElementById("provincia").value;
  const ciudad = document.getElementById("ciudad").value;
  const usuario = document.getElementById("usuario").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmPassword = document.getElementById("confirmPassword").value.trim();
  const nombre = document.getElementById("nombre").value.trim();
  const apellido = document.getElementById("apellido").value.trim();
  const sexo = document.getElementById("sexo").value;
  const fechaNacimiento = document.getElementById("fechaNacimiento").value;
  const tipoDocumento = document.getElementById("tipoDocumento").value;
  const numeroDocumento = document.getElementById("numeroDocumento").value.trim();
  const patrocinador = document.getElementById("patrocinador").value.trim();
  const email = document.getElementById("email").value.trim();
  const celular = document.getElementById("celular").value.trim();
  const direccion = document.getElementById("direccion").value.trim();
  const codigoPostal = document.getElementById("codigoPostal").value.trim();

  // Validación
  const errores = [];

  if (!tipoRegistro || !pais || !provincia || !ciudad || !usuario || !password || !confirmPassword || !nombre || !apellido || !sexo || !fechaNacimiento || !tipoDocumento || !numeroDocumento || !email || !celular || !direccion) {
    errores.push("Debes completar todos los campos obligatorios.");
  }

  const userRegex = /^[a-zA-Z0-9_]{4,}$/;
  if (!userRegex.test(usuario)) {
    errores.push("El nombre de usuario debe tener al menos 4 caracteres y solo puede contener letras, números o guión bajo.");
  }

  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
  if (!passwordRegex.test(password)) {
    errores.push("La contraseña debe tener al menos 8 caracteres, una letra y un número.");
  }

  if (password !== confirmPassword) {
    errores.push("Las contraseñas no coinciden.");
  }

  const numericRegex = /^[0-9]+$/;
  if (!numericRegex.test(numeroDocumento)) {
    errores.push("El número de documento debe contener solo números.");
  }
  if (!numericRegex.test(celular)) {
    errores.push("El celular debe contener solo números.");
  }

  // Validar patrocinador
  const sponsorOk = await verifySponsorExists(patrocinador);
  if (!sponsorOk) {
    errores.push("El código del patrocinador no es válido.");
  }

  // Validar nombre de usuario único
  const usernameTaken = await isUsernameTaken(usuario);
  if (usernameTaken) {
    errores.push("El nombre de usuario ya está en uso. Elige otro.");
  }

  if (errores.length > 0) {
    Swal.fire({
      icon: 'error',
      title: 'Errores en el formulario',
      html: errores.map(err => `<p>• ${err}</p>`).join('')
    });
    return;
  }

  // Si todo está correcto, registrar
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    await setDoc(doc(db, "usuarios", uid), {
      tipoRegistro,
      pais,
      provincia,
      ciudad,
      usuario,
      nombre,
      apellido,
      sexo,
      fechaNacimiento,
      tipoDocumento,
      numeroDocumento,
      patrocinador,
      email,
      celular,
      direccion,
      codigoPostal,
      creadoEn: new Date()
    });

    Swal.fire({
      icon: 'success',
      title: 'Registro exitoso',
      text: 'Tu cuenta ha sido creada correctamente.',
      confirmButtonText: 'Iniciar sesión'
    }).then(() => {
      window.location.href = "distribuidor-login.html";
    });

  } catch (error) {
    console.error("Error en el registro:", error);
    let msg = "Error al registrar usuario.";

    if (error.code === "auth/email-already-in-use") {
      msg = "El correo electrónico ya está registrado.";
    } else if (error.code === "auth/invalid-email") {
      msg = "El correo electrónico no es válido.";
    } else if (error.code === "auth/weak-password") {
      msg = "La contraseña es demasiado débil.";
    }

    Swal.fire({
      icon: 'error',
      title: 'Error al registrar',
      text: msg
    });
  }
});
