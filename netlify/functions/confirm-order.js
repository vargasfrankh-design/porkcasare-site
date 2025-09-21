// netlify/functions/confirm-order.js
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

async function findUserByUsername(username) {
  const snap = await db.collection('usuarios').where('usuario', '==', username).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() };
}

const getAuthHeader = (event) => {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!auth) return null;
  const parts = auth.split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const token = getAuthHeader(event);
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };

    const decoded = await admin.auth().verifyIdToken(token);
    const adminUid = decoded.uid;

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
      await orderRef.update({
        status: 'rejected',
        admin: adminUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { statusCode: 200, body: JSON.stringify({ message: 'Orden rechazada' }) };
    }

    if (action === 'confirm') {
      await orderRef.update({
        status: 'confirmed',
        admin: adminUid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const buyerUid = order.buyerUid;
      const buyerDoc = await db.collection('usuarios').doc(buyerUid).get();
      if (!buyerDoc.exists) return { statusCode: 404, body: JSON.stringify({ error: 'Comprador no encontrado' }) };

      const buyerData = buyerDoc.data();
      const buyerUsername = buyerData.usuario;
      let sponsorCode = buyerData.patrocinador || null;
      const points = order.points || 0;

      // 🎯 Bono de Inicio Rápido (por referido con paquete inicial)
      if (points === 50 && order.isInitial && sponsorCode) {
        if (!order.initialBonusPaid) {
          const sponsor = await findUserByUsername(sponsorCode);
          if (sponsor) {
            const sponsorRef = db.collection('usuarios').doc(sponsor.id);
            const bonusPoints = 15; // 30% de 50 puntos
            const bonusValue = bonusPoints * POINT_VALUE;

            await sponsorRef.update({
              balance: admin.firestore.FieldValue.increment(bonusValue),
              teamPoints: admin.firestore.FieldValue.increment(bonusPoints),
              history: admin.firestore.FieldValue.arrayUnion({
                action: `Bono inicial por compra de ${buyerUsername}`,
                amount: bonusValue,
                points: bonusPoints,
                orderId,
                date: new Date().toISOString()
              })
            });

            // marcar orden como bonificada
            await orderRef.update({ initialBonusPaid: true });
          }
        }
      }

      // 🟢 Distribución multinivel normal (hasta 5 niveles)
      let currentSponsorCode = sponsorCode;
      for (let level = 0; level < LEVEL_PERCENTS.length; level++) {
        if (!currentSponsorCode) break;
        const sponsor = await findUserByUsername(currentSponsorCode);
        if (!sponsor) break;

        const sponsorRef = db.collection('usuarios').doc(sponsor.id);
        const percent = LEVEL_PERCENTS[level] || 0;
        const commissionValue = Math.round(points * POINT_VALUE * percent);

        await sponsorRef.update({
          teamPoints: admin.firestore.FieldValue.increment(points),
          balance: admin.firestore.FieldValue.increment(commissionValue),
          history: admin.firestore.FieldValue.arrayUnion({
            action: `Comisión nivel ${level + 1} por compra de ${buyerUsername}`,
            amount: commissionValue,
            points,
            orderId,
            date: new Date().toISOString()
          })
        });

        currentSponsorCode = sponsor.data.patrocinador || null;
      }

      // 📜 Historial del comprador
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
    console.error("🔥 Error confirm-order:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
