/**
 * oficina-virtual/js/red-unilevel.js
 * Versión final corregida y unificada.
 *
 * - Busca hijos por patrocinadorId (doc.id).
 * - calculateTeamPoints() es solo lectura (no sobrescribe).
 * - persistTeamPointsSafely(): opción para persistir usando transacción.
 * - Incluye UI: renderTree, info card y onAuthStateChanged.
 */

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
const FIELD_PATROCINADOR_ID = "patrocinadorId"; // se espera que contenga doc.id del sponsor

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

/* -------------------- CONSTRUCCIÓN DEL ÁRBOL -------------------- */

/**
 * buildUnilevelTree(username)
 * - Busca el documento root por `usuario` (username).
 * - Construye recursivamente hasta DEPTH_LIMIT usando patrocinadorId === doc.id.
 */
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
    puntos: Number(rootData.puntos || 0),
    teamPoints: Number(rootData.teamPoints || 0),
    children: []
  };

  async function addChildrenById(node, level = 1) {
    if (level > DEPTH_LIMIT) return;
    const qChildren = query(usuariosCol, where(FIELD_PATROCINADOR_ID, "==", node.id));
    const snap = await getDocs(qChildren);
    const children = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        usuario: data[FIELD_USUARIO],
        nombre: data.nombre || data[FIELD_USUARIO],
        active: isActiveThisMonth(data),
        puntos: Number(data.puntos || 0),
        teamPoints: Number(data.teamPoints || 0),
        children: []
      };
    });
    node.children = children;
    for (const child of children) await addChildrenById(child, level + 1);
  }

  await addChildrenById(rootNode, 1);
  return rootNode;
}

/* -------------------- PUNTOS PERSONALES -------------------- */

function calculatePersonalPoints(history) {
  let personalPoints = 0;
  (history || []).forEach(entry => {
    if (entry?.action && entry.action.startsWith("Compra confirmada")) {
      personalPoints += Number(entry.points || 0);
    }
  });
  return personalPoints;
}

/* -------------------- PUNTOS DE EQUIPO -------------------- */

/**
 * calculateTeamPoints(userId)
 * - Calcula la suma de `puntos` de todos los descendientes (no persiste).
 * - Devuelve Number.
 */
async function calculateTeamPoints(userId) {
  let totalTeamPoints = 0;
  const queue = [userId];
  const visited = new Set();
  const usuariosCol = collection(db, "usuarios");

  while (queue.length) {
    const uid = queue.shift();
    if (visited.has(uid)) continue;
    visited.add(uid);

    const q = query(usuariosCol, where(FIELD_PATROCINADOR_ID, "==", uid));
    const snap = await getDocs(q);
    snap.forEach(docSnap => {
      const d = docSnap.data();
      totalTeamPoints += Number(d.puntos || 0);
      queue.push(docSnap.id);
    });
  }

  return totalTeamPoints;
}

/**
 * persistTeamPointsSafely(userId)
 * - Transacción para persistir teamPoints = total calculado.
 * - Usar solo si decides guardar el total recalculado.
 */
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
    console.error("Error persistTeamPointsSafely:", err);
    return { ok: false, error: err.message || err };
  }
}

/* -------------------- RENDER ÁRBOL -------------------- */

function renderTree(rootNode) {
  const treeWrap = document.getElementById("treeWrap");
  clearElement(treeWrap);
  if (!rootNode) return;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "600");
  treeWrap.appendChild(svg);

  const levels = [];
  function gather(node, depth = 0) {
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(node);
    if (node.children?.length) node.children.forEach(c => gather(c, depth + 1));
  }
  gather(rootNode);

  const nodePos = new Map();
  levels.forEach((lv, iy) => {
    lv.forEach((node, ix) => {
      const x = lv.length === 1 ? 500 : (ix + 1) * (1000 / (lv.length + 1));
      const y = 60 + iy * 110;
      nodePos.set(node.usuario + ":" + (node.id || ""), { x, y, node });
    });
  });

  // Enlaces
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

  // Nodos
  nodePos.forEach(({ x, y, node }) => {
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("transform", `translate(${x},${y})`);
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 30);
    circle.setAttribute("fill", node.usuario === rootNode.usuario ? "#2b9df3" : node.active ? "#28a745" : "#bfbfbf");
    circle.setAttribute("stroke", "#ffffff");
    circle.setAttribute("stroke-width", "3");
    g.appendChild(circle);

    const txt = document.createElementNS(svgNS, "text");
    txt.setAttribute("y", "6");
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("fill", "#fff");
    txt.style.fontSize = "12px";
    txt.textContent = node.usuario.length > 12 ? node.usuario.slice(0, 10) + "…" : node.usuario;
    g.appendChild(txt);

    g.addEventListener("click", () => showInfoCard(node));
    svg.appendChild(g);
  });
}

