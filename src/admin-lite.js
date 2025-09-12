import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

onAuthStateChanged(auth, async user=>{
  if(!user) return window.location='login.html';
  const snap = await getDocs(collection(db,'usuarios'));
  const ul = document.getElementById('usersList');
  ul.innerHTML='';
  snap.forEach(doc=>{ const u=doc.data(); const li=document.createElement('li'); li.innerText=(u.nombre||'')+' - '+(u.email||'')+' - Puntos: '+(u.puntos||0); ul.appendChild(li); });
});