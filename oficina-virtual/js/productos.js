// js/productos.js

const productos = [
  {
    nombre: "Paquete Inicial – 15 kg",
    descripcion: "Disfruta de la mejor selección de carne porcina empacada al vacío, lista para tu cocina. Este paquete incluye 15 kilos combinados de chuletas, costillas y paticas, ideal para familias o reuniones. Carne fresca, de calidad y lista para conservar o preparar.",
    imagen: "../images/productos/pack-inicial.jpg",
    precio: 300000
    puntos: 10 Bv
  },
  {
    nombre: "Chuletas – 3 kg",
    descripcion: "Chuletas de cerdo frescas y jugosas, empacadas al vacío para mantener su sabor y frescura. Perfectas para asar, freír o preparar en tus recetas favoritas.",
    imagen: "../images/productos/vitaminas.jpg",
    precio: 60000
  },
  {
    nombre: "Costillitas – 3 kg",
    descripcion: "Costillitas tiernas y llenas de sabor, listas para hornear, asar o guisar. Empacadas al vacío para conservar toda su frescura y calidad.",
    imagen: "../images/productos/proteina.jpg",
    precio: 60000
  },
  {
    nombre: "Paticas o Pezuñitas – 3 kg",
    descripcion: "Paticas o pezonitas de cerdo, perfectas para caldos, guisos o preparaciones tradicionales. Empacadas al vacío para garantizar su frescura y sabor auténtico.",
    imagen: "../images/productos/combo-salud.jpg",
    precio: 60000
  }
];

function renderProductos() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  grid.innerHTML = productos.map(prod => `
    <div class="product-card">
      <img src="${prod.imagen}" alt="${prod.nombre}">
      <h4>${prod.nombre}</h4>
      <p>${prod.descripcion}</p>
      <p><strong>$${prod.precio.toFixed(2)}</strong></p>
      <button class="btn small">Comprar</button>
    </div>
  `).join("");
}

document.addEventListener("DOMContentLoaded", renderProductos);
