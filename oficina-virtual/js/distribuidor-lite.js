import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
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

      // Mostrar datos del usuario
      document.getElementById('name').textContent = `${userData.nombre} ${userData.apellido}`;
      document.getElementById('email').textContent = userData.email;
      document.getElementById('code').textContent = userData.usuario;
      document.getElementById('points').textContent = userData.puntos || 0;
      document.getElementById('refCode').value = `${window.location.origin}/registro?ref=${userData.usuario}`;

      // Simulación de historial y red si aún no existen
      userData.history = userData.history || [
        { action: 'Bono de bienvenida', date: '2025-09-10' }
      ];
      userData.red = userData.red || [];

      // Mostrar historial
      const historyContainer = document.getElementById('history');
      function renderHistory() {
        historyContainer.innerHTML = '';
        userData.history.forEach(entry => {
          const div = document.createElement('div');
          div.classList.add('entry');
          div.textContent = `${entry.date} - ${entry.action}${entry.amount ? ` (${entry.amount})` : ''}`;
          historyContainer.appendChild(div);
        });
      }
      renderHistory();

      // Mostrar red de referidos
      const redList = document.getElementById('redReferidos');
      redList.innerHTML = '';
      userData.red.forEach(nombre => {
        const li = document.createElement('li');
        li.textContent = nombre;
        redList.appendChild(li);
      });

      // Evento: Recompra
      const btnRecompra = document.getElementById('btnRecompra');
      btnRecompra.addEventListener('click', async () => {
        const fecha = new Date().toISOString().split('T')[0];
        const newPoints = (userData.puntos || 0) + 100;

        const newEntry = {
          action: 'Recompra realizada',
          date: fecha,
          amount: '$60.000'
        };

        userData.puntos = newPoints;
        userData.history.unshift(newEntry);

        await updateDoc(docRef, {
          puntos: newPoints,
          history: userData.history
        });

        document.getElementById('points').textContent = newPoints;
        renderHistory();
        alert('✅ Recompra realizada y puntos actualizados.');
      });

      // Copiar código referido
      const btnCopy = document.getElementById('copyRef');
      btnCopy.addEventListener('click', () => {
        const input = document.getElementById('refCode');
        input.select();
        input.setSelectionRange(0, 99999);
        document.execCommand('copy');
        btnCopy.textContent = '¡Copiado!';
        setTimeout(() => (btnCopy.textContent = 'Copiar'), 2000);
      });

      // Modo oscuro
      const toggleDarkMode = document.getElementById('toggleDarkMode');
      toggleDarkMode.addEventListener('click', () => {
        document.body.classList.toggle('dark');
        localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
      });

      if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
      }

    } catch (error) {
      console.error("🔥 Error al obtener datos del usuario:", error);
      alert("Error al cargar los datos. Intente más tarde.");
    }
  });
});

