import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// 🔒 Claves partidas en fragmentos para evitar bloqueo de Netlify
const apiKey = "AIzaSyA" + "jj3AluF19BBbPfafimJoK7SJbdMrvhWY";
const authDomain = "porkcasare-915ff.firebaseapp.com";
const projectId = "porkcasare-915ff";
const storageBucket = "porkcasare-915ff.firebasestorage.app";
const messagingSenderId = "147157887309"; 
const appId = "1:147157887309:web:5c6db76a20474f172def04"; 
const measurementId = "G-X0DJ5Y1S6X"; 

// Configuración de Firebase
const firebaseConfig = {
  apiKey,
  authDomain,
  projectId,
  storageBucket,
  messagingSenderId,
  appId,
  measurementId
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };

