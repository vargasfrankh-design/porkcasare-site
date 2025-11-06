const admin = require('firebase-admin');

if (!admin.apps.length) {
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

    const userDoc = await db.collection('usuarios').doc(uid).get();
<<<<<<< HEAD
    if (!userDoc.exists || userDoc.data().rol !== 'admin') {
=======
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
>>>>>>> 5fcfed1ef02053457aec891a4203fb8830496ebe
      return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    const snap = await db.collection('orders')
      .where('status', 'in', ['pending_mp', 'pending_cash', 'pending_delivery'])
      .get();

    const orders = await Promise.all(
      snap.docs.map(async d => {
        const data = d.data();
        const buyerDoc = await db.collection('usuarios').doc(data.buyerUid).get();
        const buyerData = buyerDoc.exists ? buyerDoc.data() : {};
        return {
          id: d.id,
          ...data,
          buyerUsername: buyerData.usuario || data.buyerUid
        };
      })
    );

    return { statusCode: 200, body: JSON.stringify({ orders }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
