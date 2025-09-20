// list-orders.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  // inicializa con variables de entorno: FIREBASE_ADMIN_SA (json base64)
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}
const db = admin.firestore();

const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

exports.handler = async (event) => {
  try {
    const token = getAuthHeader(event);
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    // verificar que sea admin (role en usuarios)
    const userDoc = await db.collection('usuarios').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    // traer órdenes pendientes
    const snap = await db.collection('orders')
      .where('status', 'in', ['pending_mp', 'pending_cash'])
      .get();

    const orders = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    return { statusCode: 200, body: JSON.stringify({ orders }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