function updateStatsFromTree(rootNode) {
  const statFrontales = document.getElementById("statFrontales");
  const statTotal = document.getElementById("statTotal");
  const statRecompra = document.getElementById("statRecompra");

  if (!rootNode) {
    if (statFrontales) statFrontales.textContent = "0";
    if (statTotal) statTotal.textContent = "0";
    if (statRecompra) statRecompra.textContent = "0";
    return;
  }

  let total = 0, activos = 0;
  const q = [{ node: rootNode, depth: 0 }];
  while (q.length) {
    const { node, depth } = q.shift();
    if (depth > 0) total++;
    if (depth > 0 && node.active) activos++;
    if (node.children?.length) node.children.forEach(c => q.push({ node: c, depth: depth + 1 }));
  }
  if (statFrontales) statFrontales.textContent = rootNode.children?.length || 0;
  if (statTotal) statTotal.textContent = total;
  if (statRecompra) statRecompra.textContent = activos;
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
    el.style.padding = "14px";
    el.style.background = "#fff";
    el.style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)";
    el.style.zIndex = 9999;
    el.innerHTML = `
      <h4 id="ic-name"></h4>
      <p id="ic-user" class="small"></p>
      <p><strong>Estado:</strong> <span id="ic-state"></span></p>
      <p><strong>Puntos:</strong> <span id="ic-points"></span></p>
      <div style="margin-top:8px">
        <button id="ic-close" class="btn">Cerrar</button>
      </div>
    `;
    document.body.appendChild(el);
    el.querySelector("#ic-close").addEventListener("click", () => el.style.display = "none");
  }
  return el;
}

function showInfoCard(node) {
  const el = createInfoCard();
  el.style.display = "block";
  el.querySelector("#ic-name").textContent = node.nombre || node.usuario;
  el.querySelector("#ic-user").textContent = `Código: ${node.usuario}`;
  el.querySelector("#ic-state").innerHTML = node.active ? '<span style="color:#28a745">Activo</span>' : '<span style="color:#666">Inactivo</span>';
  el.querySelector("#ic-points").textContent = `${node.puntos || 0} pts`;
}

/* -------------------- REFRESH / UI / AUTH -------------------- */

async function refreshTreeAndStats(rootCode, userId) {
  const tree = await buildUnilevelTree(rootCode);
  renderTree(tree);
  updateStatsFromTree(tree);
  const totalTeamPoints = await calculateTeamPoints(userId);
  const tpEl = document.getElementById("teamPoints");
  if (tpEl) tpEl.textContent = totalTeamPoints;
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

    // Datos básicos en UI
    document.getElementById("name")?.textContent = d.nombre || "";
    document.getElementById("email")?.textContent = d.email || user.email || "";
    document.getElementById("code")?.textContent = rootCode;
    document.getElementById("points")?.textContent = d.puntos || 0;
    document.getElementById("refCode") && (document.getElementById("refCode").value = `${window.location.origin}/registro?ref=${rootCode}`);

    // Mostrar alerta de activación si aplica
    const alertEl = document.getElementById("activationAlert");
    if (alertEl) alertEl.style.display = (Number(d.puntos || 0) < 50 && !d.initialPackBought) ? "block" : "none";

    // Puntos personales (evento)
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

    // Calcula y muestra teamPoints (lectura)
    const totalTeamPoints = await calculateTeamPoints(user.uid);
    const tpEl2 = document.getElementById("teamPoints");
    if (tpEl2) tpEl2.textContent = totalTeamPoints;

    // Construir y renderizar árbol
    const tree = await buildUnilevelTree(rootCode);
    renderTree(tree);
    updateStatsFromTree(tree);

    // Botón refresh
    document.getElementById("btnRefreshMap")?.addEventListener("click", async () => {
      await refreshTreeAndStats(rootCode, user.uid);
    });

    // Confirmar orden -> llama función server (ya existente en tu proyecto)
    document.getElementById("btnConfirmOrder")?.addEventListener("click", async () => {
      const orderId = document.getElementById("orderIdInput")?.value;
      if (!orderId) return alert("Debe seleccionar una orden");
      try {
        const token = await auth.currentUser.getIdToken();
        const resp = await fetch("/.netlify/functions/confirm-order", {
          method: "POST",
          headers: { "Authorization": "Bearer " + token },
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

    // Avatar
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
    if (changeAvatarBtn) changeAvatarBtn.addEventListener("click", () => {
      if (avatarGrid) avatarGrid.style.display = "grid";
      changeAvatarBtn.style.display = "none";
    });

    // Copy ref
    document.getElementById("copyRef")?.addEventListener("click", () => {
      const input = document.getElementById("refCode");
      if (!input) return;
      input.select();
      document.execCommand('copy');
      alert("Enlace copiado");
    });

    // Logout
    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      try {
        await signOut(auth);
        localStorage.removeItem("selectedAvatar");
        window.location.href = "../index.html";
      } catch (e) {
        console.error(e);
      }
    });

    // Dark mode
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
