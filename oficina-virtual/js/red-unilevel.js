/* -------------- oficina-virtual/js/red-unilevel.js -------------- */
/* Archivo actualizado y unificado */

import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  runTransaction
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
const DEPTH_LIMIT = 6;

// navegación de redes (stack para volver)
let NAV_STACK = [];
let CURRENT_ROOT = null;

const FIELD_USUARIO = "usuario";
const FIELD_HISTORY = "history";
const FIELD_PATROCINADOR_ID = "patrocinadorId";

/* -------------------- UTILIDADES -------------------- */

function isActiveThisMonth(uData) {
  const hist = uData?.[FIELD_HISTORY];
  if (!Array.isArray(hist)) return !!uData?.active;
  const now = new Date();
  for (const e of hist) {
    if (!e) continue;
    const dateRaw = e.date || e.fechaCompra || e.fecha_recompra || e.createdAt || e.fecha;
    const d = dateRaw ? (typeof dateRaw.toDate === "function" ? dateRaw.toDate() : new Date(dateRaw)) : null;
    const action = (e.action || "").toLowerCase();
    if (d && /compra|recompra|confirm/i.test(action)) {
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return true;
    }
  }
  return !!uData?.active;
}

function clearElement(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

/* -------------------- CONSULTA DE HIJOS -------------------- */

async function getChildrenForParent(node) {
  const usuariosCol = collection(db, "usuarios");
  // 1) intentar por patrocinadorId (doc id)
  let q = query(usuariosCol, where(FIELD_PATROCINADOR_ID, "==", node.id));
  let snap = await getDocs(q);
  if (!snap.empty) return snap.docs;
  // 2) fallback por 'patrocinador' (username)
  if (node.usuario) {
    q = query(usuariosCol, where("patrocinador", "==", node.usuario));
    snap = await getDocs(q);
    if (!snap.empty) return snap.docs;
  }
  return [];
}

/* -------------------- CONSTRUCCIÓN DEL ÁRBOL -------------------- */

async function buildUnilevelTree(username) {
  const usuariosCol = collection(db, "usuarios");
  const qRoot = query(usuariosCol, where(FIELD_USUARIO, "==", username));
  const snapRoot = await getDocs(qRoot);
  if (snapRoot.empty) return null;
  const rootDoc = snapRoot.docs[0];
  const rootData = rootDoc.data();

  const rootNode = {
    id: rootDoc.id,
    usuario: rootData[FIELD_USUARIO],
    nombre: rootData.nombre || rootData[FIELD_USUARIO],
    active: isActiveThisMonth(rootData),
    puntos: Number(rootData.puntos || rootData.personalPoints || 0),
    teamPoints: Number(rootData.teamPoints || 0),
    children: []
  };

  async function addChildren(node, level = 1) {
    if (level > DEPTH_LIMIT) return;
    const childDocs = await getChildrenForParent(node);
    node.children = childDocs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        usuario: data[FIELD_USUARIO] || data.usuario,
        nombre: data.nombre || data[FIELD_USUARIO] || data.usuario,
        active: isActiveThisMonth(data),
        puntos: Number(data.puntos || data.personalPoints || 0),
        teamPoints: Number(data.teamPoints || 0),
        children: []
      };
    });
    for (const c of node.children) await addChildren(c, level + 1);
  }

  await addChildren(rootNode, 1);
  return rootNode;
}

/* -------------------- PUNTOS -------------------- */

function calculatePersonalPoints(history) {
  let personalPoints = 0;
  (history || []).forEach(e => {
    if (e?.action?.startsWith("Compra confirmada"))
      personalPoints += Number(e.points || 0);
  });
  return personalPoints;
}

async function calculateTeamPoints(userId) {
  let total = 0;
  const queue = [userId];
  const visited = new Set();
  const usuariosCol = collection(db, "usuarios");
  while (queue.length) {
    const uid = queue.shift();
    if (visited.has(uid)) continue;
    visited.add(uid);

    const q = query(usuariosCol, where(FIELD_PATROCINADOR_ID, "==", uid));
    const snap = await getDocs(q);

    if (snap.empty) {
      try {
        const parentSnap = await getDoc(doc(db, "usuarios", uid));
        if (parentSnap.exists()) {
          const username = parentSnap.data()?.usuario;
          if (username) {
            const q2 = query(usuariosCol, where("patrocinador", "==", username));
            const snap2 = await getDocs(q2);
            snap2.forEach(ds => {
              total += Number(ds.data().puntos || ds.data().personalPoints || 0);
              queue.push(ds.id);
            });
            continue;
          }
        }
      } catch (err) { console.warn("Fallback patrocinador error:", err); }
    }

    snap.forEach(ds => {
      total += Number(ds.data().puntos || ds.data().personalPoints || 0);
      queue.push(ds.id);
    });
  }
  return total;
}

async function persistTeamPointsSafely(userId) {
  const userRef = doc(db, "usuarios", userId);
  try {
    const total = await calculateTeamPoints(userId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error("Usuario no encontrado");
      tx.update(userRef, { teamPoints: total });
    });
    return { ok: true, total };
  } catch (err) {
    console.error("persistTeamPointsSafely:", err);
    return { ok: false, error: err.message || err };
  }
}

/* -------------------- RENDER DEL ÁRBOL (D3 + viewBox + iOS repaint hack) -------------------- */

/**
 * renderTree(rootNode)
 * - Usa d3.hierarchy + d3.tree para layout.
 * - Crea svg con viewBox para mejor compatibilidad móvil.
 * - Forza repintado en iOS Safari para evitar canvas en blanco.
 *
 * Nota: requiere que D3 esté disponible globalmente (en tu index tienes <script src="https://d3js.org/d3.v7.min.js"></script>)
 */
