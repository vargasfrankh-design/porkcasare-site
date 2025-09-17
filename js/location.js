document.addEventListener("DOMContentLoaded", () => {
  const countrySelect = document.getElementById("pais");
  const provinceSelect = document.getElementById("provincia");
  const citySelect = document.getElementById("ciudad");

  // Forzamos país = Colombia
  countrySelect.innerHTML = `<option value="Colombia" selected>Colombia</option>`;
  countrySelect.disabled = true;

  // Cargamos Casanare
  fetch("data/colombia.json")
    .then(response => response.json())
    .then(data => {
      // Solo Casanare
      provinceSelect.innerHTML = `<option value="Casanare" selected>Casanare</option>`;
      provinceSelect.disabled = true;

      // Ciudades
      const cities = data["Casanare"];
      citySelect.innerHTML = "<option value=''>Seleccione ciudad</option>";
      cities.forEach(city => {
        let option = document.createElement("option");
        option.value = city;
        option.textContent = city;
        citySelect.appendChild(option);
      });
    });
});
