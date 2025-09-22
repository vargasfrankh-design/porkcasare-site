/**
 * oficina-virtual/js/red-unilevel.js
 * Archivo actualizado y unificado.
 *
 * - Soporta documentos con `patrocinadorId` (doc.id) o `patrocinador` (username).
 * - Normaliza lectura de puntos: `puntos || personalPoints || 0`.
 * - calculateTeamPoints() es solo lectura (no sobrescribe).
 * - persistTeamPointsSafely(userId) opcional para guardar total con transacción (NO llamada automáticamente).
 * - UI: renderTree, info card, onAuthStateChanged y botones.
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
const FIELD_PATROCINADOR_ID = "patrocinadorId"; // se recomienda que contenga doc.id del sponsor

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

/* -------------------- HELPERS PARA CONSULTAS FLEXIBLES -------------------- */

// Utility: getChildrenForParent(node)
// Tries multiple strategies to find children:
// 1) patrocinadorId === parentDocId (preferred)
// 2) patrocinador === parent username (fallback for older docs)
async function getChildrenForParent(node) {
  const usuariosCol = collection(db, "usuarios");
  // 1) intentar por patrocinadorId === doc.id
  let q = query(usuariosCol, where(FIELD_PATROCINADOR_ID, "==", node.id));
  let snap = await getDocs(q);
  if (!snap.empty) return snap.docs;

  // 2) si no hay resultados, intentar por patrocinador === node.usuario (username/code)
  if (node.usuario) {
    q = query(usuariosCol, where("patrocinador", "==", node.usuario));
    snap = await getDocs(q);
    if (!snap.empty) return snap.docs;
  }

  // 3) No encontró nada
  return [];
}

/* -------------------- CONSTRUCCIÓN DEL ÁRBOL -------------------- */

/**
 * buildUnilevelTree(username)
 * - Busca el documento root por `usuario` (username).
 * - Construye recursivamente hasta DEPTH_LIMIT usando estrategias flexibles.
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
    puntos: Number(rootData.puntos || rootData.personalPoints || 0),
    teamPoints: Number(rootData.teamPoints || 0),
    children: []
  };

  async function addChildrenById(node, level = 1) {
    if (level > DEPTH_LIMIT) return;
    const childDocs = await getChildrenForParent(node);
    const children = childDocs.map(d => {
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
    node.children = children;
    // recursivamente agregar nietos
    for (const child of children) {
      await addChildrenById(child, level + 1);
    }
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

    // si no hay hijos por patrocinadorId, intentar fallback por patrocinador == username
    if (snap.empty) {
      // buscamos usuarios cuyo campo 'patrocinador' sea igual al username del uid
      // para esto debemos obtener el usuario con id uid y tomar su usuario (username)
      try {
        const parentSnap = await getDoc(doc(db, "usuarios", uid));
        if (parentSnap.exists()) {
          const parentData = parentSnap.data();
          const username = parentData?.usuario;
          if (username) {
            const q2 = query(usuariosCol, where("patrocinador", "==", username));
            const snap2 = await getDocs(q2);
            snap2.forEach(ds => {
              const data = ds.data();
              totalTeamPoints += Number(data.puntos || data.personalPoints || 0);
              queue.push(ds.id);
            });
            continue;
          }
        }
      } catch (e) {
        console.warn("Warning buscando fallback patrocinador por username:", e);
      }
    }

    snap.forEach(docSnap => {
      const d = docSnap.data();
      totalTeamPoints += Number(d.puntos || d.personalPoints || 0);
      queue.push(docSnap.id);
    });
  }

  return totalTeamPoints;
}

/**
 * persistTeamPointsSafely(userId)
 * - Transacción para persistir teamPoints = total calculado.
 * - Usar solo si decides guardar el total recalculado (DEBE ser llamada desde backend o admin endpoint).
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
      // centrar en caso de un solo elemento y distribuir cuando hay varios
      const x = lv.length === 1 ? 500 : (ix + 1) * (1000 / (lv.length + 1));
      const y = 60 + iy * 110;
      nodePos.set(node.usuario + ":" + (node.id || ""), { x, y, node });
    });
  });

  // Enlaces (paths)
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
    g.setAttribute("data-usuario", node.usuario || "");
    // mejorar interacción en móvil
    g.style.cursor = "pointer";
    g.style.touchAction = "manipulation";
    g.style.webkitTapHighlightColor = "transparent";

    // Hit area (ampliar target táctil) - invisible pero captura eventos
    const hit = document.createElementNS(svgNS, "circle");
    hit.setAttribute("r", 40); // target mayor para dedos
    hit.setAttribute("fill", "transparent");
    // dejar pointer-events en auto para que el elemento capture eventos pero no interfiera visualmente
    hit.setAttribute("pointer-events", "auto");
    g.appendChild(hit);

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 30);
    circle.setAttribute("fill", node.usuario === rootNode.usuario ? "#2b9df3" : node.active ? "#28a745" : "#bfbfbf");
    circle.setAttribute("stroke", "#ffffff");
    circle.setAttribute("stroke-width", "3");
    // evitar que el círculo capture directamente el pointer y desvíe event.target; dejamos que el grupo maneje la interacción
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

    // Manejo robusto de interacción: pointerup + click como fallback (NO passive:true)
    const handleSelect = (e) => {
      // Si el navegador hace gestos, prevenir comportamientos por defecto
      try { e.preventDefault(); } catch (err) { /* ignore */ }
      try { e.stopPropagation(); } catch (err) { /* ignore */ }
      // Llamar al info card con event para poder posicionarla cerca del toque
      showInfoCard(node, e);
    };
    // Usamos pointerup para detectar levantamiento del dedo/ratón. No usamos passive:true porque necesitamos preventDefault()
    g.addEventListener('pointerup', handleSelect);
    // fallback por compatibilidad
    g.addEventListener('click', handleSelect);

    svg.appendChild(g);
  });
}

