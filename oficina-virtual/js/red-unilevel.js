// oficina-virtual/js/red-unilevel.js
// Módulo que crea un mapa unilevel (hasta 5 niveles) leyendo de /usuarios en Firestore
import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------- Ajusta si tus campos tienen otros nombres ---------- */
const FIELD_USUARIO = "usuario";
const FIELD_PATROCINADOR = "patrocinador";
const FIELD_HISTORY = "history"; // arreglo con entradas { action, date } recomendable
/* ---------------------------------------------------------------- */

const DEPTH_LIMIT = 5;

function isActiveThisMonth(uData) {
  // 1) Si hay bandera explícita (opcional)
  if (uData.active === true) return true;

  // 2) Buscar fechas de recompra en history
  const hist = uData[FIELD_HISTORY];
  if (Array.isArray(hist)) {
    const now = new Date();
    for (const e of hist) {
      if (!e) continue;
      const action = (e.action || "").toString().toLowerCase();
      const dateRaw = e.date || e.fecha || e.fechaCompra || e.fecha_recompra || e.createdAt;
      if (/recompra|re-?compra|compra/i.test(action)) {
        // parsear fecha
        const d = (typeof dateRaw === "string" || typeof dateRaw === "number") ? new Date(dateRaw) : (dateRaw && dateRaw.toDate ? dateRaw.toDate() : null);
        if (d) {
          if (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()) {
            return true;
          }
        }
      }
    }
  }

  // 3) Campos alternativos: ultimoRecompra, lastRecompra, monthly
  const alt = uData.ultimoRecompra || uData.lastRecompra || uData.lastPurchase;
  if (alt) {
    const d = (typeof alt === "string" || typeof alt === "number") ? new Date(alt) : (alt && alt.toDate ? alt.toDate() : null);
    if (d) {
      const now = new Date();
      if (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()) return true;
    }
  }

  return false;
}

// Construye árbol unilevel (BFS rápido). pageSize aplica solo a hijos directos del root (paginación simple)
async function buildUnilevelTree(rootCode, pageSize = 5) {
  const usuariosCol = collection(db, "usuarios");

  // obtener doc raíz por campo usuario
  const qRoot = query(usuariosCol, where(FIELD_USUARIO, "==", rootCode));
  const rootSnap = await getDocs(qRoot);
  if (rootSnap.empty) throw new Error("No se encontró el usuario raíz: " + rootCode);
  const rootDoc = rootSnap.docs[0];
  const rootData = rootDoc.data();
  const rootNode = {
    id: rootDoc.id,
    usuario: rootData[FIELD_USUARIO] || rootCode,
    nombre: rootData.nombre || (rootData.usuario || rootCode),
    active: isActiveThisMonth(rootData),
    puntos: rootData.puntos || 0,
    children: []
  };

  // obtener todos los frontales del root (para paginar)
  const qRootChildren = query(usuariosCol, where(FIELD_PATROCINADOR, "==", rootNode.usuario));
  const snapRootChildren = await getDocs(qRootChildren);
  const allRootChildren = snapRootChildren.docs.map(d => ({ id: d.id, ...d.data() }));

  // paginar root children
  rootNode.children = allRootChildren.slice(0, pageSize).map(d => ({
    id: d.id,
    usuario: d[FIELD_USUARIO],
    nombre: d.nombre || d[FIELD_USUARIO],
    active: isActiveThisMonth(d),
    puntos: d.puntos || 0,
    children: []
  }));

  // BFS para niveles 2..DEPTH_LIMIT
  let currentLevel = rootNode.children.slice(); // copiar
  for (let level = 2; level <= DEPTH_LIMIT; level++) {
    if (currentLevel.length === 0) break;
    const nextLevel = [];
    // Para cada nodo del nivel actual, obtener sus hijos (todos)
    for (const parent of currentLevel) {
      const q = query(usuariosCol, where(FIELD_PATROCINADOR, "==", parent.usuario));
      const snap = await getDocs(q);
      if (!snap.empty) {
        for (const d of snap.docs) {
          const data = d.data();
          const node = {
            id: d.id,
            usuario: data[FIELD_USUARIO] || data.usuario,
            nombre: data.nombre || data[FIELD_USUARIO] || data.usuario,
            active: isActiveThisMonth(data),
            puntos: data.puntos || 0,
            children: []
          };
          parent.children.push(node);
          nextLevel.push(node);
        }
      }
    }
    currentLevel = nextLevel;
  }

  // Guardamos la lista completa de children directos para manejo de paginación
  rootNode.childrenFull = allRootChildren.map(d => ({
    id: d.id,
    usuario: d[FIELD_USUARIO],
    nombre: d.nombre || d[FIELD_USUARIO],
    active: isActiveThisMonth(d),
    puntos: d.puntos || 0,
    children: []
  }));

  return rootNode;
}