function renderTree(rootNode) {
  const treeWrap = document.getElementById("treeWrap");
  clearElement(treeWrap);
  if (!rootNode) return;
  // crear/actualizar breadcrumbs y botón volver
  CURRENT_ROOT = rootNode.usuario || (rootNode.data && rootNode.data.usuario) || null;
  if (typeof window._refreshNetworkBreadcrumbs === 'function') window._refreshNetworkBreadcrumbs();
  let bc = document.getElementById("network-breadcrumbs");
  if (!bc) {
    bc = document.createElement("div");
    bc.id = "network-breadcrumbs";
    bc.style.position = "absolute";
    bc.style.left = "12px";
    bc.style.top = "12px";
    bc.style.zIndex = 9998;
    bc.style.background = "rgba(255,255,255,0.9)";
    bc.style.padding = "6px 10px";
    bc.style.borderRadius = "8px";
    bc.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
    bc.style.fontSize = "13px";
    bc.style.display = "flex";
    bc.style.alignItems = "center";
    bc.style.gap = "8px";
    treeWrap.style.position = treeWrap.style.position || 'relative';
    treeWrap.appendChild(bc);
  }

  function refreshBreadcrumbs(){
    bc.innerHTML = '';
    if (NAV_STACK.length > 0) {
      const back = document.createElement('button');
      back.textContent = '← Volver';
      back.className = 'btn';
      back.style.padding = '6px 8px';
      back.style.fontSize = '13px';
      back.addEventListener('click', async ()=>{
        const last = NAV_STACK.pop();
        if (!last) return;
        try{
          const root = await buildUnilevelTree(last);
          if (root) renderTree(root);
        }catch(e){ console.error(e); alert('Error al volver'); }
      });
      bc.appendChild(back);
    }
    const path = document.createElement('div');
    path.style.fontWeight = '600';
    path.textContent = (NAV_STACK.length ? NAV_STACK.join(' > ') + ' > ' : '') + (CURRENT_ROOT || 'Root');
    bc.appendChild(path);
  }
  refreshBreadcrumbs();
  // exponer para uso futuro
  window._refreshNetworkBreadcrumbs = refreshBreadcrumbs;



  // Preferir la instancia global de d3 (script en index)
  const d3g = (typeof window !== 'undefined' && window.d3) ? window.d3 : (typeof d3 !== 'undefined' ? d3 : null);
  if (!d3g) {
    // Si no hay d3, caemos a implementación SVG simple (fallback)
    renderTreeFallback(rootNode);
    return;
  }

  // dimensiones del contenedor
  const contW = Math.max(treeWrap.clientWidth || 800, 600);
  const contH = Math.max(treeWrap.clientHeight || 600, 400);
  const margin = { top: 20, right: 20, bottom: 20, left: 20 };
  const width = contW - margin.left - margin.right;
  const height = contH - margin.top - margin.bottom;

  // crear svg responsivo
  const svg = d3g.select(treeWrap)
    .append("svg")
  // agregar filtro de sombra para nodos
  
    .attr("viewBox", `0 0 ${contW} ${contH}`)
    .attr("preserveAspectRatio", "xMidYMin meet")
    .style("width", "100%")
    .style("height", "100%")
    .style("display", "block")
    .style("touch-action", "manipulation")
    .style("-webkit-transform", "translateZ(0)")
    .style("transform", "translateZ(0)");

  
  const defs = svg.append('defs');
  const filter = defs.append('filter').attr('id','node-drop').attr('x','-50%').attr('y','-50%').attr('width','200%').attr('height','200%');
  filter.append('feDropShadow').attr('dx',0).attr('dy',3).attr('stdDeviation',4).attr('flood-color','#000').attr('flood-opacity',0.18);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // --- Habilitar zoom/pan (soporta mouse y touch) ---
  const zoom = d3g.zoom()
    .scaleExtent([0.4, 2])
    .on('zoom', (event) => {
      // event.transform contiene la matriz de transformación
      g.attr('transform', event.transform);
    });

  // Aplicar comportamiento de zoom al svg
  svg.call(zoom)
     // iniciar con el margen ya aplicado para que el contenido no quede pegado al borde
     .call(zoom.transform, d3g.zoomIdentity.translate(margin.left, margin.top));

  // evitar zoom por doble click si no lo deseas
  svg.on('dblclick.zoom', null);

  // Nota: para desplazar con el dedo o el mouse, el usuario puede arrastrar en el área y usar pinch para hacer zoom.


  // convertir a d3.hierarchy
  // d3 espera children en 'children'
  const root = d3g.hierarchy(rootNode, d => d.children || []);
  const treeLayout = d3g.tree().size([width, height - 40]); // espacio vertical
  treeLayout(root);
  // Centrar el árbol: dejar el nodo raíz arriba (top) y centrado horizontalmente
  try {
    const TOP_MARGIN = 60; // separación desde la parte superior
    // calcular desplazamiento horizontal para centrar la raíz
    const shiftX = (width / 2) - root.x;
    // desplazar verticalmente para que la raíz quede cerca del TOP_MARGIN
    const shiftY = TOP_MARGIN - root.y;
    root.each(d => { d.x = d.x + shiftX; d.y = d.y + shiftY; });
  } catch (err) {
    console.warn("No se pudo centrar el árbol en top:", err);
  }


  // enlaces (curvos)
  const link = g.selectAll(".link")
    .data(root.links())
    .enter()
    .append("path")
    .attr("class", "link-line")
    .attr("d", d => {
      // path cúbico vertical
      const sx = d.source.x;
      const sy = d.source.y;
      const tx = d.target.x;
      const ty = d.target.y;
      const mx = (sx + tx) / 2;
      return `M${sx},${sy + 30} C ${sx},${(sy + ty) / 2} ${tx},${(sy + ty) / 2} ${tx},${ty - 30}`;
    })
    .attr("fill", "none")
    .attr("stroke", "#d0d0d0");

  // animar links entrada
  link.attr('stroke-opacity', 0)
    .transition().duration(600).attr('stroke-opacity', 1);


  // nodos
  const node = g.selectAll(".node")
    .data(root.descendants())
    .enter()
    .append("g")
    .attr("class", d => "node depth-" + d.depth)
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .style("touch-action", "manipulation");

  // area de toque (hit)
  node.append("circle")
    .attr("r", 40)
    .attr("fill", "transparent")
    .attr("pointer-events", "auto");

  // círculo visible
  node.append("circle")
    .attr("r", d => d.depth === 0 ? 36 : Math.max(20, 34 - d.depth*2))
      .attr("filter", "url(#node-drop)")
    .attr("fill", d => (d.data.usuario === rootNode.usuario ? "#2b9df3" : d.data.active ? "#28a745" : "#bfbfbf"))
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 3)
    .attr("pointer-events", "none");

  // texto
  node.append("text")
    .attr("y", 6)
    .attr("text-anchor", "middle")
    .attr("fill", "#fff")
    .style("font-size", "13px")
    .style("font-weight", "700")
    .text(d => (d.data.usuario || "").length > 12 ? d.data.usuario.slice(0, 10) + "…" : d.data.usuario || "");

  // animar nodos (entrada)
  node.attr('opacity',0)
    .attr('transform', d => `translate(${d.x},${d.y+18})`)
    .transition().duration(600).ease(d3g.easeCubic)
    .attr('opacity',1)
    .attr('transform', d => `translate(${d.x},${d.y})`);

  // handlers: pointerup + click fallback
  node.each(function(d) {
    const thisNode = d3g.select(this);
    const dom = thisNode.node();
    const handle = (e) => {
      try { e.preventDefault(); } catch (err) {}
      try { e.stopPropagation(); } catch (err) {}
      // Llamar a showInfoCard con el objeto de datos
      showInfoCard(d.data, e);
    };
    dom.addEventListener('pointerup', handle);
    dom.addEventListener('click', handle);
  });

  // Forzar repaint en iOS Safari: micro reflow
  try {
    svg.node().getBoundingClientRect();
    svg.style("display", "none");
    requestAnimationFrame(() => {
      svg.style("display", "block");
      try { window.scrollBy(0, 0); } catch (e) {}
    });
  } catch (err) {
    // ignore
  }
}

