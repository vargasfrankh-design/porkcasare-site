document.addEventListener('DOMContentLoaded', () => {
  const userData = {
    name: 'Juan Pérez',
    email: 'juan.perez@email.com',
    code: 'ABC123',
    points: 1200,
    history: [
      { action: 'Recompra realizada', date: '2025-09-15', amount: '$60.000' },
      { action: 'Nuevo referido registrado', date: '2025-09-12' },
      { action: 'Bono de bienvenida', date: '2025-09-10' }
    ],
    red: [
      'Carlos López',
      'María Gómez',
      'Pedro Sánchez'
    ]
  };

  // Cargar desde localStorage si existe
  const savedPoints = localStorage.getItem('points');
  const savedHistory = JSON.parse(localStorage.getItem('history'));

  if (savedPoints) userData.points = parseInt(savedPoints);
  if (savedHistory) userData.history = savedHistory;

  // Mostrar datos
  document.getElementById('name').textContent = userData.name;
  document.getElementById('email').textContent = userData.email;
  document.getElementById('code').textContent = userData.code;
  document.getElementById('points').textContent = userData.points;
  document.getElementById('refCode').value = `${window.location.origin}/registro?ref=${userData.code}`;

  // Historial
  const historyContainer = document.getElementById('history');
  const renderHistory = () => {
    historyContainer.innerHTML = '';
    userData.history.forEach(entry => {
      const div = document.createElement('div');
      div.classList.add('entry');
      div.textContent = `${entry.date} - ${entry.action}${entry.amount ? ` (${entry.amount})` : ''}`;
      historyContainer.appendChild(div);
    });
  };
  renderHistory();

  // Red de referidos
  const redList = document.getElementById('redReferidos');
  userData.red.forEach(nombre => {
    const li = document.createElement('li');
    li.textContent = nombre;
    redList.appendChild(li);
  });

  // Copiar código
  const btnCopy = document.getElementById('copyRef');
  btnCopy.addEventListener('click', () => {
    const input = document.getElementById('refCode');
    input.select();
    input.setSelectionRange(0, 99999);
    document.execCommand('copy');
    btnCopy.textContent = '¡Copiado!';
    setTimeout(() => (btnCopy.textContent = 'Copiar'), 2000);
  });

  // Recompra
  const btnRecompra = document.getElementById('btnRecompra');
  btnRecompra.addEventListener('click', () => {
    const fecha = new Date().toISOString().split('T')[0];
    userData.points += 100;
    const newEntry = {
      action: 'Recompra realizada',
      date: fecha,
      amount: '$60.000'
    };
    userData.history.unshift(newEntry);
    localStorage.setItem('points', userData.points);
    localStorage.setItem('history', JSON.stringify(userData.history));

    document.getElementById('points').textContent = userData.points;
    renderHistory();
    alert('¡Recompra realizada y puntos actualizados!');
  });

  // Modo oscuro
  const toggleDarkMode = document.getElementById('toggleDarkMode');
  toggleDarkMode.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });

  // Cargar modo oscuro si está activado
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
  }
});
