// src/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Configuración de Firebase usando variables de entorno de Netlify

const firebaseConfig = {
  apiKey: "AIzaSyAjj3AluF19BBbPfafimJoK7SJbdMrvhWY",
  authDomain: "porkcasare-915ff.firebaseapp.com",
  projectId: "porkcasare-915ff",
  storageBucket: "porkcasare-915ff.firebasestorage.app",
  messagingSenderId: "147157887309",
  appId: "1:147157887309:web:5c6db76a20474f172def04",
  measurementId: "G-X0DJ5Y1S6X"
};

// Exportar la config para usarla en main.js u otros archivos
export default firebaseConfig;

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