/* Fallback simple si D3 no está disponible (mantiene comportamiento anterior) */
function renderTreeFallback(rootNode) {
  const treeWrap = document.getElementById("treeWrap");
  clearElement(treeWrap);
  if (!rootNode) return;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "600");
  treeWrap.appendChild(svg);

  const levels = [];
  (function collect(node, depth = 0) {
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(node);
    (node.children || []).forEach(c => collect(c, depth + 1));
  })(rootNode);

  const nodePos = new Map();
  levels.forEach((lv, iy) => {
    lv.forEach((node, ix) => {
      const x = lv.length === 1 ? 500 : (ix + 1) * (1000 / (lv.length + 1));
      const y = 60 + iy * 110;
      nodePos.set(node.usuario + ":" + (node.id || ""), { x, y, node });
    });
  });

  levels.forEach((lv, iy) => {
    if (iy === 0) return;
    lv.forEach(child => {
      const parent = levels[iy - 1].find(p => (p.children || []).some(c => c.id === child.id));
      if (!parent) return;
      const pKey = parent.usuario + ":" + (parent.id || "");
      const cKey = child.usuario + ":" + (child.id || "");
      const ppos = nodePos.get(pKey);
      const cpos = nodePos.get(cKey);
      if (!ppos || !cpos) return;
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", `M${ppos.x},${ppos.y+30} C ${ppos.x},${(ppos.y+cpos.y)/2} ${cpos.x},${(ppos.y+cpos.y)/2} ${cpos.x},${cpos.y-30}`);
      path.setAttribute("stroke", "#d0d0d0");
      path.setAttribute("fill", "transparent");
      svg.appendChild(path);
    });
  });

  nodePos.forEach(({ x, y, node }) => {
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("transform", `translate(${x},${y})`);
    g.setAttribute("data-usuario", node.usuario || "");
    g.style.cursor = "pointer";
    g.style.touchAction = "manipulation";
    g.style.webkitTapHighlightColor = "transparent";

    const hit = document.createElementNS(svgNS, "circle");
    hit.setAttribute("r", 40);
    hit.setAttribute("fill", "transparent");
    hit.setAttribute("pointer-events", "auto");
    g.appendChild(hit);

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 30);
    circle.setAttribute("fill", node.usuario === rootNode.usuario ? "#2b9df3" : node.active ? "#28a745" : "#bfbfbf");
    circle.setAttribute("stroke", "#ffffff");
    circle.setAttribute("stroke-width", "3");
    circle.setAttribute("pointer-events", "none");
    g.appendChild(circle);

    const txt = document.createElementNS(svgNS, "text");
    txt.setAttribute("y", "6");
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("fill", "#fff");
    txt.setAttribute("font-weight", "700");
    txt.style.fontSize = "12px";
    txt.textContent = (node.usuario || "").length > 12 ? node.usuario.slice(0, 10) + "…" : (node.usuario || "");
    txt.setAttribute("pointer-events", "none");
    g.appendChild(txt);

    const handleSelect = (e) => {
      try { e.preventDefault(); } catch (err) {}
      try { e.stopPropagation(); } catch (err) {}
      showInfoCard(node, e);
    };

    g.addEventListener("pointerup", handleSelect);
    g.addEventListener("click", handleSelect);
    svg.appendChild(g);
  });

  // Forzar repintado
  try {
    svg.getBoundingClientRect();
    svg.style.display = "none";
    requestAnimationFrame(() => {
      svg.style.display = "block";
      try { window.scrollBy(0,0); } catch(e){}
    });
  } catch (e) {}
}

/* -------------------- INFO CARD -------------------- */

function createInfoCard() {
  let el = document.querySelector(".info-card");
  if (!el) {
    el = document.createElement("div");
    el.className = "info-card";
    el.style.position = "fixed";
    el.style.right = "20px";
    el.style.top = "80px";
    el.style.left = "auto";
    el.style.padding = "14px";
    el.style.background = "#fff";
    el.style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)";
    el.style.zIndex = 9999;
    el.style.width = "220px";
    el.style.borderRadius = "8px";
    el.innerHTML = `
      <h4 id="ic-name" style="margin:0 0 8px 0;font-size:16px;"></h4>
      <p id="ic-user" style="margin:0 0 8px 0;color:#666;font-size:13px;"></p>
      <p style="margin:0 0 6px 0;"><strong>Estado:</strong> <span id="ic-state"></span></p>
      <p style="margin:0 0 6px 0;"><strong>Puntos:</strong> <span id="ic-points"></span></p>
      <div style="margin-top:8px; text-align:right;">
        <button id="ic-view-network" class="btn" style="margin-right:8px;">Ver red</button>
        <button id="ic-close" class="btn">Cerrar</button>
      </div>
    `;
    document.body.appendChild(el);
    const closeBtn = el.querySelector("#ic-close");
    if (closeBtn) closeBtn.addEventListener("click", () => el.style.display = "none");
    const viewBtn = el.querySelector("#ic-view-network");
    if (viewBtn) {
      viewBtn.addEventListener("click", async () => {
        // el.dataset.usuario será establecido por showInfoCard antes de mostrar
        const usuario = el.dataset.usuario;
        if (!usuario) return alert('Usuario no disponible');
        try {
          // guardar root actual en stack para poder volver
          if (typeof CURRENT_ROOT === 'string' && CURRENT_ROOT) NAV_STACK.push(CURRENT_ROOT);
          const newRoot = await buildUnilevelTree(usuario);
          if (newRoot) {
            renderTree(newRoot);
            el.style.display = 'none';
          } else {
            alert('No se pudo cargar la red de ' + usuario);
          }
        } catch (err) {
          console.error('Error al cargar la red:', err);
          alert('Error al cargar la red');
        }
      });
    }
  }
  return el;
}