// RENDER con D3 — similar a demo anterior (dibujo simple, nodos estáticos)
function clearElement(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function renderTree(rootNode, pageSize) {
  const treeWrap = document.getElementById("treeWrap");
  clearElement(treeWrap);

  // preparar niveles
  const levels = [];
  function gather(node, depth) {
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(node);
    if (depth + 1 < DEPTH_LIMIT && node.children && node.children.length) {
      for (const c of node.children) gather(c, depth + 1);
    }
  }
  gather(rootNode, 0);

  // calcular tamaño SVG
  const maxPerLevel = Math.max(...levels.map(l => l.length || 0));
  const width = Math.max(900, maxPerLevel * 160);
  const height = Math.max(420, levels.length * 110);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.style.display = "block";
  treeWrap.appendChild(svg);

  // calcular posiciones
  const nodePos = new Map();
  levels.forEach((lv, iy) => {
    const count = lv.length;
    const gap = width / (count + 1);
    lv.forEach((node, ix) => {
      const x = gap * (ix + 1);
      const y = 40 + iy * 100;
      nodePos.set(node.usuario, { x, y, node, depth: iy });
    });
  });

  // dibujar enlaces
  levels.forEach((lv, iy) => {
    if (iy === 0) return;
    lv.forEach(child => {
      // buscar padre en nivel anterior
      const pLevel = levels[iy - 1] || [];
      let parent = null;
      for (const p of pLevel) {
        if (p.children && p.children.some(c => c.usuario === child.usuario)) { parent = p; break; }
      }
      if (parent) {
        const ppos = nodePos.get(parent.usuario);
        const cpos = nodePos.get(child.usuario);
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", `M${ppos.x},${ppos.y+26} C ${ppos.x},${(ppos.y+cpos.y)/2} ${cpos.x},${(ppos.y+cpos.y)/2} ${cpos.x},${cpos.y-26}`);
        path.setAttribute("class", "link-line");
        svg.appendChild(path);
      }
    });
  });

  // dibujar nodos
  nodePos.forEach((v, key) => {
    const { x, y, node } = v;
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("transform", `translate(${x},${y})`);
    g.setAttribute("data-usuario", node.usuario);
    g.setAttribute("style", "cursor:pointer");

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 28);

    if (node.usuario === rootNode.usuario) {
      circle.setAttribute("fill", "#2b9df3");
      circle.setAttribute("class", "node-root");
    } else if (node.active) {
      circle.setAttribute("fill", "#28a745");
      circle.setAttribute("class", "node-active");
    } else {
      circle.setAttribute("fill", "#cfcfcf");
      circle.setAttribute("class", "node-inactive");
    }
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", "3");
    g.appendChild(circle);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("y", "6");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#fff");
    text.style.fontSize = "12px";
    const label = node.usuario.length > 12 ? node.usuario.slice(0, 10) + "…" : node.usuario;
    text.textContent = label;
    g.appendChild(text);

    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      showInfoCard(node);
    });

    svg.appendChild(g);
  });

  // render pager si aplica (solo para root children)
  const pager = document.getElementById("treePager");
  pager.innerHTML = "";
  const totalRootChildren = rootNode.childrenFull ? rootNode.childrenFull.length : (rootNode.children ? rootNode.children.length : 0);
  if (totalRootChildren > pageSize) {
    const pages = Math.ceil(totalRootChildren / pageSize);
    for (let p = 0; p < pages; p++) {
      const btn = document.createElement("button");
      btn.className = (p === 0) ? "pager-btn active" : "pager-btn";
      btn.textContent = `Página ${p + 1}`;
      btn.onclick = () => {
        const start = p * pageSize;
        rootNode.children = rootNode.childrenFull.slice(start, start + pageSize);
        renderTree(rootNode, pageSize);
      };
      pager.appendChild(btn);
    }
  }

  // actualizar contadores (llama a la función global)
  updateStatsFromTree(rootNode);
}