/* -------------------- INFO CARD -------------------- */

function createInfoCard() {
  let el = document.querySelector(".info-card");
  if (!el) {
    el = document.createElement("div");
    el.className = "info-card";
    el.style.position = "fixed";
    // valores por defecto (se sobreescriben si posicionamos por evento)
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
      <p id="ic-user" class="small" style="margin:0 0 8px 0;color:#666;font-size:13px;"></p>
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

/**
 * showInfoCard(node, event)
 * - Acepta event opcional. Si event está presente, posiciona la tarjeta cerca del toque.
 */
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

  // Si recibimos evento con coordenadas, posicionar la card cerca del toque/click
  if (event && typeof event.clientX === "number" && typeof event.clientY === "number") {
    const margin = 8;
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const rectW = el.offsetWidth || 220;
    const rectH = el.offsetHeight || 140;
    // Intentamos posicionar a la derecha del toque, y ligeramente arriba (para no tapar el dedo)
    let left = event.clientX + margin;
    let top = event.clientY - rectH / 2;
    // Ajustes para no salirse del viewport
    if (left + rectW > vw - margin) left = vw - rectW - margin;
    if (left < margin) left = margin;
    if (top + rectH > vh - margin) top = vh - rectH - margin;
    if (top < margin) top = margin;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = "auto";
  } else {
    // fallback a la posición por defecto (right/top)
    el.style.right = "20px";
    el.style.left = "auto";
    el.style.top = "80px";
  }
}

/* -------------------- LECTURA Y RENDERIZADO SEGURO DE PUNTOS -------------------- */

/**
 * readAndRenderPoints(userId)
 * - LEE personalPoints/puntos y teamPoints desde Firestore (NO escribe)
 * - Actualiza DOM (#points, #teamPoints, #activationAlert)
 * - Si no existe teamPoints persistido, calcula en memoria para mostrar (NO persiste)
 */
async function readAndRenderPoints(userId) {
  try {
    if (!userId) return;
    const uRef = doc(db, "usuarios", userId);
    const uSnap = await getDoc(uRef);
    if (!uSnap.exists()) {
      // limpiar UI si el usuario no existe
      const pointsEl = document.getElementById("points");
      if (pointsEl) pointsEl.textContent = "0";
      const tpEl = document.getElementById("teamPoints");
      if (tpEl) tpEl.textContent = "-";
      const alertEl = document.getElementById("activationAlert");
      if (alertEl) alertEl.style.display = "block";
      return;
    }
    const d = uSnap.data();
    // Preferir personalPoints, fallback a puntos
    const personal = Number(d.personalPoints ?? d.puntos ?? 0);

    // Preferir teamPoints persistido (si existe). Si no, intentar calcular en memoria SOLO para mostrar.
    let teamPersisted = (typeof d.teamPoints === "number") ? d.teamPoints : null;
    if (teamPersisted === null) {
      try {
        teamPersisted = await calculateTeamPoints(userId);
      } catch (e) {
        console.warn("No se pudo calcular teamPoints en cliente:", e);
        teamPersisted = 0;
      }
    }

    // Actualizar DOM
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

/**
 * refreshTreeAndStats(rootCode, userId)
 * - Reconstruye árbol y actualiza stats.
 * - NO persiste teamPoints ni personalPoints desde el cliente.
 * - Solo muestra valores leídos/calculados para evitar sobrescrituras.
 */
async function refreshTreeAndStats(rootCode, userId) {
  const tree = await buildUnilevelTree(rootCode);
  renderTree(tree);
  updateStatsFromTree(tree);
  // lee y renderiza puntos de forma segura (NO sobrescribe la BD)
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

    // Datos básicos en UI (comprobaciones seguras)
    const nameEl = document.getElementById("name");
    if (nameEl) nameEl.textContent = d.nombre || "";

    const emailEl = document.getElementById("email");
    if (emailEl) emailEl.textContent = d.email || user.email || "";

    const codeEl = document.getElementById("code");
    if (codeEl) codeEl.textContent = rootCode;

    // En lugar de recalcular/persistir, LEEMOS y mostramos lo que está en Firestore
    const pointsEl = document.getElementById("points");
    if (pointsEl) pointsEl.textContent = String(d.personalPoints ?? d.puntos ?? 0);

    const refCodeEl = document.getElementById("refCode");
    if (refCodeEl) refCodeEl.value = `${window.location.origin}/registro?ref=${rootCode}`;

    // Mostrar alerta de activación si aplica
    const alertEl = document.getElementById("activationAlert");
    if (alertEl) alertEl.style.display = (Number(d.personalPoints ?? d.puntos ?? 0) < 50 && !d.initialPackBought) ? "block" : "none";

    // Puntos personales (evento) - sigue calculando desde history para compatibilidad de evento
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

    // Mostrar teamPoints: preferir valor persistido; si no existe, calcular solo para mostrar (NO persistir)
    if (typeof d.teamPoints === "number") {
      const tpEl2 = document.getElementById("teamPoints");
      if (tpEl2) tpEl2.textContent = String(d.teamPoints);
    } else {
      // calcular en memoria y mostrar (NO persistir)
      try {
        const totalTeamPoints = await calculateTeamPoints(user.uid);
        const tpEl2 = document.getElementById("teamPoints");
        if (tpEl2) tpEl2.textContent = String(totalTeamPoints);
      } catch (e) {
        console.warn("No se pudo calcular teamPoints para mostrar:", e);
      }
    }

    // Construir y renderizar árbol
    const tree = await buildUnilevelTree(rootCode);
    renderTree(tree);
    updateStatsFromTree(tree);

    // Botón refresh
    const btnRefresh = document.getElementById("btnRefreshMap");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", async () => {
        await refreshTreeAndStats(rootCode, user.uid);
      });
    }

    // Confirmar orden -> llama función server
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
          // REFRESH: reconstruir árbol y leer puntos desde Firestore (NO escribir)
          await refreshTreeAndStats(rootCode, user.uid);
        } catch (err) {
          console.error(err);
          alert("Error al confirmar la orden");
        }
      });
    }

    // Avatar handling (safe checks)
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

    // Copy ref
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

    // Logout
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
