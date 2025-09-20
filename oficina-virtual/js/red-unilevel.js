// oficina-virtual/js/distribuidor-dashboard.js
import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc, updateDoc, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------- Config ---------- */
const DEPTH_LIMIT = 5;
const FIELD_USUARIO = "usuario";
const FIELD_PATROCINADOR = "patrocinador";
const FIELD_HISTORY = "history";

/* ---------- Funciones ---------- */
function isActiveThisMonth(uData) {
  if (uData.active === true) return true;
  const hist = uData[FIELD_HISTORY];
  if (Array.isArray(hist)) {
    const now = new Date();
    for (const e of hist) {
      if (!e) continue;
      const action = (e.action || "").toLowerCase();
      const dateRaw = e.date || e.fecha || e.fechaCompra || e.fecha_recompra || e.createdAt;
      const d = dateRaw ? (typeof dateRaw.toDate === 'function' ? dateRaw.toDate() : new Date(dateRaw)) : null;
      if (d && /recompra|compra/i.test(action)) {
        if (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()) return true;
      }
    }
  }
  const alt = uData.ultimoRecompra || uData.lastRecompra || uData.lastPurchase;
  if (alt) {
    const d = alt ? (typeof alt.toDate === 'function' ? alt.toDate() : new Date(alt)) : null;
    if (d) {
      const now = new Date();
      if (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()) return true;
    }
  }
  return false;
}

