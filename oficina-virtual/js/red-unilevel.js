import { auth, db } from "/src/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const DEPTH_LIMIT = 6;
const FIELD_USUARIO = "usuario";
const FIELD_PATROCINADOR = "patrocinador";
const FIELD_HISTORY = "history";

// -------------------- UTILIDADES --------------------
function isActiveThisMonth(uData) {
  const hist = uData[FIELD_HISTORY];
  if (Array.isArray(hist)) {
    const now = new Date();
    for (const e of hist) {
      if (!e) continue;
      const action = (e.action || "").toLowerCase();
      const dateRaw = e.date || e.fechaCompra || e.fecha_recompra || e.createdAt;
      const d = dateRaw ? (typeof dateRaw.toDate === 'function' ? dateRaw.toDate() : new Date(dateRaw)) : null;
      if (d && /recompra|compra/i.test(action)) {
        if (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()) return true;
      }
    }
  }
  return !!uData.active;
}

function clearElement(el) { while (el.firstChild) el.removeChild(el.firstChild); }

// -------------------- ÁRBOL UNILEVEL --------------------
async function buildUnilevelTree(rootCode) {
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

  async function addChildren(node, level = 1) {
    if (level > DEPTH_LIMIT) return;
    const qChildren = query(usuariosCol, where(FIELD_PATROCINADOR, "==", node.usuario));
    const snap = await getDocs(qChildren);
    const childrenNodes = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        usuario: data[FIELD_USUARIO],
        nombre: data.nombre || data[FIELD_USUARIO],
        active: isActiveThisMonth(data),
        puntos: data.puntos || 0,
        children: []
      };
    });
    node.children = childrenNodes;
    for (const child of childrenNodes) await addChildren(child, level + 1);
  }

  await addChildren(rootNode, 1);
  return rootNode;
}

// -------------------- PUNTOS DE EQUIPO --------------------
async function calculateTeamPoints(userId) {
  let totalTeamPoints = 0;
  const queue = [userId];
  const visited = new Set();

  while (queue.length) {
    const uid = queue.shift();
    if (visited.has(uid)) continue;
    visited.add(uid);

    const q = query(collection(db, "usuarios"), where("patrocinadorId", "==", uid));
    const snap = await getDocs(q);
    snap.forEach(docSnap => {
      const d = docSnap.data();
      totalTeamPoints += d.puntos || 0;
      queue.push(docSnap.id);
    });
  }

  const userRef = doc(db, "usuarios", userId);
  await updateDoc(userRef, { teamPoints: totalTeamPoints });
  return totalTeamPoints;
}

// -------------------- RENDER ÁRBOL --------------------
function renderTree(rootNode) {
  const treeWrap = document.getElementById("treeWrap");
  clearElement(treeWrap);
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
      const y = 50 + iy * 100;
      nodePos.set(node.usuario, { x, y, node });
    });
  });

  levels.forEach((lv, iy) => {
    if (iy === 0) return;
    lv.forEach(child => {
      const parent = levels[iy - 1].find(p => p.children.some(c => c.usuario === child.usuario));
      if (parent) {
        const ppos = nodePos.get(parent.usuario);
        const cpos = nodePos.get(child.usuario);
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", `M${ppos.x},${ppos.y+26} C ${ppos.x},${(ppos.y+cpos.y)/2} ${cpos.x},${(ppos.y+cpos.y)/2} ${cpos.x},${cpos.y-26}`);
        path.setAttribute("stroke", "#ccc");
        path.setAttribute("fill", "transparent");
        svg.appendChild(path);
      }
    });
  });

  nodePos.forEach(({ x, y, node }) => {
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("transform", `translate(${x},${y})`);
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 28);
    circle.setAttribute("fill", node.usuario === rootNode.usuario ? "#2b9df3" : node.active ? "#28a745" : "#cfcfcf");
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

  updateStatsFromTree(rootNode);
}

