import { auth, db } from "/src/firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/distribuidor-login.html";
      return;
    }

    try {
      const docRef = doc(db, "usuarios", user.uid);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        alert("No se encontraron datos del usuario.");
        return;
      }

      const userData = docSnap.data();

      // Mostrar datos básicos
      const nombreEl = document.getElementById("nombre");
      const usuarioEl = document.getElementById("usuario");
      const emailEl = document.getElementById("email");
      const profileImg = document.getElementById("profileImg");
      const refInput = document.getElementById("refLink");
      const copyBtn = document.getElementById("copyRef");

      if (nombreEl) nombreEl.textContent = userData.nombre || userData.usuario;
      if (usuarioEl) usuarioEl.textContent = userData.usuario;
      if (emailEl) emailEl.textContent = user.email || userData.email || "";
      if (profileImg) {
        if (userData.fotoURL) profileImg.src = `../${userData.fotoURL}`;
        else profileImg.src = `../images/avatars/avatar_${(Math.floor(Math.random()*6)+1)}.png`;
      }

      if (refInput && copyBtn && userData.usuario) {
        const link = `${window.location.origin}/register.html?patrocinador=${encodeURIComponent(userData.usuario)}`;
        refInput.value = link;

        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(link);
            copyBtn.textContent = "¡Copiado!";
            setTimeout(() => (copyBtn.textContent = "Copiar"), 1500);
          } catch (err) {
            refInput.select();
            document.execCommand("copy");
            copyBtn.textContent = "¡Copiado!";
            setTimeout(() => (copyBtn.textContent = "Copiar"), 1500);
          }
        });
      }

      // --- Botón Cerrar sesión ---
      const logoutBtn = document.getElementById("logoutBtn");
      if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
          try {
            await signOut(auth);
            localStorage.removeItem("theme");
            localStorage.removeItem("selectedAvatar");
            window.location.href = "../index.html";
          } catch (error) {
            console.error("❌ Error al cerrar sesión:", error);
            alert("Error cerrando sesión.");
          }
        });
      }

      // --- Avatares ---
      const changeAvatarBtn = document.getElementById("changeAvatarBtn");
      const avatarGrid = document.getElementById("avatarGrid");
      const avatarImgs = document.querySelectorAll(".avatar-img");

      const avatarFromDB = userData.fotoURL;
      if (avatarImgs) {
        avatarImgs.forEach(imgEl => {
          imgEl.addEventListener("click", async () => {
            const selectedAvatar = `images/avatars/${imgEl.dataset.avatar}`;
            try {
              await updateDoc(docRef, { fotoURL: selectedAvatar });
              if (profileImg) profileImg.src = `../${selectedAvatar}`;
              localStorage.setItem("selectedAvatar", selectedAvatar);
              if (avatarGrid) avatarGrid.style.display = "none";
              if (changeAvatarBtn) changeAvatarBtn.style.display = "inline-block";
              alert("✅ Avatar actualizado correctamente.");
            } catch (err) {
              console.error("❌ Error guardando avatar:", err);
              alert("Error al actualizar avatar.");
            }
          });
        });
      }

      if (changeAvatarBtn) {
        if (avatarFromDB) {
          if (avatarGrid) avatarGrid.style.display = "none";
          changeAvatarBtn.style.display = "inline-block";
        } else {
          changeAvatarBtn.style.display = "none";
        }
        changeAvatarBtn.addEventListener("click", () => {
          if (avatarGrid) avatarGrid.style.display = "grid";
          changeAvatarBtn.style.display = "none";
        });
      }

      // --- Historial ---
      const historyWrap = document.getElementById("historyWrap");
      if (historyWrap) {
        const history = userData.history || [];
        historyWrap.innerHTML = "";
        history.slice().reverse().forEach(h => {
          const li = document.createElement("div");
          li.className = "hist-item";
          li.innerHTML = `<div class="hist-action">${h.action || ""}</div>
                          <div class="hist-info">${h.points ? h.points + " pts" : ""} ${h.amount ? "$" + h.amount : ""}</div>
                          <div class="hist-date">${h.date ? new Date(h.date).toLocaleString() : ""}</div>`;
          historyWrap.appendChild(li);
        });
      }

      // --- Mostrar puntos actuales (puntos personales) ---
      const puntosEl = document.getElementById("misPuntos");
      if (puntosEl) puntosEl.textContent = userData.puntos || 0;

      // --- Mostrar teamPoints (si está disponible) ---
      const teamEl = document.getElementById("teamPoints");
      if (teamEl) teamEl.textContent = userData.teamPoints || 0;

      // ----------------------------------------------
      // Ejemplo de asignación de bono inicial que usaba lectura y escritura no atómica:
      // Reemplazado por uso de increment() para evitar condiciones de carrera.
      // ----------------------------------------------
      async function giveInitialBonusIfApplies(sponsorId, userId) {
        try {
          if (!sponsorId) return;

          const sponsorRef = doc(db, "usuarios", sponsorId);
          const sponsorSnap = await getDoc(sponsorRef);
          if (!sponsorSnap.exists()) return;

          // Ejemplo de bono:
          const bonusPoints = 15;
          const bonusPesos = bonusPoints * 3800;

          // IMPORTANTE: usamos increment() para sumar de forma atómica
          await updateDoc(sponsorRef, {
            puntos: increment(bonusPoints),
            bonusHistory: arrayUnion({
              type: "Bono inicial",
              points: bonusPoints,
              amount: bonusPesos,
              date: new Date().toISOString(),
              fromUser: userId
            })
          });
        } catch (err) {
          console.error("🔥 Error asignando bono inicial:", err);
        }
      }

      // ... El resto del código del dashboard permanece igual ...

    } catch (error) {
      console.error("🔥 Error al obtener datos del usuario:", error);
      alert("Error al cargar los datos. Intente más tarde.");
    }
  });
});

// --- Escuchar evento personalizado para mostrar alerta de activación ---
document.addEventListener("personalPointsReady", (e) => {
  const personalPoints = e.detail.personalPoints;
  const alertEl = document.getElementById("activationAlert");
  if (alertEl) {
    alertEl.style.display = (personalPoints < 50) ? "block" : "none";
  }
});

// -------------------- DARK MODE --------------------
const toggleDarkMode = document.getElementById("toggleDarkMode");
if (toggleDarkMode) {
  toggleDarkMode.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
}
