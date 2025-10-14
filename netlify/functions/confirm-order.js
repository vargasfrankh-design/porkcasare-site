
// netlify/functions/confirm-order.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

// Configuración solicitada por el usuario:
// - Valor por punto: 2800
// - Bono de inicio rápido: 20 puntos (40% de 50) al patrocinador directo
// - Recompras: cada nivel (hasta 5) recibe 1 punto completo => 1 * 2800 = 2800 COP
const POINT_VALUE = 2800;
const LEVEL_PERCENTS = [0.068, 0.068, 0.068, 0.068, 0.068]; // usados para cálculo multinivel de compras iniciales (si aplica)
const REBUY_POINT_PER_LEVEL = 1; // 1 punto pagado por nivel en recompras
const MAX_LEVELS = 5;

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
      // Identificar buyerUid
      const buyerUid = order.buyerUid;
      if (!buyerUid) return { statusCode: 400, body: JSON.stringify({ error: 'Orden sin buyerUid' }) };

      const points = Number(order.points || 0);

      // 1) Transacción crítica: marcar orden y actualizar buyer (personalPoints + puntos + history)
      await db.runTransaction(async (tx) => {
        const ordSnap = await tx.get(orderRef);
        if (!ordSnap.exists) throw new Error('Orden desapareció durante la transacción');

        const buyerRef = db.collection('usuarios').doc(buyerUid);
        const buyerSnap = await tx.get(buyerRef);
        if (!buyerSnap.exists) throw new Error('Comprador no encontrado en la transacción');

        // marcar orden confirmada
        tx.update(orderRef, {
          status: 'confirmed',
          admin: adminUid,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // incrementar personalPoints y puntos (compatibilidad) y añadir history
        tx.update(buyerRef, {
          personalPoints: admin.firestore.FieldValue.increment(points),
          puntos: admin.firestore.FieldValue.increment(points),
          history: admin.firestore.FieldValue.arrayUnion({
            action: `Compra confirmada: ${order.productName || order.product || ''}`,
            amount: order.price || order.amount || null,
            points: points,
            orderId,
            date: new Date().toISOString(),
            by: 'admin'
          })
        });

        // si alcanza >= 50, marcar initialPackBought (esto NO dispara bono; bono solo si la compra es de 50 en una sola orden)
        const currentPersonal = Number(buyerSnap.data().personalPoints || buyerSnap.data().puntos || 0);
        const newPersonal = currentPersonal + points;
        if (newPersonal >= 50 && !(buyerSnap.data() && buyerSnap.data().initialPackBought)) {
          tx.update(buyerRef, { initialPackBought: true });
        }
      });

      // 2) Registrar confirmación en colección 'confirmations' para auditoría
      try {
        await db.collection('confirmations').add({
          orderId,
          userId: buyerUid,
          points,
          amount: order.price || order.amount || null,
          confirmedBy: adminUid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          meta: {
            productName: order.productName || order.product || null,
            itemsCount: Array.isArray(order.items) ? order.items.length : null
          }
        });
      } catch (e) {
        console.warn('Warning: no se pudo crear confirmation doc', e);
      }

      // 3) Bono inicial (fuera de la transacción): si aplica
      try {
        const buyerDoc = await db.collection('usuarios').doc(buyerUid).get();
        const buyerData = buyerDoc.exists ? buyerDoc.data() : null;
        const buyerUsername = buyerData?.usuario;
        let sponsorCode = buyerData?.patrocinador || null;

        if (points === 50 && order.isInitial && sponsorCode && !order.initialBonusPaid) {
          const sponsor = await findUserByUsername(sponsorCode);
          if (sponsor) {
            const sponsorRef = db.collection('usuarios').doc(sponsor.id);
            const bonusPoints = 20; // CAMBIO: 20 puntos (40% de 50)
            const bonusValue = bonusPoints * POINT_VALUE; // 20 * 2800 = 56,000

            await sponsorRef.update({
              balance: admin.firestore.FieldValue.increment(bonusValue),
              teamPoints: admin.firestore.FieldValue.increment(bonusPoints),
              history: admin.firestore.FieldValue.arrayUnion({
                action: `Bono inicio rápido por compra de ${buyerUsername}`,
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
      } catch (e) {
        console.warn('Error procesando bono inicial (no crítico):', e);
      }

      // 4) Distribución multinivel
      try {
        // obtener sponsor chain usando buyer's sponsorCode a partir del buyer doc
        const buyerDoc2 = await db.collection('usuarios').doc(buyerUid).get();
        let currentSponsorCode = buyerDoc2.exists ? (buyerDoc2.data().patrocinador || null) : null;
        const buyerUsername = buyerDoc2.exists ? (buyerDoc2.data().usuario || '') : '';

        // Comportamiento:
        // - Si es una RECOMPRA (order.isInitial === false): pagar REBUY_POINT_PER_LEVEL (1 punto) a CADA nivel (100% del punto)
        // - Si es COMPRA INICIAL (order.isInitial === true): usar lógica previa (basePointsForCommission = (points === 50) ? 10 : points)
        //   y aplicar LEVEL_PERCENTS (6.8% por nivel) sobre esa base.
        if (!order.isInitial) {
          // RECOMPRA: pagar 1 punto (100%) a cada nivel hasta MAX_LEVELS
          for (let level = 0; level < MAX_LEVELS; level++) {
            if (!currentSponsorCode) break;
            const sponsor = await findUserByUsername(currentSponsorCode);
            if (!sponsor) break;

            const sponsorRef = db.collection('usuarios').doc(sponsor.id);
            const commissionPoints = REBUY_POINT_PER_LEVEL;
            const commissionValue = commissionPoints * POINT_VALUE; // 1 * 2800 = 2800

            await sponsorRef.update({
              teamPoints: admin.firestore.FieldValue.increment(commissionPoints),
              balance: admin.firestore.FieldValue.increment(commissionValue),
              history: admin.firestore.FieldValue.arrayUnion({
                action: `Comisión recompra nivel ${level + 1} por compra de ${buyerUsername}`,
                amount: commissionValue,
                points: commissionPoints,
                orderId,
                date: new Date().toISOString()
              })
            });

            currentSponsorCode = sponsor.data.patrocinador || null;
          }
        } else {
          // COMPRA INICIAL: conservar comportamiento anterior (basePointsForCommission = 10 para compras de 50 en una sola orden)
          const basePointsForCommission = (points === 50) ? 10 : points;

          for (let level = 0; level < LEVEL_PERCENTS.length; level++) {
            if (!currentSponsorCode) break;
            const sponsor = await findUserByUsername(currentSponsorCode);
            if (!sponsor) break;

            const sponsorRef = db.collection('usuarios').doc(sponsor.id);
            const percent = LEVEL_PERCENTS[level] || 0;
            const commissionValue = Math.round(basePointsForCommission * POINT_VALUE * percent);

            await sponsorRef.update({
              teamPoints: admin.firestore.FieldValue.increment(basePointsForCommission),
              balance: admin.firestore.FieldValue.increment(commissionValue),
              history: admin.firestore.FieldValue.arrayUnion({
                action: `Comisión nivel ${level + 1} por compra de ${buyerUsername}`,
                amount: commissionValue,
                points: basePointsForCommission,
                orderId,
                date: new Date().toISOString()
              })
            });

            currentSponsorCode = sponsor.data.patrocinador || null;
          }
        }
      } catch (e) {
        console.warn('Error durante la distribución multinivel (no crítico):', e);
      }

      // 5) Historial del comprador (ya agregado dentro de la transacción)
      return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y puntos distribuidos' }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Action no soportada' }) };
  } catch (err) {
    console.error("🔥 Error confirm-order:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
