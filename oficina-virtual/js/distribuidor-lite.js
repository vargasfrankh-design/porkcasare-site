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


// --- helper: normalize avatar path ---
function resolveAvatarPath(p) {
  if (!p) return '/images/avatars/default-avatar.png';
  if (/^https?:\/\//.test(p)) return p;
  p = String(p).trim();
  if (p.startsWith('/')) return p;
  p = p.replace(/^(\.\.\/)+/, '');
  return '/' + p.replace(/^\/+/, '');
}
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
      // Exponer tipo de registro globalmente para otros scripts
<<<<<<< HEAD
      const userRole = userData.role || userData.tipoRegistro || userData.rol || 'distribuidor';
      window.currentTipoRegistro = userRole.toString().toLowerCase();
      window.currentUserRole = userRole.toString().toLowerCase();
=======
window.currentTipoRegistro = (userData.tipoRegistro || userData.rol || 'distribuidor').toString().toLowerCase();
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe

      

      // Disparar personalPointsReady para garantizar que otros scripts (productos, alerta) reaccionen
      const _personalPoints = Number(userData.personalPoints ?? userData.puntos ?? userData.groupPoints ?? 0);
      document.dispatchEvent(new CustomEvent('personalPointsReady', { detail: { personalPoints: _personalPoints } }));
<<<<<<< HEAD
      
      // Disparar pointsReady para la barra de progreso con puntos grupales
      const _groupPoints = Number(userData.groupPoints ?? userData.teamPoints ?? 0);
      document.dispatchEvent(new CustomEvent('pointsReady', { 
        detail: { 
          personalPoints: _personalPoints,
          groupPoints: _groupPoints 
        } 
      }));
=======
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
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
              if (profileImg) profileImg.src = resolveAvatarPath(selectedAvatar);
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
<<<<<<< HEAD
    
    // Helper para detectar y resaltar nombres en el texto
    function highlightUserName(text) {
      if (!text || typeof text !== 'string') return text || '';
      
      // Patrones comunes para extraer nombres de usuario
      const patterns = [
        /por compra de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i,
        /Por ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/,
        /de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i,
        /Comisión por compra \(nivel \d+\) de ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/i
      ];
      
      for (const pat of patterns) {
        const m = text.match(pat);
        if (m && m[1]) {
          return text.replace(m[1], `<span class="bold-name">${m[1]}</span>`);
        }
      }
      
      // Fallback: resaltar primera secuencia de palabras capitalizadas
      const cap = text.match(/([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ]+)*)/);
      if (cap && cap[1]) {
        return text.replace(cap[1], `<span class="bold-name">${cap[1]}</span>`);
      }
      return text;
    }
    
    // Función para determinar si es un ingreso (comisión, bono, etc.)
    function isIncome(historyItem) {
      const actionTxt = (historyItem?.action || historyItem?.tipo || '').toLowerCase();
      const incomeKeywords = ['comisión', 'comision', 'bono', 'ingreso', 'cobro', 'ganancia', 'compra'];
      return incomeKeywords.some(keyword => actionTxt.includes(keyword));
    }
    
    history.forEach(h => {
      const li = document.createElement("div");
      const isIncomeEntry = isIncome(h);
      li.className = isIncomeEntry ? "hist-item income" : "hist-item";

      const actionTxt  = h?.action || h?.tipo || "";
      const highlightedAction = highlightUserName(actionTxt);
=======
    history.forEach(h => {
      const li = document.createElement("div");
      li.className = "hist-item";

      const actionTxt  = h?.action || h?.tipo || "";
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
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
<<<<<<< HEAD
            <div class="hist-action">${highlightedAction}</div>
=======
            <div class="hist-action">${escapeHtml(actionTxt)}</div>
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
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
<<<<<<< HEAD
      const pointsEl = document.getElementById("points");
      const personalPointsValue = Number(userData.personalPoints ?? userData.puntos ?? 0);
      if (puntosEl) puntosEl.textContent = String(personalPointsValue);
      if (pointsEl) pointsEl.textContent = String(personalPointsValue);

      // --- Mostrar teamPoints (si está disponible) ---
      const teamEl = document.getElementById("teamPoints");
      const groupPointsValue = Number(userData.groupPoints ?? userData.teamPoints ?? 0);
      if (teamEl) {
        teamEl.textContent = String(groupPointsValue);
=======
      const personalPointsValue = Number(userData.personalPoints ?? userData.puntos ?? 0);
      if (puntosEl) puntosEl.textContent = String(personalPointsValue);

      // --- Mostrar teamPoints (si está disponible) ---
      const teamEl = document.getElementById("teamPoints");
      if (teamEl) {
        teamEl.textContent = (typeof userData.teamPoints === "number") ? String(userData.teamPoints) : "-";
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
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
<<<<<<< HEAD
            const q = query(collection(db, "usuarios"), where("usuario", "==", sponsorIdentifier), where("rol", "!=", "deleted"));
=======
            const q = query(collection(db, "usuarios"), where("usuario", "==", sponsorIdentifier), where("role", "!=", "deleted"));
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
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

document.addEventListener("personalPointsReady", (e) => {
  const personalPoints = Number(e.detail.personalPoints ?? 0);
  const tipo = (window.currentTipoRegistro || 'distribuidor').toString().toLowerCase();
  const threshold = (tipo === 'cliente') ? 70 : 50;
  const alertEl = document.getElementById("activationAlert");
  if (alertEl) {
    if (personalPoints < threshold) {
      const faltan = threshold - personalPoints;
      if (tipo === 'cliente') {
        alertEl.innerHTML = `⚠️ Te faltan ${faltan} puntos. Debes comprar o acumular ${threshold} puntos para pasarte a distribuidor y activar el plan de compensación.`;
      } else {
        alertEl.innerHTML = `⚠️ Te faltan ${faltan} puntos. Debes realizar una compra mínima de ${threshold} puntos para activar tu código y comenzar a recibir bonos y pagos.`;
      }
      alertEl.style.display = "block";
    } else {
      alertEl.style.display = "none";
    }
  }
});

<<<<<<< HEAD
=======
// -------------------- DARK MODE --------------------
const toggleDarkMode = document.getElementById("toggleDarkMode");
if (toggleDarkMode) {
  toggleDarkMode.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
}

>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
/* -------------------- UTILIDADES LOCALES -------------------- */

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