// Crear / mostrar tarjeta info
function createInfoCard() {
  let el = document.querySelector(".info-card");
  if (!el) {
    el = document.createElement("div");
    el.className = "info-card";
    el.innerHTML = `
      <h3 id="ic-name"></h3>
      <p id="ic-user" class="small"></p>
      <p><strong>Estado:</strong> <span id="ic-state"></span></p>
      <p><strong>Puntos:</strong> <span id="ic-points"></span></p>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="ic-search" class="btn">Buscar</button>
        <button id="ic-close" class="btn">Cerrar</button>
      </div>
    `;
    document.body.appendChild(el);
  }
  el.querySelector("#ic-close").addEventListener("click", () => el.style.display = "none");
  el.querySelector("#ic-search").addEventListener("click", async () => {
    const userCode = el.dataset.usuario;
    if (!userCode) return;
    try {
      const pageSize = parseInt(document.getElementById("pageSize").value, 10) || 5;
      const tree = await buildUnilevelTree(userCode, pageSize);
      // guardar childrenFull del nuevo root si existe
      tree.childrenFull = tree.childrenFull || tree.children;
      renderTree(tree, pageSize);
    } catch (e) {
      alert("Error al buscar la red: " + e.message);
    }
    el.style.display = "none";
  });
  return el;
}
const infoCard = createInfoCard();

function showInfoCard(node) {
  const el = document.querySelector(".info-card");
  el.style.display = "block";
  el.dataset.usuario = node.usuario;
  el.querySelector("#ic-name").textContent = node.nombre || node.usuario;
  el.querySelector("#ic-user").textContent = "Código: " + node.usuario;
  el.querySelector("#ic-state").innerHTML = node.active ? '<span style="color:#28a745">Activo</span>' : '<span style="color:#666">Inactivo</span>';
  el.querySelector("#ic-points").textContent = node.puntos || 0;
}

// stats desde el árbol
function updateStatsFromTree(treeRoot) {
  const statFrontales = document.getElementById("statFrontales");
  const statTotal = document.getElementById("statTotal");
  const statRecompra = document.getElementById("statRecompra");

  const direct = (treeRoot.childrenFull ? treeRoot.childrenFull.length : (treeRoot.children ? treeRoot.children.length : 0));

  let total = 0;
  let activos = 0;
  const q = [{ node: treeRoot, depth: 0 }];
  while (q.length) {
    const { node, depth } = q.shift();
    if (depth > 0) total++;
    if (node.active && depth > 0) activos++;
    if (depth < DEPTH_LIMIT - 1 && node.children) {
      for (const c of node.children) q.push({ node: c, depth: depth + 1 });
    }
  }

  statFrontales.textContent = direct;
  statTotal.textContent = total;
  statRecompra.textContent = activos;
}

