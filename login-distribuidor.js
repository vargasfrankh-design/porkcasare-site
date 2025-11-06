import { auth, db } from "./src/firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
<<<<<<< HEAD
import { collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
=======
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe

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
<<<<<<< HEAD
    const userData = userDoc.data();
    const email = userData.email;

    console.log("Usuario encontrado en Firestore:", usuarioInput);
    console.log("Email obtenido:", email);

    if (!email) {
      Swal.fire({
        icon: 'error',
        title: 'Error de configuración',
        text: 'El usuario no tiene un email asociado en la base de datos.'
      });
      return;
    }
=======
    const email = userDoc.data().email;
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe

    // Paso 3: Login con email y contraseña
    const userCredential = await signInWithEmailAndPassword(auth, email, password);

<<<<<<< HEAD
    // Verificar y asignar role si no existe (después de autenticación)
    if (!userData.role && !userData.rol) {
      console.log("Usuario sin role detectado, asignando 'distribuidor' por defecto");
      await updateDoc(doc(db, "usuarios", userDoc.id), {
        role: 'distribuidor'
      });
      console.log("Role 'distribuidor' asignado correctamente");
    }

=======
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
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
<<<<<<< HEAD
    console.error("Error en login:", error);
    console.error("Código de error:", error.code);
    console.error("Mensaje de error:", error.message);
    
    let errorMessage = 'Ocurrió un error al iniciar sesión.';
    
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
      errorMessage = 'Credenciales inválidas. Verifica que:\n• El usuario exista en el sistema\n• La contraseña sea correcta\n• El usuario tenga una cuenta activa en Firebase Authentication';
    } else if (error.code === 'auth/user-not-found') {
      errorMessage = 'El email encontrado no tiene una cuenta de autenticación activa en Firebase.';
    } else if (error.code === 'auth/user-disabled') {
      errorMessage = 'Esta cuenta ha sido deshabilitada.';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Demasiados intentos fallidos. Por favor, intenta más tarde.';
    } else if (error.code === 'auth/network-request-failed') {
      errorMessage = 'Error de conexión. Verifica tu conexión a internet.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'El email asociado al usuario es inválido. Contacta al administrador.';
    }
    
    Swal.fire({
      icon: 'error',
      title: 'Error al iniciar sesión',
      text: errorMessage,
      footer: 'Código de error: ' + error.code
=======
    console.error("Error en login:", error.message);
    Swal.fire({
      icon: 'error',
      title: 'Error al iniciar sesión',
      text: error.message
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
    });
  }
});