function showInfoCard(node, event) {
  const el = createInfoCard();
  el.style.display = "block";
  const nameEl = el.querySelector("#ic-name");
  const userEl = el.querySelector("#ic-user");
  const stateEl = el.querySelector("#ic-state");
  const pointsEl = el.querySelector("#ic-points");
  if (nameEl) nameEl.textContent = node.nombre || node.usuario || "";
  // guardar usuario en dataset para que el botón 'Ver red' pueda usarlo
  el.dataset.usuario = node.usuario || '';
  if (userEl) userEl.textContent = `Código: ${node.usuario || ""}`;
  if (stateEl) stateEl.innerHTML = node.active ? '<span style="color:#28a745">Activo</span>' : '<span style="color:#666">Inactivo</span>';
  if (pointsEl) pointsEl.textContent = `${node.puntos || 0} pts`;

  // Posicionar cerca del punto tocado si tenemos coords
  if (event && typeof event.clientX === "number" && typeof event.clientY === "number") {
    const margin = 8;
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const rectW = el.offsetWidth || 220;
    const rectH = el.offsetHeight || 140;
    let left = event.clientX + margin;
    let top = event.clientY - rectH / 2;
    if (left + rectW > vw - margin) left = vw - rectW - margin;
    if (left < margin) left = margin;
    if (top + rectH > vh - margin) top = vh - rectH - margin;
    if (top < margin) top = margin;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = "auto";
  } else {
    el.style.right = "20px";
    el.style.left = "auto";
    el.style.top = "80px";
  }
}

/* -------------------- ESTADÍSTICAS -------------------- */

function updateStatsFromTree(tree) {
  if (!tree) return;
  let total = 0, activos = 0, inactivos = 0, puntos = 0;
  (function walk(n) {
    total++;
    if (n.active) activos++; else inactivos++;
    puntos += n.puntos || 0;
    (n.children || []).forEach(walk);
  })(tree);

  // frontales (primer nivel)
  const frontales = (tree.children || []).length;

  // actualizar spans del header (si existen)
  const elFront = document.getElementById("statFrontales");
  const elTotal = document.getElementById("statTotal");
  const elRecompra = document.getElementById("statRecompra");

  if (elFront) elFront.textContent = String(frontales);
  if (elTotal) elTotal.textContent = String(total);
  if (elRecompra) elRecompra.textContent = String(activos);

  // ocultar/limpiar el resumen inferior si existe
  const bottom = document.getElementById("statsInfo");
  if (bottom) {
    bottom.textContent = "";
    bottom.style.display = "none";
  }
}

/* -------------------- LECTURA Y RENDERIZADO SEGURO DE PUNTOS -------------------- */

async function readAndRenderPoints(userId) {
  try {
    if (!userId) return;
    const uRef = doc(db, "usuarios", userId);
    const uSnap = await getDoc(uRef);
    if (!uSnap.exists()) {
      const pointsEl = document.getElementById("points");
      if (pointsEl) pointsEl.textContent = "0";
      const tpEl = document.getElementById("teamPoints");
      if (tpEl) tpEl.textContent = "-";
      const alertEl = document.getElementById("activationAlert");
      if (alertEl) alertEl.style.display = "block";
      return;
    }
    const d = uSnap.data();
    const personal = Number(d.personalPoints ?? d.puntos ?? 0);

    let teamPersisted = (typeof d.teamPoints === "number") ? d.teamPoints : null;
    if (teamPersisted === null) {
      try {
        teamPersisted = await calculateTeamPoints(userId);
      } catch (e) {
        console.warn("No se pudo calcular teamPoints en cliente:", e);
        teamPersisted = 0;
      }
    }

    const pointsEl = document.getElementById("points");
    if (pointsEl) pointsEl.textContent = String(personal);

    const tpEl = document.getElementById("teamPoints");
    if (tpEl) tpEl.textContent = String(teamPersisted);

    const alertEl = document.getElementById("activationAlert");
    if (alertEl) alertEl.style.display = (personal < 50) ? "block" : "none";
  } catch (err) {
    console.error("readAndRenderPoints error:", err);
  }
}

/* -------------------- REFRESH / UI / AUTH -------------------- */

async function refreshTreeAndStats(rootCode, userId) {
  const tree = await buildUnilevelTree(rootCode);
  renderTree(tree);
  updateStatsFromTree(tree);
  await readAndRenderPoints(userId);
    // Notify loading overlay based on avatar-grid visibility and profile avatar selection.
    (function waitForAvatarUiThenHide() {
      const overlayHide = function() {
        if (typeof window.hidePageLoading === 'function') {
          try { window.hidePageLoading(); } catch(e) { console.warn('hidePageLoading failed', e); }
        } else if (typeof window.onMapReady === 'function') {
          try { window.onMapReady(); } catch(e) { console.warn('onMapReady failed', e); }
        } else {
          const ov = document.getElementById('page-loading-overlay');
          if (ov) ov.classList.add('hidden');
        }
      };

      const avatarGrid = document.querySelector('.avatar-grid') || document.getElementById('avatarGrid');
      const profileImg = document.getElementById('profileImg');

      function isProfileUsingDefault(imgEl) {
        if (!imgEl) return true;
        const src = (imgEl.getAttribute && imgEl.getAttribute('src')) || imgEl.src || '';
        if (!src) return true;
        const url = src.split('?')[0].toLowerCase();
        // consider default patterns: files named avatar_*.png or default-avatar.png, or empty src
        if (url.includes('/images/avatars/default-avatar.png')) return true;
        if (url.match(/avatar[_-]?\d+\.png$/)) return true;
        // if DB uses relative path like 'images/avatars/avatar9.png', browser may resolve absolute; check basename
        if (url.indexOf('/images/avatars/') !== -1 && url.match(/avatar\d+\.png$/)) return true;
        return false;
      }

      // If no avatarGrid in DOM, nothing to wait for: hide immediately.
      if (!avatarGrid) {
        // small timeout so UI has a chance to settle visually
        setTimeout(overlayHide, 120);
        return;
      }

      // If user has NO custom avatar (profile uses default), hide overlay quickly.
      if (isProfileUsingDefault(profileImg)) {
        setTimeout(overlayHide, 120);
        return;
      }

      // Otherwise user has a chosen avatar: wait until the avatarGrid is hidden/removed.
      // Observe attribute changes and childList to detect display:none or removal.
      const observer = new MutationObserver((mutations) => {
        try {
          const inDom = document.body.contains(avatarGrid);
          const style = avatarGrid && window.getComputedStyle(avatarGrid);
          const isHidden = !inDom || (style && (style.display === 'none' || style.visibility === 'hidden' || avatarGrid.hidden));
          if (isHidden) {
            observer.disconnect();
            overlayHide();
          }
        } catch (err) {
          console.warn('avatar-grid observer error', err);
        }
      });

      // Start observing
      try {
        observer.observe(avatarGrid, { attributes: true, attributeFilter: ['style','class','hidden'], childList: true, subtree: false });
      } catch (e) {
        // if observe fails, fallback to polling
        console.warn('observer failed, falling back to polling', e);
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          const inDom = document.body.contains(avatarGrid);
          const style = avatarGrid && window.getComputedStyle(avatarGrid);
          const isHidden = !inDom || (style && (style.display === 'none' || style.visibility === 'hidden' || avatarGrid.hidden));
          if (isHidden || attempts > 40) {
            clearInterval(poll);
            overlayHide();
          }
        }, 250);
        return;
      }

      // Also set a safety timeout: if nothing hides after N seconds, hide to avoid locking.
      setTimeout(() => {
        try {
          const style = avatarGrid && window.getComputedStyle(avatarGrid);
          const isHidden = !document.body.contains(avatarGrid) || (style && (style.display === 'none' || style.visibility === 'hidden' || avatarGrid.hidden));
          if (!isHidden) {
            // still visible after timeout: hide overlay anyway but keep observer alive for future UI changes
            overlayHide();
          }
        } catch (e) {
          overlayHide();
        }
      }, 12000);
    })();

    // Notify loading overlay that the 'map' (network tree) is ready
    if (typeof window.hidePageLoading === 'function') {
      try { window.hidePageLoading(); } catch(e) { console.warn('hidePageLoading failed', e); }
    } else if (typeof window.onMapReady === 'function') {
      try { window.onMapReady(); } catch(e) { console.warn('onMapReady failed', e); }
    }

}

