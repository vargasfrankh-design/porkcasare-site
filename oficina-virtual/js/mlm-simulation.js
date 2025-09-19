// Oficina Virtual/js/mlm-simulation.js
// Script no invasivo: solo renderiza dentro de #simulacion si existe.
// Basado en las reglas: 15 kg = 50 pts, bono inicio 30% al patrocinador, recompra 10 pts, valor punto 3.800, comisiones 5 niveles.

const MLM = (() => {
  // Parámetros (ajústalos aquí)
  const VALOR_PUNTO = 3800;
  const PUNTOS_MEMBRESIA = 50; // 15 kg -> 50 pts
  const BONO_INICIO_PORC = 0.30; // 30% al patrocinador directo
  const RECOMPRA_PUNTOS = 10; // 10 pts
  const RECOMPRA_VALOR = 60000; // $60.000 por recompra mensual
  const PORCENTAJE_RECOMPRA_NIVELES = [0.05, 0.03, 0.02, 0.01, 0.005]; // niveles 1..5

  const ESCENARIOS_DEFAULT = [10, 100, 1000];

  function format(n) {
    return Number(n).toLocaleString('es-CO');
  }

  function calcEscenario(n) {
    // Bono de inicio por persona (se paga una vez al patrocinador directo)
    const bonoInicioPorPersona = PUNTOS_MEMBRESIA * BONO_INICIO_PORC * VALOR_PUNTO;
    const bonoInicioTotal = bonoInicioPorPersona * n;

    // Recompra: ingreso por recompra (n personas que hacen la recompra)
    const ingresoRecompra = n * RECOMPRA_VALOR;

    // Valor total de los puntos generados por recompra (puntos * valor punto * personas)
    const valorPuntosRecompra = RECOMPRA_PUNTOS * VALOR_PUNTO * n;

    // Comisiones totales de recompra por todos los niveles
    const comisionesRecompra = PORCENTAJE_RECOMPRA_NIVELES
      .reduce((acc, p) => acc + (p * valorPuntosRecompra), 0);

    const margenRecompra = ingresoRecompra - comisionesRecompra;

    return {
      personas: n,
      bonoInicioTotal,
      ingresoRecompra,
      valorPuntosRecompra,
      comisionesRecompra,
      margenRecompra
    };
  }

  function render(escenarios = ESCENARIOS_DEFAULT) {
    const container = document.getElementById('simulacion');
    if (!container) return; // si no existe, no hago nada

    let html = `
      <div class="mlm-card">
        <p><strong>Bono Inicio Rápido:</strong> 30% al patrocinador directo (se paga 1 vez al registro).</p>
        <p><strong>Recompra mensual:</strong> 10 pts = $${format(RECOMPRA_VALOR)} (la persona debe comprar para ser elegible a cobrar su bono de equipo).</p>

        <table class="mlm-table" role="table" aria-label="Simulación de bonos">
          <thead>
            <tr>
              <th>Escenario</th>
              <th>Personas</th>
              <th>Bono Inicio (total)</th>
              <th>Ingreso Recompra</th>
              <th>Valor Puntos Recompra</th>
              <th>Comisiones Recompra</th>
              <th>Margen Recompra</th>
            </tr>
          </thead>
          <tbody>
    `;

    escenarios.forEach(n => {
      const r = calcEscenario(n);
      html += `
        <tr>
          <td>${n === 10 ? 'Pequeño' : n === 100 ? 'Mediano' : 'Grande'}</td>
          <td>${r.personas}</td>
          <td>$${format(Math.round(r.bonoInicioTotal))}</td>
          <td>$${format(Math.round(r.ingresoRecompra))}</td>
          <td>$${format(Math.round(r.valorPuntosRecompra))}</td>
          <td>$${format(Math.round(r.comisionesRecompra))}</td>
          <td><strong>$${format(Math.round(r.margenRecompra))}</strong></td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;
  }

  // Auto-ejecutar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => render());
  } else {
    render();
  }

  return { render, calcEscenario };
})();

export default MLM;
