// === Inicialización de Firebase ===
// Estas claves NO van aquí directo en el código,
// sino en Netlify como variables de entorno.
// Usamos import.meta.env para llamarlas.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// === Registro de Distribuidor ===
document.getElementById("formRegistro").addEventListener("submit", async (e) => {
  e.preventDefault();

  // Tomamos los valores del formulario
  const tipoRegistro = document.getElementById("tipoRegistro").value;
  const pais = document.getElementById("pais").value;
  const provincia = document.getElementById("provincia").value;
  const ciudad = document.getElementById("ciudad").value;
  const patrocinador = document.getElementById("patrocinador").value;
  const usuario = document.getElementById("usuario").value;
  const password = document.getElementById("password").value;
  const passwordConfirm = document.getElementById("passwordConfirm").value;
  const nombre = document.getElementById("nombre").value;
  const apellido = document.getElementById("apellido").value;
  const sexo = document.getElementById("sexo").value;
  const fechaNacimiento = document.getElementById("fechaNacimiento").value;
  const documento = document.getElementById("documento").value;
  const email = document.getElementById("email").value;
  const direccion = document.getElementById("direccion").value;
  const celular = document.getElementById("celular").value;
  const codigoPostal = document.getElementById("codigoPostal").value;
  const acepta = document.getElementById("acepta").checked;

  // Validaciones básicas
  if (password !== passwordConfirm) {
    alert("Las contraseñas no coinciden");
    return;
  }

  if (!acepta) {
    alert("Debes aceptar los acuerdos de PorkCasare");
    return;
  }

  try {
    // 1️⃣ Crear usuario en Firebase Auth
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    const userId = userCredential.user.uid;

    // 2️⃣ Guardar datos extra en Firestore
    await db.collection("distribuidores").doc(userId).set({
      tipoRegistro,
      pais,
      provincia,
      ciudad,
      patrocinador,
      usuario,
      nombre,
      apellido,
      sexo,
      fechaNacimiento,
      documento,
      email,
      direccion,
      celular,
      codigoPostal,
      fechaRegistro: new Date().toISOString()
    });

    alert("✅ Registro exitoso. Ahora puedes iniciar sesión.");
    window.location.href = "login.html";

  } catch (error) {
    console.error("Error en registro:", error);
    alert("❌ Error: " + error.message);
  }
});
