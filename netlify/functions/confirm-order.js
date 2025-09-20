// confirm-order.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}
const db = admin.firestore();

const LEVEL_PERCENTS = [0.05, 0.03, 0.02, 0.01, 0.005];
const POINT_VALUE = 3800;

const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

async function findUserByUsername(username) {
  const snap = await db.collection('usuarios').where('usuario', '==', username).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const token = getAuthHeader(event);
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
    const decoded = await admin.auth().verifyIdToken(token);
    const adminUid = decoded.uid;

    // check admin role
    const adminDoc = await db.collection('usuarios').doc(adminUid).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { orderId, action } = body;
    if (!orderId || !action) return { statusCode: 400, body: JSON.stringify({ error: 'orderId y action requeridos' }) };

    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return { statusCode: 404, body: JSON.stringify({ error: 'Orden no encontrada' }) };
    const order = orderSnap.data();

    if (action === 'reject') {
      await orderRef.update({ status: 'rejected', admin: adminUid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return { statusCode: 200, body: JSON.stringify({ message: 'Orden rechazada' }) };
    }

    if (action === 'confirm') {
      // marcar confirmada
      await orderRef.update({ status: 'confirmed', admin: adminUid, confirmedAt: admin.firestore.FieldValue.serverTimestamp() });

      // distribuir puntos 5 niveles hacia arriba
      const buyerUid = order.buyerUid;
      const buyerDoc = await db.collection('usuarios').doc(buyerUid).get();
      const buyerData = buyerDoc.exists ? buyerDoc.data() : null;
      const buyerUsername = buyerData ? buyerData.usuario : null;
      let sponsorCode = buyerData ? buyerData.patrocinador : null;
      const points = order.points || 0;

      for (let level = 0; level < 5; level++) {
        if (!sponsorCode) break;
        const sponsor = await findUserByUsername(sponsorCode);
        if (!sponsor) break;
        const sponsorRef = db.collection('usuarios').doc(sponsor.id);

        // sumar teamPoints
        await sponsorRef.update({ teamPoints: admin.firestore.FieldValue.increment(points) });

        // calcular comisión monetaria y actualizar balance + history
        const percent = LEVEL_PERCENTS[level] || 0;
        const commissionValue = Math.round(points * POINT_VALUE * percent);

        await sponsorRef.update({
          balance: admin.firestore.FieldValue.increment(commissionValue),
          history: admin.firestore.FieldValue.arrayUnion({
            action: `Comisión nivel ${level + 1} por compra de ${buyerUsername || buyerUid}`,
            amount: commissionValue,
            points,
            orderId,
            date: new Date().toISOString()
          })
        });

        // next sponsor
        sponsorCode = sponsor.data.patrocinador || null;
      }

      // registrar en historial del comprador que la compra fue confirmada
      await db.collection('usuarios').doc(buyerUid).update({
        history: admin.firestore.FieldValue.arrayUnion({
          action: `Compra confirmada: ${order.productName}`,
          amount: order.price,
          points: order.points,
          orderId,
          date: new Date().toISOString()
        })
      });

      return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y puntos distribuidos' }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Action no soportada' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
