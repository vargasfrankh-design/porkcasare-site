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
  increment,
  collection,
  query,
  where,
  getDocs
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

      if (nombreEl) nombreEl.textContent = userData.nombre || userData.usuario || "";
      if (usuarioEl) usuarioEl.textContent = userData.usuario || "";
      if (emailEl) emailEl.textContent = user.email || userData.email || "";
      if (profileImg) {
        if (userData.fotoURL) profileImg.src = userData.fotoURL.startsWith("http") ? userData.fotoURL : `../${userData.fotoURL}`;
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
            // Fallback
            try {
              refInput.select();
              document.execCommand("copy");
              copyBtn.textContent = "¡Copiado!";
              setTimeout(() => (copyBtn.textContent = "Copiar"), 1500);
            } catch (err2) {
              console.error("Error copiando al portapapeles:", err, err2);
              alert("No se pudo copiar el enlace automáticamente. Seleccione y copie manualmente.");
            }
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
      if (avatarImgs && avatarImgs.length) {
        avatarImgs.forEach(imgEl => {
          imgEl.addEventListener("click", async () => {
            // prevenir doble-clicks múltiples
            imgEl.disabled = true;
            const selectedAvatar = `images/avatars/${imgEl.dataset.avatar}`;
            try {
              // solo escribir si cambió realmente
              if (userData.fotoURL !== selectedAvatar) {
                await updateDoc(docRef, { fotoURL: selectedAvatar });
              }
              if (profileImg) profileImg.src = `../${selectedAvatar}`;
              localStorage.setItem("selectedAvatar", selectedAvatar);
              if (avatarGrid) avatarGrid.style.display = "none";
              if (changeAvatarBtn) changeAvatarBtn.style.display = "inline-block";
              alert("✅ Avatar actualizado correctamente.");
            } catch (err) {
              console.error("❌ Error guardando avatar:", err);
              alert("Error al actualizar avatar.");
            } finally {
              imgEl.disabled = false;
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
let historyWrap = document.getElementById("historyWrap")
               || document.getElementById("history")
               || document.querySelector(".historyWrap")
               || document.querySelector(".history-list");

// crear contenedor si no existe
if (!historyWrap) {
  const userInfo = document.querySelector('.user-info') || document.querySelector('.container') || document.body;
  if (userInfo) {
    historyWrap = document.createElement('div');
    historyWrap.id = 'historyWrap';
    historyWrap.className = 'history-wrap';
    const hTitle = document.createElement('h3');
    hTitle.textContent = 'Historial';
    historyWrap.appendChild(hTitle);
    userInfo.appendChild(historyWrap);
  }
}

if (historyWrap) {
  // compatibilidad con diferentes nombres
  const rawHistory = Array.isArray(userData?.history) ? userData.history
                    : (Array.isArray(userData?.historial) ? userData.historial : []);
  // clonar y ordenar por fecha descendente (más reciente primero)
  const history = rawHistory.slice().sort((a, b) => {
    const ta = new Date(a?.date || a?.fecha || a?.createdAt || 0).getTime() || 0;
    const tb = new Date(b?.date || b?.fecha || b?.createdAt || 0).getTime() || 0;
    return tb - ta;
  });

  historyWrap.innerHTML = "";

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hist-empty';
    empty.textContent = 'No hay registros.';
    historyWrap.appendChild(empty);
  } else {
    // formateadores (miles y fecha)
    const fmtNumber = new Intl.NumberFormat('es-CO');
    history.forEach(h => {
      const li = document.createElement("div");
      li.className = "hist-item";

      const actionTxt  = h?.action || h?.tipo || "";
      const pointsVal  = (h?.points ?? h?.puntos ?? null);
      const pointsTxt  = (pointsVal !== null && pointsVal !== undefined) ? (`${pointsVal} pts`) : "";
      const amountVal  = (h?.amount ?? h?.monto ?? null);
      const amountTxt  = (amountVal !== null && amountVal !== undefined) ? (`$${fmtNumber.format(Number(amountVal))}`) : "";
      const dateVal    = h?.date || h?.fecha || h?.createdAt || null;
      const dateTxt    = dateVal ? new Date(dateVal).toLocaleString() : "";
      const orderId    = h?.orderId || h?.orderID || h?.id || "";

      li.innerHTML = `
        <div class="hist-row">
          <div class="hist-left">
            <div class="hist-action">${escapeHtml(actionTxt)}</div>
            <div class="hist-info">${escapeHtml(pointsTxt)} ${escapeHtml(amountTxt)}</div>
          </div>
          <div class="hist-right">
            <div class="hist-date">${escapeHtml(dateTxt)}</div>
            ${ orderId ? `<div class="hist-orderid">ID: ${escapeHtml(orderId)}</div>` : "" }
          </div>
        </div>
      `;

      historyWrap.appendChild(li);
    });
  }
} else {
  console.warn('No se encontró (ni se pudo crear) el elemento historyWrap para renderizar el historial.');
}


      // --- Mostrar puntos actuales (puntos personales) ---
      // Preferir personalPoints si existe, fallback a puntos (compatibilidad)
      const puntosEl = document.getElementById("misPuntos");
      const personalPointsValue = Number(userData.personalPoints ?? userData.puntos ?? 0);
      if (puntosEl) puntosEl.textContent = String(personalPointsValue);

      // --- Mostrar teamPoints (si está disponible) ---
      const teamEl = document.getElementById("teamPoints");
      if (teamEl) {
        teamEl.textContent = (typeof userData.teamPoints === "number") ? String(userData.teamPoints) : "-";
      }

      // ----------------------------------------------
      // Ejemplo de asignación de bono inicial que usaba lectura y escritura no atómica:
      // Reemplazado por uso de increment() para evitar condiciones de carrera.
      // NOTA: esta función NO se ejecuta automáticamente aquí; debe invocarse explícitamente desde lógica admin o endpoint.
      // ----------------------------------------------
      async function giveInitialBonusIfApplies(sponsorIdentifier, userId) {
        try {
          if (!sponsorIdentifier) return;

          // sponsorIdentifier puede ser doc.id o username; intentamos resolver a doc.id si parece username
          let sponsorId = sponsorIdentifier;
          // heurística: si sponsorIdentifier no tiene longitud típica de UID, buscar por username
          if (typeof sponsorIdentifier === "string" && sponsorIdentifier.length < 30) {
            // intentar buscar por usuario (username)
            const q = query(collection(db, "usuarios"), where("usuario", "==", sponsorIdentifier), where("role", "!=", "deleted"));
            const res = await getDocs(q);
            if (!res.empty) sponsorId = res.docs[0].id;
          }

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
  const personalPoints = Number(e.detail.personalPoints ?? 0);
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

/* -------------------- UTILIDADES LOCALES -------------------- */

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
