import { auth, db } from "./src/firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

document.getElementById("distribuidorLogin").addEventListener("submit", async (e) => {
  e.preventDefault();

  const usuarioInput = document.getElementById("usuario").value.trim();
  const password = document.getElementById("password").value;

  if (!usuarioInput || !password) {
    Swal.fire({
      icon: 'warning',
      title: 'Campos vacíos',
      text: 'Debe ingresar usuario y contraseña.'
    });
    return;
  }

  try {
    // Paso 1: Buscar email por nombre de usuario en Firestore
    const usuariosRef = collection(db, "usuarios");
    const q = query(usuariosRef, where("usuario", "==", usuarioInput));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      Swal.fire({
        icon: 'error',
        title: 'Usuario no encontrado',
        text: 'Verifica el nombre de usuario.'
      });
      return;
    }

    // Paso 2: Obtener el email del primer resultado
    const userDoc = querySnapshot.docs[0];
    const email = userDoc.data().email;

    // Paso 3: Login con email y contraseña
    const userCredential = await signInWithEmailAndPassword(auth, email, password);

    Swal.fire({
      icon: 'success',
      title: '¡Bienvenido!',
      text: 'Redirigiendo a la oficina virtual...',
      showConfirmButton: false,
      timer: 2000
    }).then(() => {
      window.location.href = "/oficina-virtual/index.html";
    });

  } catch (error) {
    console.error("Error en login:", error.message);
    Swal.fire({
      icon: 'error',
      title: 'Error al iniciar sesión',
      text: error.message
    });
  }
});
