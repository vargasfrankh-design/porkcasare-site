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
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const DEPTH_LIMIT = 6;
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
    .attr("viewBox", `0 0 ${contW} ${contH}`)
    .attr("preserveAspectRatio", "xMidYMin meet")
    .style("width", "100%")
    .style("height", "100%")
    .style("display", "block")
    .style("touch-action", "manipulation")
    .style("-webkit-transform", "translateZ(0)")
    .style("transform", "translateZ(0)");

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // convertir a d3.hierarchy
  // d3 espera children en 'children'
  const root = d3g.hierarchy(rootNode, d => d.children || []);
  const treeLayout = d3g.tree().size([width, height - 40]); // espacio vertical
  treeLayout(root);

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
    .attr("r", 30)
    .attr("fill", d => (d.data.usuario === rootNode.usuario ? "#2b9df3" : d.data.active ? "#28a745" : "#bfbfbf"))
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 3)
    .attr("pointer-events", "none");

  // texto
  node.append("text")
    .attr("y", 6)
    .attr("text-anchor", "middle")
    .attr("fill", "#fff")
    .style("font-size", "12px")
    .text(d => (d.data.usuario || "").length > 12 ? d.data.usuario.slice(0, 10) + "…" : d.data.usuario || "");

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
        <button id="ic-close" class="btn">Cerrar</button>
      </div>
    `;
    document.body.appendChild(el);
    const closeBtn = el.querySelector("#ic-close");
    if (closeBtn) closeBtn.addEventListener("click", () => el.style.display = "none");
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
  const el = document.getElementById("statsInfo");
  if (el) {
    el.textContent = `Usuarios: ${total} | Activos: ${activos} | Inactivos: ${inactivos} | Puntos: ${puntos}`;
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
    const savedAvatar = localStorage.getItem("selectedAvatar");
    if (savedAvatar && profileImg) {
      profileImg.src = savedAvatar;
      if (avatarGrid) avatarGrid.style.display = "none";
      if (changeAvatarBtn) changeAvatarBtn.style.display = "inline-block";
    }
    document.querySelectorAll(".avatar-grid img").forEach(img => {
      img.addEventListener("click", () => {
        const selected = `../images/avatars/${img.dataset.avatar}`;
        if (profileImg) profileImg.src = selected;
        localStorage.setItem("selectedAvatar", selected);
        if (avatarGrid) avatarGrid.style.display = "none";
        if (changeAvatarBtn) changeAvatarBtn.style.display = "inline-block";
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