// ---- UI + auth wiring ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    console.warn("Usuario no autenticado — red-unilevel requiere sesión.");
    return;
  }

  try {
    // Buscar documento del usuario por UID (tu base store usa doc id = uid)
    const userDocRef = doc(db, "usuarios", user.uid);
    const userSnap = await getDoc(userDocRef);
    let rootCode = null;
    if (userSnap.exists()) {
      const d = userSnap.data();
      rootCode = d[FIELD_USUARIO] || d.usuario || d.email;
      // mostrar info básica en UI (nombre, email, code, puntos)
      document.getElementById("name").textContent = d.nombre || "";
      document.getElementById("email").textContent = d.email || user.email || "";
      document.getElementById("code").textContent = d[FIELD_USUARIO] || d.usuario || "";
      document.getElementById("points").textContent = d.puntos || 0;
      document.getElementById("refCode").value = `${window.location.origin}/registro?ref=${d[FIELD_USUARIO] || d.usuario || ""}`;
    } else {
      // fallback: buscar por email
      const usuariosCol = collection(db, "usuarios");
      const q = query(usuariosCol, where("email", "==", user.email || ""));
      const snaps = await getDocs(q);
      if (!snaps.empty) {
        const d = snaps.docs[0].data();
        rootCode = d[FIELD_USUARIO] || d.usuario;
      }
    }

    if (!rootCode) {
      rootCode = prompt("No se encontró código (usuario) en su doc. Indique su código de usuario:");
      if (!rootCode) return;
    }

    // build inicial y render
    const pageSize = parseInt(document.getElementById("pageSize").value, 10) || 5;
    const tree = await buildUnilevelTree(rootCode, pageSize);
    // attach full children list (ya lo hace la función)
    // slice inicial
    tree.children = (tree.childrenFull && tree.childrenFull.slice(0, pageSize)) || tree.children;
    renderTree(tree, pageSize);

    // hooks UI
    document.getElementById("btnRefreshMap").addEventListener("click", async () => {
      const ps = parseInt(document.getElementById("pageSize").value, 10) || 5;
      const t = await buildUnilevelTree(rootCode, ps);
      t.children = (t.childrenFull && t.childrenFull.slice(0, ps)) || t.children;
      renderTree(t, ps);
    });

    // avatar selection: guardamos en localStorage (no subimos a Firestore para evitar costos)
    const profileImg = document.getElementById("profileImg");
    const avatarGrid = document.querySelector(".avatar-grid");
    const changeAvatarBtn = document.getElementById("changeAvatarBtn");
    const savedAvatar = localStorage.getItem("selectedAvatar");
    profileImg.src = savedAvatar || profileImg.src;

    document.querySelectorAll(".avatar-grid img").forEach(img => {
      img.addEventListener("click", () => {
        const selected = `../images/avatars/${img.dataset.avatar}`;
        profileImg.src = selected;
        localStorage.setItem("selectedAvatar", selected);
        avatarGrid.style.display = "none";
        changeAvatarBtn.style.display = "inline-block";
      });
    });

    if (savedAvatar) { avatarGrid.style.display = "none"; changeAvatarBtn.style.display = "inline-block"; }
    if (changeAvatarBtn) changeAvatarBtn.addEventListener("click", () => { avatarGrid.style.display = "grid"; changeAvatarBtn.style.display = "none"; });

    // copy referido
    document.getElementById("copyRef").addEventListener("click", () => {
      const input = document.getElementById("refCode");
      input.select();
      document.execCommand('copy');
      alert("Enlace copiado");
    });

    // logout
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", async () => {
      try {
        await auth.signOut();
        localStorage.removeItem("selectedAvatar");
        window.location.href = "../index.html";
      } catch (err) {
        console.error("Error logout:", err);
      }
    });

    // modo oscuro
    const toggleDarkMode = document.getElementById("toggleDarkMode");
    if (toggleDarkMode) {
      toggleDarkMode.addEventListener("click", () => {
        document.body.classList.toggle("dark");
        localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
      });
      if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
    }

  } catch (err) {
    console.error("Error construyendo red:", err);
    alert("Error cargando la red: " + (err.message || err));
  }
});
