// ✅ Importaciones al inicio
import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
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

      // --- Datos básicos ---
      document.getElementById('name').textContent = `${userData.nombre} ${userData.apellido}`;
      document.getElementById('email').textContent = userData.email;
      document.getElementById('code').textContent = userData.usuario;
      document.getElementById('points').textContent = userData.puntos || 0;
      document.getElementById('refCode').value = `${window.location.origin}/registro?ref=${userData.usuario}`;

      // --- Cerrar sesión ---
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          try {
            await signOut(auth);
            localStorage.removeItem('theme'); 
            localStorage.removeItem('selectedAvatar'); // limpiar avatar local
            window.location.href = "../index.html";
          } catch (error) {
            console.error("❌ Error al cerrar sesión:", error);
            alert("Error al cerrar sesión. Intenta de nuevo.");
          }
        });
      }

      // --- Avatar SOLO localStorage ---
      const profileImg = document.getElementById('profileImg');
      const avatarGrid = document.querySelector('.avatar-grid');
      const changeAvatarBtn = document.getElementById('changeAvatarBtn'); // botón que debes poner en tu HTML

      // Cargar avatar desde localStorage (o por defecto)
      const savedAvatar = localStorage.getItem('selectedAvatar');
      profileImg.src = savedAvatar || userData.fotoURL || "images/avatars/avatar1.png";

      // Seleccionar avatar
      document.querySelectorAll('.avatar-grid img').forEach(img => {
        img.addEventListener('click', () => {
          const selectedAvatar = `images/avatars/${img.dataset.avatar}`;
          profileImg.src = selectedAvatar;
          localStorage.setItem('selectedAvatar', selectedAvatar);

          // Ocultar grid y mostrar botón de cambio
          avatarGrid.style.display = "none";
          changeAvatarBtn.style.display = "inline-block";

          alert("✅ Avatar actualizado (guardado localmente).");
        });
      });

      // Mostrar selector al hacer clic en "Cambiar avatar"
      if (changeAvatarBtn) {
        changeAvatarBtn.addEventListener('click', () => {
          avatarGrid.style.display = "grid";
          changeAvatarBtn.style.display = "none";
        });
      }

      // Inicialmente ocultar grid si ya hay avatar
      if (savedAvatar) {
        avatarGrid.style.display = "none";
        changeAvatarBtn.style.display = "inline-block";
      } else {
        changeAvatarBtn.style.display = "none";
      }

      // --- Historial ---
      const historyContainer = document.getElementById('history');
      function renderHistory() {
        historyContainer.innerHTML = '';
        (userData.history || []).forEach(entry => {
          const div = document.createElement('div');
          div.classList.add('entry');
          div.textContent = `${entry.date} - ${entry.action}${entry.amount ? ` (${entry.amount})` : ''}`;
          historyContainer.appendChild(div);
        });
      }
      renderHistory();

      // --- Red ---
      const redList = document.getElementById('redReferidos');
      redList.innerHTML = '';
      (userData.red || []).forEach(nombre => {
        const li = document.createElement('li');
        li.textContent = nombre;
        redList.appendChild(li);
      });

      // --- Recompra ---
      document.getElementById('btnRecompra').addEventListener('click', async () => {
        const fecha = new Date().toISOString().split('T')[0];
        const newPoints = (userData.puntos || 0) + 100;

        const newEntry = {
          action: 'Recompra realizada',
          date: fecha,
          amount: '$60.000'
        };

        userData.puntos = newPoints;
        userData.history = [newEntry, ...(userData.history || [])];

        await updateDoc(docRef, {
          puntos: newPoints,
          history: userData.history
        });

        document.getElementById('points').textContent = newPoints;
        renderHistory();
        alert('✅ Recompra realizada y puntos actualizados.');
      });

      // --- Copiar código de referido ---
      const btnCopy = document.getElementById('copyRef');
      btnCopy.addEventListener('click', () => {
        const input = document.getElementById('refCode');
        input.select();
        input.setSelectionRange(0, 99999);
        document.execCommand('copy');
        btnCopy.textContent = '¡Copiado!';
        setTimeout(() => (btnCopy.textContent = 'Copiar'), 2000);
      });

      // --- Modo oscuro ---
      const toggleDarkMode = document.getElementById('toggleDarkMode');
      if (toggleDarkMode) {
        toggleDarkMode.addEventListener('click', () => {
          document.body.classList.toggle('dark');
          localStorage.setItem('theme',
            document.body.classList.contains('dark') ? 'dark' : 'light'
          );
        });

        if (localStorage.getItem('theme') === 'dark') {
          document.body.classList.add('dark');
        }
      }

    } catch (error) {
      console.error("🔥 Error al obtener datos del usuario:", error);
      alert("Error al cargar los datos. Intente más tarde.");
    }
  });
});

});