/* Manejo de estado de sesión y UI inicial */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/distribuidor-login.html";
    return;
  }

  try {
    const userRef = doc(db, "usuarios", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const d = userSnap.data();
    const rootCode = d[FIELD_USUARIO] || d.usuario || "";

    const nameEl = document.getElementById("name");
    if (nameEl) nameEl.textContent = d.nombre || "";

    const emailEl = document.getElementById("email");
    if (emailEl) emailEl.textContent = d.email || user.email || "";

    const codeEl = document.getElementById("code");
    if (codeEl) codeEl.textContent = rootCode;

    const pointsEl = document.getElementById("points");
    if (pointsEl) pointsEl.textContent = String(d.personalPoints ?? d.puntos ?? 0);

    const refCodeEl = document.getElementById("refCode");
    if (refCodeEl) refCodeEl.value = `${window.location.origin}/register.html?patrocinador=${encodeURIComponent(rootCode)}`;

    const alertEl = document.getElementById("activationAlert");
    if (alertEl) alertEl.style.display = (Number(d.personalPoints ?? d.puntos ?? 0) < 50 && !d.initialPackBought) ? "block" : "none";

    const personalPoints = calculatePersonalPoints(d[FIELD_HISTORY] || []);
    let elHidden = document.getElementById("personalPointsValue");
    if (!elHidden) {
      elHidden = document.createElement("span");
      elHidden.id = "personalPointsValue";
      elHidden.style.display = "none";
      document.body.appendChild(elHidden);
    }
    elHidden.textContent = personalPoints;
    document.dispatchEvent(new CustomEvent("personalPointsReady", { detail: { personalPoints } }));

    if (typeof d.teamPoints === "number") {
      const tpEl2 = document.getElementById("teamPoints");
      if (tpEl2) tpEl2.textContent = String(d.teamPoints);
    } else {
      try {
        const totalTeamPoints = await calculateTeamPoints(user.uid);
        const tpEl2 = document.getElementById("teamPoints");
        if (tpEl2) tpEl2.textContent = String(totalTeamPoints);
      } catch (e) {
        console.warn("No se pudo calcular teamPoints para mostrar:", e);
      }
    }

    const tree = await buildUnilevelTree(rootCode);
    renderTree(tree);
    updateStatsFromTree(tree);

    const btnRefresh = document.getElementById("btnRefreshMap");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", async () => {
        await refreshTreeAndStats(rootCode, user.uid);
      });
    }

    const btnConfirm = document.getElementById("btnConfirmOrder");
    if (btnConfirm) {
      btnConfirm.addEventListener("click", async () => {
        const orderIdEl = document.getElementById("orderIdInput");
        const orderId = orderIdEl ? orderIdEl.value : null;
        if (!orderId) return alert("Debe seleccionar una orden");
        try {
          const token = await auth.currentUser.getIdToken();
          const resp = await fetch("/.netlify/functions/confirm-order", {
            method: "POST",
            headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
            body: JSON.stringify({ orderId, action: "confirm" })
          });
          const data = await resp.json();
          alert(data.message || "Orden confirmada");
          await refreshTreeAndStats(rootCode, user.uid);
        } catch (err) {
          console.error(err);
          alert("Error al confirmar la orden");
        }
      });
    }

    const profileImg = document.getElementById("profileImg");
    const avatarGrid = document.querySelector(".avatar-grid");
    const changeAvatarBtn = document.getElementById("changeAvatarBtn");
    // load avatar from DB (d) if available
    const dbFoto = d?.fotoURL || null;
    if (dbFoto && profileImg) {
      profileImg.src = resolveAvatarPath(dbFoto);
      if (avatarGrid) avatarGrid.style.display = "none";
      if (changeAvatarBtn) changeAvatarBtn.style.display = "inline-block";
    }
    document.querySelectorAll(".avatar-grid img").forEach(img => {
      img.addEventListener("click", async () => {
        const dbPath = `images/avatars/${img.dataset.avatar}`;
        try {
          await updateDoc(doc(db, 'usuarios', user.uid), { fotoURL: dbPath });
          const clientPath = resolveAvatarPath(dbPath);
          if (profileImg) profileImg.src = clientPath;
          if (avatarGrid) avatarGrid.style.display = "none";
          if (changeAvatarBtn) changeAvatarBtn.style.display = "inline-block";
        } catch (err) {
          console.error('Error actualizando avatar (red-unilevel):', err);
          alert('No se pudo cambiar el avatar.');
        }
      });
    });
    if (changeAvatarBtn) {
      changeAvatarBtn.addEventListener("click", () => {
        if (avatarGrid) avatarGrid.style.display = "grid";
        changeAvatarBtn.style.display = "none";
      });
    }

    const copyRefBtn = document.getElementById("copyRef");
    if (copyRefBtn) {
      copyRefBtn.addEventListener("click", () => {
        const input = document.getElementById("refCode");
        if (!input) return;
        input.select();
        document.execCommand('copy');
        alert("Enlace copiado");
      });
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await signOut(auth);
          localStorage.removeItem("selectedAvatar");
          window.location.href = "../index.html";
        } catch (e) {
          console.error(e);
        }
      });
    }

    const toggleDarkMode = document.getElementById("toggleDarkMode");
    if (toggleDarkMode) {
      toggleDarkMode.addEventListener("click", () => {
        document.body.classList.toggle("dark");
        localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
      });
      if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
    }

  } catch (err) {
    console.error("Error iniciando UI de red:", err);
  }
});