function updateStatsFromTree(rootNode){
  const statFrontales = document.getElementById("statFrontales");
  const statTotal = document.getElementById("statTotal");
  const statRecompra = document.getElementById("statRecompra");

  let total=0, activos=0;
  const q=[{node:rootNode, depth:0}];
  while(q.length){
    const {node, depth} = q.shift();
    if(depth>0) total++;
    if(depth>0 && node.active) activos++;
    if(node.children?.length) node.children.forEach(c=>q.push({node:c, depth:depth+1}));
  }
  statFrontales.textContent = rootNode.children?.length || 0;
  statTotal.textContent = total;
  statRecompra.textContent = activos;
}

// -------------------- INFO CARD --------------------
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
    const tree = await buildUnilevelTree(userCode);
    renderTree(tree);
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

// -------------------- REFRESH TREE & TEAM --------------------
async function refreshTreeAndStats(rootCode, userId){
  const tree = await buildUnilevelTree(rootCode);
  renderTree(tree);
  const totalTeamPoints = await calculateTeamPoints(userId);
  document.getElementById("teamPoints").textContent = totalTeamPoints;
}

// -------------------- LOGIN STATE --------------------
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

    const alertEl = document.getElementById("activationAlert");
    if(alertEl){ alertEl.style.display = (d.puntos < 50 && !d.initialPackBought) ? "block" : "none"; }

    const totalTeamPoints = await calculateTeamPoints(user.uid);
    document.getElementById("teamPoints").textContent = totalTeamPoints;

    const tree = await buildUnilevelTree(rootCode);
    renderTree(tree);

    // -------------------- BOTÓN REFRESH MAP --------------------
    document.getElementById("btnRefreshMap")?.addEventListener("click", async ()=>{
      await refreshTreeAndStats(rootCode, user.uid);
    });

    // -------------------- BOTÓN CONFIRMAR ORDEN --------------------
    document.getElementById("btnConfirmOrder")?.addEventListener("click", async ()=>{
      const orderId = document.getElementById("orderIdInput").value;
      if(!orderId) return alert("Debe seleccionar una orden");
      const token = await auth.currentUser.getIdToken();

      try{
        const resp = await fetch("/.netlify/functions/confirm-order", {
          method: "POST",
          headers: { "Authorization": "Bearer " + token },
          body: JSON.stringify({ orderId, action: "confirm" })
        });
        const data = await resp.json();
        alert(data.message || "Orden confirmada");
        await refreshTreeAndStats(rootCode, user.uid);
      }catch(e){
        console.error(e);
        alert("Error al confirmar la orden");
      }
    });

    // -------------------- AVATAR --------------------
    const profileImg = document.getElementById("profileImg");
    const avatarGrid = document.querySelector(".avatar-grid");
    const changeAvatarBtn = document.getElementById("changeAvatarBtn");
    const savedAvatar = localStorage.getItem("selectedAvatar");
    if(savedAvatar) { profileImg.src = savedAvatar; avatarGrid.style.display="none"; changeAvatarBtn.style.display="inline-block"; }
    document.querySelectorAll(".avatar-grid img").forEach(img=>{
      img.addEventListener("click", ()=>{
        const selected = `../images/avatars/${img.dataset.avatar}`;
        profileImg.src = selected;
        localStorage.setItem("selectedAvatar", selected);
        avatarGrid.style.display = "none";
        changeAvatarBtn.style.display="inline-block";
      });
    });
    changeAvatarBtn?.addEventListener("click", ()=>{ avatarGrid.style.display="grid"; changeAvatarBtn.style.display="none"; });

    // -------------------- COPY REF --------------------
    document.getElementById("copyRef")?.addEventListener("click", ()=>{
      const input = document.getElementById("refCode");
      input.select();
      document.execCommand('copy');
      alert("Enlace copiado");
    });

    // -------------------- LOGOUT --------------------
    document.getElementById("logoutBtn")?.addEventListener("click", async ()=>{
      try{ await signOut(auth); localStorage.removeItem("selectedAvatar"); window.location.href = "../index.html"; } catch(e){ console.error(e); }
    });

    // -------------------- DARK MODE --------------------
    const toggleDarkMode = document.getElementById("toggleDarkMode");
    if(toggleDarkMode){
      toggleDarkMode.addEventListener("click", ()=>{
        document.body.classList.toggle("dark");
        localStorage.setItem('theme', document.body.classList.contains('dark')?'dark':'light');
      });
      if(localStorage.getItem('theme')==='dark') document.body.classList.add('dark');
    }
  }
});
