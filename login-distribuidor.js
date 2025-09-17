import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth, db } from "./src/firebase-config.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

document.getElementById("distribuidorLogin").addEventListener("submit", async function(e) {
  e.preventDefault();

  const usuario = document.getElementById("usuario").value.trim();
  const password = document.getElementById("password").value;

  try {
    const usuariosRef = collection(db, "usuarios");
    const q = query(usuariosRef, where("usuario", "==", usuario));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error("Usuario no encontrado");
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data();
    const email = userData.email;

    // Autenticación con email y contraseña
    await signInWithEmailAndPassword(auth, email, password);

    if (userData.tipoRegistro !== "distribuidor") {
      throw new Error("No tiene permiso para acceder como distribuidor.");
    }

    Swal.fire({
      icon: 'success',
      title: '¡Bienvenido!',
      text: 'Redirigiendo al panel...',
      showConfirmButton: false,
      timer: 2000
    }).then(() => {
      window.location.href = "distribuidor.html";
    });

  } catch (error) {
    console.error("Error en login:", error.message);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message
    });
  }
});