/* -------------------- EXPORTS -------------------- */

export {
  buildUnilevelTree,
  renderTree,
  updateStatsFromTree,
  calculatePersonalPoints,
  calculateTeamPoints,
  persistTeamPointsSafely,
  createInfoCard
};



/* ====== APPENDED PATCH (DO NOT REMOVE) ====== */

/* ======= PATCH: Network tree improvements (added by assistant) =======
   - Default visible depth control (Nivel 1..N)
   - Expand/collapse per-node (+) to show hidden children
   - Info-card displays Teléfono and Ciudad (tries multiple field names)
   - Overrides are assigned to window.* to avoid const/function redeclaration issues
   ====================================================================== */

(function(){
  // Safe globals
  window.NETWORK_VISIBLE_DEPTH = window.NETWORK_VISIBLE_DEPTH || 2;
  window.NETWORK_EXPANDED_NODES = window.NETWORK_EXPANDED_NODES || new Set();
  window.LAST_NETWORK_TREE = window.LAST_NETWORK_TREE || null;

  // Utility: safe getter for phone/city from various possible field names
  function _getPhoneFromNode(data){
    if(!data) return '';
    return data.telefono || data.phone || data.celular || data.phoneNumber || data.tel || '';
  }
  function _getCityFromNode(data){
    if(!data) return '';
    return data.ciudad || data.city || data.localidad || data.location || '';
  }

  // Create / reuse an info-card element in the DOM
  window.createInfoCard = window.createInfoCard || function createInfoCard(){
    var mount = document.getElementById('network-info-card');
    if (mount) return mount;
    mount = document.createElement('div');
    mount.id = 'network-info-card';
    mount.style.position = 'absolute';
    mount.style.right = '18px';
    mount.style.top = '12px';
    mount.style.minWidth = '240px';
    mount.style.maxWidth = '320px';
    mount.style.zIndex = 9999;
    mount.style.background = 'white';
    mount.style.borderRadius = '8px';
    mount.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    mount.style.padding = '12px';
    mount.style.fontFamily = 'Arial, Helvetica, sans-serif';
    mount.style.display = 'none';
    mount.innerHTML = `
      <h4 id="ic-name" style="margin:0 0 8px 0;font-size:16px;"></h4>
      <p id="ic-user" style="margin:0 0 6px 0;color:#666;font-size:13px;"></p>
      <p id="ic-phone" style="margin:0 0 6px 0;"><strong>Teléfono:</strong> <span id="ic-phone-value">—</span></p>
      <p id="ic-city" style="margin:0 0 6px 0;"><strong>Ciudad:</strong> <span id="ic-city-value">—</span></p>
      <p style="margin:0 0 6px 0;"><strong>Estado:</strong> <span id="ic-state"></span></p>
      <p style="margin:0 0 6px 0;"><strong>Puntos:</strong> <span id="ic-points"></span></p>
      <div style="margin-top:8px; text-align:right;">
        <button id="ic-view-network" class="btn" style="margin-right:8px;padding:6px 8px;font-size:13px;">Ver red</button>
        <button id="ic-close" class="btn" style="padding:6px 8px;font-size:13px;">Cerrar</button>
      </div>
    `;
    document.body.appendChild(mount);

    mount.querySelector('#ic-close').addEventListener('click', function(){
      mount.style.display = 'none';
    });

    // 'Ver red' button will try to call a function buildUnilevelTree if present
    mount.querySelector('#ic-view-network').addEventListener('click', async function(){
      var userId = mount.getAttribute('data-userid');
      if(!userId) return;
      if(typeof window.buildUnilevelTree === 'function'){
        try{
          var tree = await window.buildUnilevelTree(userId);
          if(tree && typeof window.renderTree === 'function'){
            // push breadcrumb path
            if(!window.NAV_STACK) window.NAV_STACK = [];
            window.NAV_STACK.push(userId);
            window.renderTree(tree);
          }
        }catch(e){
          console.error('Error al construir red del usuario:', e);
          alert('No se pudo cargar la red del usuario');
        }
      } else {
        alert('Función de construcción de red no disponible.');
      }
    });

    return mount;
  };

  // Show info card for a node (node may be raw data, or {data:...}, or firestore doc-like)
  window.showInfoCard = window.showInfoCard || function showInfoCard(node, event){
    var el = window.createInfoCard();
    if(!el) return;
    var data = node;
    if(node && node.data) data = node.data;
    // try to pluck displayable fields
    var name = data && (data.nombre || data.name || data.usuario || data.username || data.displayName) || '—';
    var user = data && (data.usuario || data.username || data.id) || (data && data.id) || '—';
    var phone = _getPhoneFromNode(data) || '—';
    var city = _getCityFromNode(data) || '—';
    var active = (data && (data.active !== undefined ? data.active : (data.estado || data.status))) ? 'Activo' : 'Inactivo';
    var puntos = (data && (data.puntos || data.points || data.personalPoints)) || 0;

    el.style.display = 'block';
    el.setAttribute('data-userid', data && (data.id || data.usuario || data.userId || data.uid) || '');
    el.querySelector('#ic-name').textContent = name;
    el.querySelector('#ic-user').textContent = user;
    el.querySelector('#ic-phone-value').textContent = phone;
    el.querySelector('#ic-city-value').textContent = city;
    el.querySelector('#ic-state').textContent = active;
    el.querySelector('#ic-points').textContent = puntos;

    // position near event if provided
    try{
      if(event && event.clientX !== undefined && event.clientY !== undefined){
        // place to the right with small offset
        var x = event.clientX + 12;
        var y = event.clientY + 12;
        // keep inside viewport
        var rectW = el.offsetWidth || 280;
        var rectH = el.offsetHeight || 160;
        if(x + rectW > window.innerWidth - 12) x = window.innerWidth - rectW - 12;
        if(y + rectH > window.innerHeight - 12) y = window.innerHeight - rectH - 12;
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.position = 'fixed';
      } else {
        // default top-right
        el.style.position = 'absolute';
        el.style.right = '18px';
        el.style.top = '12px';
      }
    }catch(e){ console.warn('posicion info card', e); }
  };

  // RenderTree override attached to window.renderTree
  window.renderTree = window.renderTree || function renderTree(rootNode) {
    // Minimal guards
    var treeWrap = document.getElementById("treeWrap") || document.body;
    // store last tree
    window.LAST_NETWORK_TREE = rootNode;
    // ensure NAV_STACK exists
    window.NAV_STACK = window.NAV_STACK || [];

    // create breadcrumbs/control container
    var bc = document.getElementById('network-breadcrumbs');
    if(!bc){
      bc = document.createElement('div');
      bc.id = 'network-breadcrumbs';
      bc.style.position = 'absolute';
      bc.style.left = '12px';
      bc.style.top = '12px';
      bc.style.zIndex = 9998;
      bc.style.background = 'rgba(255,255,255,0.95)';
      bc.style.padding = '6px 10px';
      bc.style.borderRadius = '8px';
      bc.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
      bc.style.fontSize = '13px';
      bc.style.display = 'flex';
      bc.style.alignItems = 'center';
      bc.style.gap = '8px';
      bc.style.flexWrap = 'wrap';
      treeWrap.style.position = treeWrap.style.position || 'relative';
      treeWrap.appendChild(bc);
    }
    // refresh content
    bc.innerHTML = '';
    // back button
    if(window.NAV_STACK.length > 0){
      var back = document.createElement('button');
      back.textContent = '← Volver';
      back.className = 'btn';
      back.style.padding = '6px 8px';
      back.style.fontSize = '13px';
      back.addEventListener('click', function(){
        var last = window.NAV_STACK.pop();
        if(!last) return;
        if(typeof window.buildUnilevelTree === 'function'){
          window.buildUnilevelTree(last).then(function(t){
            if(t && typeof window.renderTree === 'function') window.renderTree(t);
          }).catch(function(e){ console.error(e); alert('Error al volver'); });
        }
      });
      bc.appendChild(back);
    }
    var path = document.createElement('div');
    path.style.fontWeight = '600';
    path.textContent = (window.NAV_STACK.length ? window.NAV_STACK.join(' > ') + ' > ' : '') + (rootNode && (rootNode.usuario || rootNode.name || rootNode.id) || 'Root');
    bc.appendChild(path);

    // level controls
    var controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '6px';
    controls.style.marginLeft = '8px';
    var DEPTH_LIMIT = 6;
    for(var i=1;i<=DEPTH_LIMIT;i++){
      (function(level){
        var btn = document.createElement('button');
        btn.textContent = 'Nivel ' + level;
        btn.className = 'btn network-level-btn';
        btn.style.padding = '6px 8px';
        btn.style.fontSize = '12px';
        if(window.NETWORK_VISIBLE_DEPTH === level){
          btn.style.background = '#2b9df3';
          btn.style.color = '#fff';
        }
        btn.addEventListener('click', function(){
          window.NETWORK_VISIBLE_DEPTH = level;
          // render again with same tree
          if(window.LAST_NETWORK_TREE && typeof window.renderTree === 'function'){
            window.renderTree(window.LAST_NETWORK_TREE);
          }
        });
        controls.appendChild(btn);
      })(i);
    }
    bc.appendChild(controls);

    // Clear old SVG if any
    var oldSvg = treeWrap.querySelector('svg');
    if(oldSvg) oldSvg.remove();

    // If no d3, fallback: simple list
    var d3g = (typeof d3 !== 'undefined') ? d3 : null;
    if(!d3g){
      // simple fallback: list nodes up to depth
      var list = document.createElement('div');
      list.style.padding = '12px';
      list.style.maxHeight = (treeWrap.clientHeight || 400) + 'px';
      list.style.overflow = 'auto';
      treeWrap.appendChild(list);
      var q = [ { node: rootNode, depth: 0 } ];
      while(q.length){
        var item = q.shift();
        if(item.depth > window.NETWORK_VISIBLE_DEPTH) continue;
        var line = document.createElement('div');
        line.style.margin = '6px 0';
        line.textContent = (new Array(item.depth+1).join('  ')) + (item.node && (item.node.usuario || item.node.nombre || item.node.id) || '—');
        line.style.cursor = 'pointer';
        line.addEventListener('click', function(ev){
          window.showInfoCard(item.node, ev);
        });
        list.appendChild(line);
        if(item.node && item.node.children && item.node.children.length){
          for(var k=0;k<item.node.children.length;k++){
            q.push({ node: item.node.children[k], depth: item.depth+1 });
          }
        }
      }
      return;
    }

    // Use d3 tree layout
    var contW = Math.max(treeWrap.clientWidth || 800, 600);
    var contH = Math.max(treeWrap.clientHeight || 600, 400);
    var margin = { top: 20, right: 20, bottom: 20, left: 20 };
    var width = contW - margin.left - margin.right;
    var height = contH - margin.top - margin.bottom;

    var svg = d3g.select(treeWrap)
      .append('svg')
      .attr('viewBox', '0 0 ' + contW + ' ' + contH)
      .attr('preserveAspectRatio','xMidYMin meet')
      .style('width','100%')
      .style('height','100%')
      .style('display','block')
      .style('touch-action','manipulation');

    var defs = svg.append('defs');
    var filter = defs.append('filter').attr('id','node-drop').attr('x','-50%').attr('y','-50%').attr('width','200%').attr('height','200%');
    filter.append('feDropShadow').attr('dx',0).attr('dy',3).attr('stdDeviation',4).attr('flood-color','#000').attr('flood-opacity',0.18);

    var g = svg.append('g').attr('transform','translate(' + margin.left + ',' + margin.top + ')');

    var zoom = d3g.zoom().scaleExtent([0.4,2]).on('zoom', function(event){ g.attr('transform', event.transform); });
    svg.call(zoom).call(zoom.transform, d3g.zoomIdentity.translate(margin.left, margin.top));
    svg.on('dblclick.zoom', null);

    // Build hierarchy and layout
    var root = d3g.hierarchy(rootNode, function(d){ return d.children || []; });
    var treeLayout = d3g.tree().size([width, height - 40]);
    treeLayout(root);

    // center-ish
    try {
      var TOP_MARGIN = 60;
      var shiftX = (width / 2) - root.x;
      var shiftY = TOP_MARGIN - root.y;
      root.each(function(d){ d.x = d.x + shiftX; d.y = d.y + shiftY; });
    } catch(e){ console.warn(e); }

    // decide visibility
    function isNodeVisible(d){
      if(!d) return false;
      if(d.depth <= (window.NETWORK_VISIBLE_DEPTH || 2)) return true;
      var expanded = window.NETWORK_EXPANDED_NODES || new Set();
      var cur = d;
      while(cur){
        if(cur.data && expanded.has(cur.data.id)) return true;
        cur = cur.parent;
      }
      return false;
    }

    // LINKS
    var links = root.links();
    var link = g.selectAll('.link').data(links).enter().append('path')
      .attr('class','link-line')
      .attr('d', function(d){
        var sx = d.source.x;
        var sy = d.source.y;
        var tx = d.target.x;
        var ty = d.target.y;
        return 'M' + sx + ',' + (sy + 30) + ' C ' + sx + ',' + ((sy+ty)/2) + ' ' + tx + ',' + ((sy+ty)/2) + ' ' + tx + ',' + (ty - 30);
      })
      .attr('fill','none').attr('stroke','#d0d0d0');

    link.attr('stroke-opacity',0).transition().duration(600).attr('stroke-opacity',1);

    // NODES
    var node = g.selectAll('.node').data(root.descendants()).enter().append('g')
      .attr('class', function(d){ return 'node depth-' + d.depth; })
      .attr('transform', function(d){ return 'translate(' + d.x + ',' + d.y + ')'; })
      .style('cursor','pointer')
      .style('touch-action','manipulation');

    node.append('circle').attr('r',40).attr('fill','transparent').attr('pointer-events','auto');

    node.append('circle')
      .attr('r', function(d){ return d.depth === 0 ? 36 : Math.max(20, 34 - d.depth*2); })
      .attr('filter','url(#node-drop)')
      .attr('fill', function(d){ return (d.data && d.data.usuario && (d.data.usuario === (rootNode.usuario || rootNode.id))) ? '#2b9df3' : (d.data && d.data.active ? '#28a745' : '#bfbfbf'); })
      .attr('stroke','#ffffff').attr('stroke-width',3).attr('pointer-events','none');

    node.append('text')
      .attr('y',6)
      .attr('text-anchor','middle')
      .attr('fill','#fff')
      .style('font-size','13px')
      .style('font-weight','700')
      .text(function(d){ var u = (d.data && (d.data.usuario || d.data.nombre || d.data.name)) || ''; return u.length > 12 ? u.slice(0,10) + '…' : u; });

    // show/hide based on isNodeVisible
    node.style('display', function(d){ return isNodeVisible(d) ? null : 'none'; });
    link.style('display', function(l){ return (isNodeVisible(l.source) && isNodeVisible(l.target)) ? null : 'none'; });

    // add expander for nodes with hidden children
    node.each(function(d){
      var thisNode = d3g.select(this);
      var hasChildren = d.children && d.children.length;
      var childHidden = false;
      if(hasChildren){
        for(var i=0;i<d.children.length;i++){
          if(!isNodeVisible(d.children[i])) { childHidden = true; break; }
        }
      }
      if(hasChildren && childHidden){
        var exp = thisNode.append('g').attr('class','expander').style('cursor','pointer').attr('transform','translate(28,-28)');
        exp.append('circle').attr('r',10).attr('fill','#ffffff').attr('stroke','#2b9df3').attr('stroke-width',2);
        var sign = (window.NETWORK_EXPANDED_NODES && window.NETWORK_EXPANDED_NODES.has(d.data && d.data.id)) ? '−' : '+';
        exp.append('text').attr('y',4).attr('text-anchor','middle').attr('fill','#2b9df3').style('font-size','12px').text(sign);
        exp.on('pointerup', function(ev){
          ev.stopPropagation();
          if(!window.NETWORK_EXPANDED_NODES) window.NETWORK_EXPANDED_NODES = new Set();
          var id = d.data && d.data.id;
          if(!id) return;
          if(window.NETWORK_EXPANDED_NODES.has(id)) window.NETWORK_EXPANDED_NODES.delete(id);
          else window.NETWORK_EXPANDED_NODES.add(id);
          // re-render
          if(window.LAST_NETWORK_TREE) window.renderTree(window.LAST_NETWORK_TREE);
        });
      }
    });

    // handlers to open info card
    node.each(function(d){
      var dom = this;
      var handler = function(e){
        try{ e.preventDefault(); }catch(err){}
        try{ e.stopPropagation(); }catch(err){}
        window.showInfoCard(d.data, e);
      };
      dom.addEventListener('pointerup', handler);
      dom.addEventListener('click', handler);
    });

    // entrance animation
    node.attr('opacity',0).attr('transform', function(d){ return 'translate(' + d.x + ',' + (d.y+18) + ')'; })
      .transition().duration(600).ease(d3g.easeCubic).attr('opacity',1).attr('transform', function(d){ return 'translate(' + d.x + ',' + d.y + ')'; });

    // force repaint iOS
    try { svg.node().getBoundingClientRect(); svg.style('display','none'); requestAnimationFrame(function(){ svg.style('display','block'); }); } catch(e){}
  }; // end renderTree override

  // Helpful: if developer code had a buildUnilevelTree that created nodes, we try to normalize phone/city on the constructed tree.
  // We wrap original if present so behavior is preserved.
  if (typeof window.buildUnilevelTree === 'function') {
    var _origBuild = window.buildUnilevelTree;
    window.buildUnilevelTree = async function(rootId){
      var tree = await _origBuild(rootId);
      if(!tree) return tree;
      // Depth-first walk to ensure phone/city fields exist on each node (if data available)
      function walk(n){
        if(!n) return;
        if(n.data){
          // attach shorthand fields
          if(!n.telefono) n.telefono = _getPhoneFromNode(n.data);
          if(!n.ciudad) n.ciudad = _getCityFromNode(n.data);
          // also normalize id/name
          if(!n.id) n.id = n.data.id || n.data.uid || n.data.usuario || n.data.userId || n.data.username;
          if(!n.nombre) n.nombre = n.data.nombre || n.data.name || n.data.usuario;
        } else {
          // try other common properties
          if(!n.telefono) n.telefono = _getPhoneFromNode(n);
          if(!n.ciudad) n.ciudad = _getCityFromNode(n);
        }
        if(n.children && n.children.length){
          for(var i=0;i<n.children.length;i++) walk(n.children[i]);
        }
      }
      walk(tree);
      return tree;
    };
  }

})(); // end IIFE
