// js/productos.js

const productos = [
  {
    nombre: "Pack Inicial",
    descripcion: "Incluye productos básicos para comenzar.",
    imagen: "../images/productos/pack-inicial.jpg",
    precio: 59.99
  },
  {
    nombre: "Vitaminas Naturales",
    descripcion: "Suplementos de alta calidad para tu bienestar.",
    imagen: "../images/productos/vitaminas.jpg",
    precio: 29.99
  },
  {
    nombre: "Proteína de Cerdo",
    descripcion: "Alta en proteína, ideal para atletas.",
    imagen: "../images/productos/proteina.jpg",
    precio: 39.99
  },
  {
    nombre: "Combo Salud",
    descripcion: "Combo de productos seleccionados por expertos.",
    imagen: "../images/productos/combo-salud.jpg",
    precio: 79.99
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
