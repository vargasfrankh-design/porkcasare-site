import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
<<<<<<< HEAD
import { getFirestore, doc, setDoc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
=======
import { getFirestore, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function genCode(){ return 'Pork' + Math.random().toString(36).substring(2,8).toUpperCase(); }

// register
const regForm = document.getElementById('registerForm');
if(regForm){
  regForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const nombre = document.getElementById('nombre').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    try{
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;
      const code = genCode();
      await setDoc(doc(db,'usuarios',uid), { nombre, email, rol:'distribuidor', codigoReferido: code, puntos:0, createdAt: new Date().toISOString() });
      alert('Registro exitoso. Tu código: ' + code);
      window.location = 'login.html';
    }catch(err){ console.error(err); alert('Error registro: ' + (err.code||err.message)); }
  });
}

// login
const loginForm = document.getElementById('loginForm');
if(loginForm){
  loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    try{
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;
      const snap = await getDoc(doc(db,'usuarios',uid));
      if(!snap.exists()){ alert('Perfil no encontrado'); return; }
      const data = snap.data();
<<<<<<< HEAD
      
      // Verificar y asignar rol si no existe
      if (!data.rol) {
        console.log("Usuario sin rol detectado, asignando 'distribuidor' por defecto");
        await updateDoc(doc(db, "usuarios", uid), {
          rol: 'distribuidor'
        });
        console.log("Rol 'distribuidor' asignado correctamente");
        data.rol = 'distribuidor'; // Actualizar el objeto local
      }
      
=======
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
      if(data.rol === 'admin') window.location='admin.html'; else window.location='distribuidor.html';
    }catch(err){ console.error(err); alert('Error login: ' + (err.code||err.message)); }
  });
}
