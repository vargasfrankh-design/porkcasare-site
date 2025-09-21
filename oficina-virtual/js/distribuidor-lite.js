// oficina-virtual/js/distribuidor-lite.js
import { auth, db } from "/src/firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  arrayUnion
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

      // --- Datos del usuario ---
      document.getElementById("name").textContent = `${userData.nombre || ""} ${userData.apellido || ""}`;
      document.getElementById("email").textContent = userData.email || "";
      document.getElementById("code").textContent = userData.usuario || "";

      // Mostrar puntos personales y grupales
      const personalPoints = Number(userData.personalPoints || 0);
      const teamPoints = Number(userData.teamPoints || 0);
      document.getElementById("points").textContent = personalPoints;
      document.getElementById("teamPoints").textContent = teamPoints;

      // --- Generar link de referido ---
      const refInput = document.getElementById("refCode");
      const copyBtn = document.getElementById("copyRef");
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
            alert("Error al cerrar sesión. Intenta de nuevo.");
          }
        });
      }

      // --- Avatar desde Firestore ---
      const profileImg = document.getElementById("profileImg");
      const avatarGrid = document.querySelector(".avatar-grid");
      const changeAvatarBtn = document.getElementById("changeAvatarBtn");

      profileImg.onerror = function () {
        this.src = "/images/avatars/avatar1.png";
      };

      const avatarFromDB = userData.fotoURL;
      if (avatarFromDB) {
        profileImg.src = avatarFromDB.startsWith("http") ? avatarFromDB : `../${avatarFromDB}`;
      } else {
        profileImg.src = "../images/avatars/avatar1.png";
      }

      document.querySelectorAll(".avatar-grid img").forEach((imgEl) => {
        imgEl.addEventListener("click", async () => {
          const selectedAvatar = `images/avatars/${imgEl.dataset.avatar}`;
          try {
            await updateDoc(docRef, { fotoURL: selectedAvatar });
            profileImg.src = `../${selectedAvatar}`;
            localStorage.setItem("selectedAvatar", selectedAvatar);
            avatarGrid.style.display = "none";
            changeAvatarBtn.style.display = "inline-block";
            alert("✅ Avatar actualizado correctamente.");
          } catch (err) {
            console.error("❌ Error guardando avatar:", err);
            alert("Error al actualizar avatar.");
          }
        });
      });

      if (changeAvatarBtn) {
        if (avatarFromDB) {
          avatarGrid.style.display = "none";
          changeAvatarBtn.style.display = "inline-block";
        } else {
          changeAvatarBtn.style.display = "none";
        }
        changeAvatarBtn.addEventListener("click", () => {
          avatarGrid.style.display = "grid";
          changeAvatarBtn.style.display = "none";
        });
      }

      // --- Historial ---
      const historyContainer = document.getElementById("history");
      function renderHistory() {
        historyContainer.innerHTML = "";
        (userData.history || []).forEach((entry) => {
          const div = document.createElement("div");
          div.classList.add("entry");
          div.textContent = `${entry.date} - ${entry.action}${entry.amount ? ` (${entry.amount})` : ""}`;
          historyContainer.appendChild(div);
        });
      }
      renderHistory();

      // --- Red sencilla ---
      const redList = document.getElementById("redReferidos");
      if (redList) {
        redList.innerHTML = "";
        (userData.red || []).forEach((nombre) => {
          const li = document.createElement("li");
          li.textContent = nombre;
          redList.appendChild(li);
        });
      }

      // --- Activación: alerta si puntos personales < 50 ---
      const alertEl = document.getElementById("activationAlert");
      if (alertEl) {
        alertEl.style.display = personalPoints < 50 ? "block" : "none";
      }

      // --- Modo oscuro preferencia ---
      const toggleDarkMode = document.getElementById("toggleDarkMode");
      if (toggleDarkMode) {
        toggleDarkMode.addEventListener("click", () => {
          document.body.classList.toggle("dark");
          localStorage.setItem(
            "theme",
            document.body.classList.contains("dark") ? "dark" : "light"
          );
        });
        if (localStorage.getItem("theme") === "dark") {
          document.body.classList.add("dark");
        }
      }

      // --- Procesar bono inicial (v9) ---
      async function processInitialPack(userId, sponsorId) {
        const userRef = doc(db, "usuarios", userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) return;

        const userData = userSnap.data();

        if (!userData.initialPackBought) {
          // Marcar compra inicial
          await updateDoc(userRef, { initialPackBought: true });

          // Bono único al patrocinador
          if (sponsorId) {
            const sponsorRef = doc(db, "usuarios", sponsorId);
            const sponsorSnap = await getDoc(sponsorRef);

            if (sponsorSnap.exists()) {
              const sponsorData = sponsorSnap.data();

              const bonusPoints = 15;
              const bonusPesos = bonusPoints * 3800;

              await updateDoc(sponsorRef, {
                puntos: (sponsorData.puntos || 0) + bonusPoints,
                bonusHistory: arrayUnion({
                  type: "Bono inicial",
                  points: bonusPoints,
                  amount: bonusPesos,
                  date: new Date().toISOString(),
                  fromUser: userId
                })
              });
            }
          }
        }
      }

      // --- Calcular puntos de equipo hasta 6 niveles ---
      async function calculateTeamPoints(userId) {
        let totalTeamPoints = 0;
        let currentLevel = [];

        // arranca desde los directos (nivel 1)
        const q = query(collection(db, "usuarios"), where("sponsorId", "==", userId));
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          totalTeamPoints += d.personalPoints || 0;
          currentLevel.push(docSnap.id);
        });

        // recorre niveles 2 a 6
        for (let level = 2; level <= 6; level++) {
          const nextLevel = [];
          for (const uid of currentLevel) {
            const q = query(collection(db, "usuarios"), where("sponsorId", "==", uid));
            const snap = await getDocs(q);
            snap.forEach((docSnap) => {
              const d = docSnap.data();
              totalTeamPoints += d.personalPoints || 0;
              nextLevel.push(docSnap.id);
            });
          }
          currentLevel = nextLevel;
        }

        const userRef = doc(db, "usuarios", userId);
        await updateDoc(userRef, { teamPoints: totalTeamPoints });
        document.getElementById("teamPoints").textContent = totalTeamPoints;
      }

      // 🔥 Ejecutar cálculo de puntos grupales al cargar
      await calculateTeamPoints(user.uid);

    } catch (error) {
      console.error("🔥 Error al obtener datos del usuario:", error);
      alert("Error al cargar los datos. Intente más tarde.");
    }
  });
});
