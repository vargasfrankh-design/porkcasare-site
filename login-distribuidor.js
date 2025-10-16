
// login-distribuidor.combined.js
// Combina la lógica original con robustez ante reglas de Firestore:
// - Intenta resolver username -> email consultando 'usuarios' (como antes)
// - Si la consulta falla por permisos, ofrece fallback para iniciar sesión con email
// - Si el input parece email (contiene @) intenta iniciar sesión directamente
// - Llama user.getIdToken(true) tras login para evitar race conditions
// - Deshabilita el botón submit para evitar doble envío
// - Muestra mensajes claros usando Swal.fire (ya presente en la app)

import { auth, db } from "./src/firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const form = document.getElementById("distribuidorLogin");
if (!form) {
  console.warn("No se encontró el formulario de login (id=distribuidorLogin)");
} else {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();

    const submitBtn = form.querySelector('button[type="submit"]') || { disabled:false };
    submitBtn.disabled = true;

    const usuarioInput = document.getElementById("usuario").value.trim();
    const password = document.getElementById("password").value;

    if (!usuarioInput || !password) {
      Swal.fire({
        icon: 'warning',
        title: 'Campos vacíos',
        text: 'Debe ingresar usuario y contraseña.'
      });
      submitBtn.disabled = false;
      return;
    }

    // Helper to perform sign-in by email
    async function signInByEmail(email, password) {
      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        // refresh token to ensure Firestore requests include auth
        await user.getIdToken(true);

        Swal.fire({
          icon: 'success',
          title: '¡Bienvenido!',
          text: 'Redirigiendo a la oficina virtual...',
          showConfirmButton: false,
          timer: 1200
        }).then(() => {
          window.location.href = "/oficina-virtual/index.html";
        });
      } catch (err) {
        console.error("Error en signInByEmail:", err);
        throw err;
      }
    }

    try {
      // Si el input contiene @ asumimos que el usuario ingresó su email
      if (usuarioInput.includes("@")) {
        await signInByEmail(usuarioInput, password);
        submitBtn.disabled = false;
        return;
      }

      // Intentar resolver username -> email consultando collection 'usuarios'
      const usuariosRef = collection(db, "usuarios");
      const q = query(usuariosRef, where("usuario", "==", usuarioInput));

      let querySnapshot;
      try {
        querySnapshot = await getDocs(q);
      } catch (fireErr) {
        console.error("Error al consultar usuarios por username:", fireErr);
        // Si la causa es permisos, ofrezco al usuario usar su email o contactar soporte
        const isPerm = fireErr && (fireErr.code === 'permission-denied' || /permission/i.test(fireErr.message));
        if (isPerm) {
          Swal.fire({
            icon: 'error',
            title: 'No fue posible iniciar sesión',
            html: `No se pudo verificar el nombre de usuario debido a permisos de seguridad. <br>
                   Por favor inicia sesión usando tu <b>correo electrónico</b> o contacta soporte.`,
            confirmButtonText: 'Entendido'
          });
          submitBtn.disabled = false;
          return;
        }
        // otros errores
        throw fireErr;
      }

      if (!querySnapshot || querySnapshot.empty) {
        Swal.fire({
          icon: 'error',
          title: 'Usuario no encontrado',
          text: 'Verifica el nombre de usuario.'
        });
        submitBtn.disabled = false;
        return;
      }

      // Obtener email del primer resultado (asumimos nombres de usuario únicos)
      const userDoc = querySnapshot.docs[0];
      const email = userDoc.data().email;

      if (!email) {
        Swal.fire({
          icon: 'error',
          title: 'Usuario sin email',
          text: 'El registro del usuario no contiene un correo válido. Contacta soporte.'
        });
        submitBtn.disabled = false;
        return;
      }

      // Ahora iniciar sesión con el email encontrado
      await signInByEmail(email, password);

    } catch (error) {
      console.error("Error en login:", error);
      // Mostrar mensajes amigables según el tipo de error
      let msg = error.message || "Error al iniciar sesión.";
      // FirebaseAuth error codes handling
      if (error.code === "auth/wrong-password") {
        msg = "Contraseña incorrecta.";
      } else if (error.code === "auth/user-not-found") {
        msg = "Usuario no encontrado o correo no registrado.";
      } else if (error.code === "auth/too-many-requests") {
        msg = "Demasiados intentos. Intenta más tarde.";
      } else if (error.code === "permission-denied") {
        msg = "Permisos insuficientes al consultar usuario. Contacta soporte.";
      }

      Swal.fire({
        icon: 'error',
        title: 'Error al iniciar sesión',
        text: msg
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}
