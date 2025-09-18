// ===============================
// MANEJO DE DATOS DE USUARIO
// ===============================

// Datos iniciales (ejemplo)
const userData = {
  name: "Frankh Yhorcy",
  email: "frankh_yhorcy@outlook.com",
  code: "PKC-001",
  points: 120,
  referido: "PKC-001-FY",
  red: ["Camila", "Ángel", "Shirley", "Brigitte"],
  history: [
    { date: "2025-09-01", action: "Recompra realizada", amount: 60000 },
    { date: "2025-08-28", action: "Nuevo referido: Camila", amount: 0 },
    { date: "2025-08-20", action: "Ganaste puntos", amount: 50 }
  ]
};

// Mostrar datos en la interfaz
document.getElementById("name").textContent = userData.name;
document.getElementById("email").textContent = userData.email;
document.getElementById("code").textContent = userData.code;
document.getElementById("points").textContent = userData.points;
document.getElementById("refCode").value = userData.referido;

// ===============================
// FOTO DE PERFIL
// ===============================
const uploadPhoto = document.getElementById("uploadPhoto");
const profileImg = document.getElementById("profileImg");

uploadPhoto.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (ev) {
      profileImg.src = ev.target.result;
      localStorage.setItem("profilePhoto", ev.target.result);
    };
    reader.readAsDataURL(file);
  }
});

// Cargar foto guardada
const savedPhoto = localStorage.getItem("profilePhoto");
if (savedPhoto) {
  profileImg.src = savedPhoto;
}

// ===============================
// COPIAR CÓDIGO REFERIDO
// ===============================
document.getElementById("copyRef").addEventListener("click", () => {
  const refInput = document.getElementById("refCode");
  refInput.select();
  refInput.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(refInput.value);
  alert("¡Código copiado!");
});

// ===============================
// RED DE REFERIDOS
// ===============================
const redList = document.getElementById("redReferidos");
userData.red.forEach(ref => {
  const li = document.createElement("li");
  li.textContent = ref;
  redList.appendChild(li);
});

// ===============================
// HISTORIAL DE MOVIMIENTOS
// ===============================
const historyDiv = document.getElementById("history");
userData.history.forEach(entry => {
  const div = document.createElement("div");
  div.classList.add("entry");
  div.textContent = `${entry.date} - ${entry.action} ${entry.amount > 0 ? "($" + entry.amount + ")" : ""}`;
  historyDiv.appendChild(div);
});

// ===============================
// BOTÓN DE RECOMPRA
// ===============================
document.getElementById("btnRecompra").addEventListener("click", () => {
  alert("Has realizado una recompra de $60.000. ¡Felicidades!");
});

// ===============================
// MODO OSCURO
// ===============================
document.getElementById("toggleDarkMode").addEventListener("click", () => {
  document.body.classList.toggle("dark");
});