async function buildUnilevelTree(rootCode, pageSize = 5) {
  const usuariosCol = collection(db, "usuarios");
  const qRoot = query(usuariosCol, where(FIELD_USUARIO, "==", rootCode));
  const rootSnap = await getDocs(qRoot);
  if (rootSnap.empty) throw new Error("No se encontró el usuario raíz: " + rootCode);
  const rootDoc = rootSnap.docs[0];
  const rootData = rootDoc.data();

  const rootNode = {
    id: rootDoc.id,
    usuario: rootData[FIELD_USUARIO],
    nombre: rootData.nombre || rootData[FIELD_USUARIO],
    active: isActiveThisMonth(rootData),
    puntos: rootData.puntos || 0,
    children: []
  };

  const qRootChildren = query(usuariosCol, where(FIELD_PATROCINADOR, "==", rootNode.usuario));
  const snapRootChildren = await getDocs(qRootChildren);
  const allRootChildren = snapRootChildren.docs.map(d => ({ id: d.id, ...d.data() }));
  rootNode.children = allRootChildren.slice(0, pageSize).map(d => ({
    id: d.id,
    usuario: d[FIELD_USUARIO],
    nombre: d.nombre || d[FIELD_USUARIO],
    active: isActiveThisMonth(d),
    puntos: d.puntos || 0,
    children: []
  }));

  let currentLevel = rootNode.children.slice();
  for (let level = 2; level <= DEPTH_LIMIT; level++) {
    if (!currentLevel.length) break;
    const nextLevel = [];
    for (const parent of currentLevel) {
      const q = query(usuariosCol, where(FIELD_PATROCINADOR, "==", parent.usuario));
      const snap = await getDocs(q);
      snap.forEach(d => {
        const data = d.data();
        const node = {
          id: d.id,
          usuario: data[FIELD_USUARIO],
          nombre: data.nombre || data[FIELD_USUARIO],
          active: isActiveThisMonth(data),
          puntos: data.puntos || 0,
          children: []
        };
        parent.children.push(node);
        nextLevel.push(node);
      });
    }
    currentLevel = nextLevel;
  }
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

/* ---------- UI ---------- */
function clearElement(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function renderTree(rootNode, pageSize) {
  const treeWrap = document.getElementById("treeWrap");
  clearElement(treeWrap);

  const levels = [];
  function gather(node, depth) {
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(node);
    if (depth + 1 < DEPTH_LIMIT && node.children?.length) {
      node.children.forEach(c => gather(c, depth + 1));
    }
  }
  gather(rootNode, 0);

  const maxPerLevel = Math.max(...levels.map(l => l.length || 0));
  const width = Math.max(900, maxPerLevel * 160);
  const height = Math.max(420, levels.length * 110);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  treeWrap.appendChild(svg);

  const nodePos = new Map();
  levels.forEach((lv, iy) => {
    const count = lv.length;
    const gap = width / (count + 1);
    lv.forEach((node, ix) => {
      const x = gap * (ix + 1);
      const y = 40 + iy * 100;
      nodePos.set(node.usuario, { x, y, node });
    });
  });

  // Enlaces
  levels.forEach((lv, iy) => {
    if (iy === 0) return;
    lv.forEach(child => {
      const parent = levels[iy - 1].find(p => p.children.some(c => c.usuario === child.usuario));
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

  // Nodos
  nodePos.forEach(({ x, y, node }) => {
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("transform", `translate(${x},${y})`);
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 28);
    if (node.usuario === rootNode.usuario) circle.setAttribute("fill", "#2b9df3");
    else circle.setAttribute("fill", node.active ? "#28a745" : "#cfcfcf");
    circle.setAttribute("stroke", "#fff");
    circle.setAttribute("stroke-width", "3");
    g.appendChild(circle);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("y", "6");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#fff");
    text.style.fontSize = "12px";
    text.textContent = node.usuario.length > 12 ? node.usuario.slice(0,10) + "…" : node.usuario;
    g.appendChild(text);

    g.addEventListener("click", () => showInfoCard(node));
    svg.appendChild(g);
  });

  // Pager root children
  const pager = document.getElementById("treePager");
  pager.innerHTML = "";
  const totalRootChildren = rootNode.childrenFull?.length || rootNode.children.length;
  if (totalRootChildren > pageSize) {
    const pages = Math.ceil(totalRootChildren / pageSize);
    for (let p = 0; p < pages; p++) {
      const btn = document.createElement("button");
      btn.className = p===0 ? "pager-btn active":"pager-btn";
      btn.textContent = `Página ${p+1}`;
      btn.onclick = () => {
        rootNode.children = rootNode.childrenFull.slice(p*pageSize, p*pageSize + pageSize);
        renderTree(rootNode, pageSize);
      };
      pager.appendChild(btn);
    }
  }

  // Actualizar stats
  updateStatsFromTree(rootNode);
}

/* ---------- Info Card ---------- */
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
  el.querySelector("#ic-close").addEventListener("click", ()=> el.style.display="none");
  el.querySelector("#ic-search").addEventListener("click", async ()=>{
    const userCode = el.dataset.usuario;
    if (!userCode) return;
    const pageSize = parseInt(document.getElementById("pageSize").value,10)||5;
    const tree = await buildUnilevelTree(userCode,pageSize);
    tree.childrenFull = tree.childrenFull || tree.children;
    renderTree(tree,pageSize);
    el.style.display="none";
  });
  return el;
}
const infoCard = createInfoCard();
function showInfoCard(node){
  const el = document.querySelector(".info-card");
  el.style.display = "block";
  el.dataset.usuario = node.usuario;
  el.querySelector("#ic-name").textContent = node.nombre || node.usuario;
  el.querySelector("#ic-user").textContent = "Código: "+node.usuario;
  el.querySelector("#ic-state").innerHTML = node.active?'<span style="color:#28a745">Activo</span>':'<span style="color:#666">Inactivo</span>';
  el.querySelector("#ic-points").textContent = node.puntos || 0;
}

/* ---------- Stats ---------- */
function updateStatsFromTree(treeRoot){
  const statFrontales = document.getElementById("statFrontales");
  const statTotal = document.getElementById("statTotal");
  const statRecompra = document.getElementById("statRecompra");
  const direct = treeRoot.childrenFull?.length || treeRoot.children.length;
  let total=0, activos=0;
  const q=[{node:treeRoot, depth:0}];
  while(q.length){
    const {node, depth} = q.shift();
    if(depth>0) total++;
    if(depth>0 && node.active) activos++;
    if(depth<DEPTH_LIMIT-1 && node.children?.length) node.children.forEach(c=>q.push({node:c, depth:depth+1}));
  }
  statFrontales.textContent = direct;
  statTotal.textContent = total;
  statRecompra.textContent = activos;
}

/* ---------- Auth + Init ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ window.location.href="/login.html"; return; }
  const userRef = doc(db,"usuarios",user.uid);
  const userSnap = await getDoc(userRef);
  let rootCode = null;
  if(userSnap.exists()){
    const d = userSnap.data();
    rootCode = d[FIELD_USUARIO] || d.usuario;
    document.getElementById("name").textContent = d.nombre || "";
    document.getElementById("email").textContent = d.email || user.email || "";
    document.getElementById("code").textContent = rootCode;
    document.getElementById("points").textContent = d.puntos || 0;
    document.getElementById("refCode").value = `${window.location.origin}/registro?ref=${rootCode}`;
  } else {
    rootCode = prompt("No se encontró código de usuario. Indique su código:");
    if(!rootCode) return;
  }

  const pageSize = parseInt(document.getElementById("pageSize").value,10)||5;
  const tree = await buildUnilevelTree(rootCode,pageSize);
  tree.children = (tree.childrenFull && tree.childrenFull.slice(0,pageSize)) || tree.children;
  renderTree(tree,pageSize);

  /* ---------- UI Hooks ---------- */
  document.getElementById("btnRefreshMap").addEventListener("click", async ()=>{
    const ps = parseInt(document.getElementById("pageSize").value,10)||5;
    const t = await buildUnilevelTree(rootCode, ps);
    t.children = (t.childrenFull && t.childrenFull.slice(0,ps)) || t.children;
    renderTree(t, ps);
  });

  // Avatar
  const profileImg = document.getElementById("profileImg");
  const avatarGrid = document.querySelector(".avatar-grid");
  const changeAvatarBtn = document.getElementById("changeAvatarBtn");
  const savedAvatar = localStorage.getItem("selectedAvatar");
  profileImg.src = savedAvatar || profileImg.src;
  document.querySelectorAll(".avatar-grid img").forEach(img=>{
    img.addEventListener("click", ()=>{
      const selected = `../images/avatars/${img.dataset.avatar}`;
      profileImg.src = selected;
      localStorage.setItem("selectedAvatar", selected);
      avatarGrid.style.display = "none";
      changeAvatarBtn.style.display = "inline-block";
    });
  });
  if(savedAvatar){ avatarGrid.style.display="none"; changeAvatarBtn.style.display="inline-block"; }
  if(changeAvatarBtn) changeAvatarBtn.addEventListener("click", ()=>{ avatarGrid.style.display="grid"; changeAvatarBtn.style.display="none"; });

  // Copiar referido
  document.getElementById("copyRef").addEventListener("click", ()=>{
    const input = document.getElementById("refCode");
    input.select();
    document.execCommand('copy');
    alert("Enlace copiado");
  });

  // Logout
  const logoutBtn = document.getElementById("logoutBtn");
  if(logoutBtn) logoutBtn.addEventListener("click", async ()=>{
    try{
      await signOut(auth);
      localStorage.removeItem("selectedAvatar");
      window.location.href = "../index.html";
    } catch(e){ console.error(e); }
  });

  // Modo oscuro
  const toggleDarkMode = document.getElementById("toggleDarkMode");
  if(toggleDarkMode){
    toggleDarkMode.addEventListener("click", ()=>{
      document.body.classList.toggle("dark");
      localStorage.setItem('theme', document.body.classList.contains('dark')?'dark':'light');
    });
    if(localStorage.getItem('theme')==='dark') document.body.classList.add('dark');
  }
});
