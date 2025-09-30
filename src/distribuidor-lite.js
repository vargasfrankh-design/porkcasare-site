import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const REBUY_AMOUNT = 60000;

onAuthStateChanged(auth, async user=>{
  if(!user) return window.location='login.html';
  const uid = user.uid;
  const snap = await getDoc(doc(db,'usuarios',uid));
  if(!snap.exists()) return alert('Perfil no encontrado');
  const data = snap.data();
  document.getElementById('name').innerText = data.nombre || '';
  document.getElementById('email').innerText = data.email || '';
  document.getElementById('code').innerText = data.codigoReferido || '';
  document.getElementById('points').innerText = data.puntos || 0;

  // load payments history
  const paymentsSnap = await getDocs(collection(db,'payments'));
  const items = paymentsSnap.docs.map(d=>d.data()).filter(p=>p.uid===uid);
  document.getElementById('history').innerHTML = items.map(i=>`<div class="small">${i.type} - $${i.amount} - ${i.status}</div>`).join('');
});

document.getElementById('btnRecompra').addEventListener('click', async ()=>{
  const user = getAuth().currentUser;
  if(!user) return alert('Inicia sesión');
  const resp = await fetch('/.netlify/functions/create-preference', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ uid: user.uid, amount: REBUY_AMOUNT, type: 'recompra' })
  });
  const data = await resp.json();
  if(data && data.init_point){
    window.location = data.init_point;
  } else {
    alert('Error creando preferencia');
    console.error(data);
  }
});

// detect MP return with collection_id and call get-payment function
(async function handleReturn(){
  const params = new URLSearchParams(window.location.search);
  if(params.has('collection_id')){
    const collection_id = params.get('collection_id');
    const resp = await fetch('/.netlify/functions/get-payment', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ collection_id })
    });
    const result = await resp.json();
    console.log('MP verify result', result);
    alert('Pago procesado (ver consola y Firestore).');
    window.location = 'distribuidor.html';
  }
})();
