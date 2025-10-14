
// netlify/functions/confirm-order.js
// Reglas implementadas:
// - POINT_VALUE = 2800
// - Bono Inicio Rápido: 20 pts (56,000 COP) al patrocinador directo UNA sola vez
//   cuando el usuario entra con 50 o cuando cruza 50 acumulando 10s.
// - En cada paquete (10 o 50) se paga 1 punto por nivel a 5 niveles (2.800 COP por nivel)
//   EXCEPTO: en la confirmación que provoca el pago del bono inicial, la red recibe solo 1 punto por nivel
//   (para que el total distribuido entre 5 niveles sea 70.000 COP).
// - Después de que el usuario tenga >=50 y ya recibió el bono, todas las compras posteriores
//   pagan unidades = Math.floor(points/10) por nivel.
// - Se marca buyer.initialBonusGiven para evitar pagar el bono más de una vez.
// - Función pensada para Netlify / Firestore (firebase-admin).

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

// CONFIG
const POINT_VALUE = 2800;
const REBUY_POINT_PER_LEVEL = 1; // 1 punto por cada unidad (bloque de 10)
const MAX_LEVELS = 5;

// HELPERS
async function findUserByUsername(username) {
  if (!username) return null;
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

// FUNCTION
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
      const buyerUid = order.buyerUid;
      if (!buyerUid) return { statusCode: 400, body: JSON.stringify({ error: 'Orden sin buyerUid' }) };

      const points = Number(order.points || 0);

      // 1) Run transaction: mark order confirmed and update buyer points; return prev/new personalPoints
      const txResult = await db.runTransaction(async (tx) => {
        const ordSnap = await tx.get(orderRef);
        if (!ordSnap.exists) throw new Error('Orden desapareció durante la transacción');

        const buyerRef = db.collection('usuarios').doc(buyerUid);
        const buyerSnap = await tx.get(buyerRef);
        if (!buyerSnap.exists) throw new Error('Comprador no encontrado en la transacción');

        const prevPersonalPoints = Number(buyerSnap.data().personalPoints || buyerSnap.data().puntos || 0);
        const newPersonalPoints = prevPersonalPoints + points;

        tx.update(orderRef, {
          status: 'confirmed',
          admin: adminUid,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp()
        });

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

        // compatibility flag
        if (newPersonalPoints >= 50 && !(buyerSnap.data() && buyerSnap.data().initialPackBought)) {
          tx.update(buyerRef, { initialPackBought: true });
        }

        return { prevPersonalPoints, newPersonalPoints };
      });

      const { prevPersonalPoints, newPersonalPoints } = txResult || { prevPersonalPoints: 0, newPersonalPoints: 0 };

      // 2) Create confirmation audit doc (best effort)
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

      // 3) Decide if initial bonus must be paid (determine flag BEFORE updating the buyer)
      // Fetch buyer current data (to check initialBonusGiven and sponsor)
      const buyerDoc = await db.collection('usuarios').doc(buyerUid).get();
      const buyerData = buyerDoc.exists ? buyerDoc.data() : null;
      const sponsorCode = buyerData?.patrocinador || order.sponsor || null;
      const buyerHadInitialBonus = Boolean(buyerData?.initialBonusGiven);

      const crossed50 = (prevPersonalPoints < 50 && newPersonalPoints >= 50);
      const single50Order = (points === 50);
      const payInitialBonus = (!buyerHadInitialBonus) && (crossed50 || single50Order);

      // Save a flag for commission behavior: if this confirmation causes bonus payment, then it's first-time commission
      const isFirstTime50Commission = payInitialBonus;

      // 3.a Pay initial bonus if required (non-critical)
      if (payInitialBonus && sponsorCode) {
        try {
          const sponsor = await findUserByUsername(sponsorCode);
          if (sponsor) {
            const sponsorRef = db.collection('usuarios').doc(sponsor.id);
            const bonusPoints = 20;
            const bonusValue = bonusPoints * POINT_VALUE; // 20 * 2800 = 56,000
            await sponsorRef.update({
              balance: admin.firestore.FieldValue.increment(bonusValue),
              teamPoints: admin.firestore.FieldValue.increment(bonusPoints),
              history: admin.firestore.FieldValue.arrayUnion({
                action: `Bono inicio rápido por compra/alcance de 50 pts de ${buyerData?.usuario || 'usuario'}`,
                amount: bonusValue,
                points: bonusPoints,
                orderId,
                date: new Date().toISOString()
              })
            });

            // mark buyer as having received initial bonus
            await db.collection('usuarios').doc(buyerUid).update({ initialBonusGiven: true });
            // mark order as paid (optional)
            await orderRef.update({ initialBonusPaid: true });
          }
        } catch (e) {
          console.warn('Error procesando bono inicial (no crítico):', e);
        }
      }

      // 4) Multilevel commission distribution
      try {
        // Determine units (how many blocks of 10 pts in the order)
        const units = Math.floor(points / 10); // e.g., 10 => 1, 50 => 5

        // Determine commission units per level
        // Default: units per level
        let commissionUnitsPerLevel = units;

        // If this confirmation is the one that triggered the initial bonus (first-time 50),
        // then override to 1 unit per level (so network receives 1 pt/level only)
        if (isFirstTime50Commission && units > 0) {
          commissionUnitsPerLevel = 1;
        }

        // Commission points and monetary value per level
        const commissionPointsPerLevel = Math.max(0, commissionUnitsPerLevel * REBUY_POINT_PER_LEVEL);
        const commissionValuePerLevel = commissionPointsPerLevel * POINT_VALUE;

        // Walk the sponsor chain and pay each level
        let currentSponsorCode = buyerData?.patrocinador || order.sponsor || null;
        const buyerUsername = buyerData?.usuario || '';

        if (commissionPointsPerLevel > 0 && commissionValuePerLevel > 0) {
          for (let level = 0; level < MAX_LEVELS; level++) {
            if (!currentSponsorCode) break;
            const sponsor = await findUserByUsername(currentSponsorCode);
            if (!sponsor) break;

            const sponsorRef = db.collection('usuarios').doc(sponsor.id);

            await sponsorRef.update({
              teamPoints: admin.firestore.FieldValue.increment(commissionPointsPerLevel),
              balance: admin.firestore.FieldValue.increment(commissionValuePerLevel),
              history: admin.firestore.FieldValue.arrayUnion({
                action: `Comisión por compra (${points} pts) - nivel ${level + 1} por ${buyerUsername}`,
                amount: commissionValuePerLevel,
                points: commissionPointsPerLevel,
                orderId,
                date: new Date().toISOString()
              })
            });

            // climb to next upline
            currentSponsorCode = sponsor.data.patrocinador || null;
          }
        }
      } catch (e) {
        console.warn('Error durante la distribución multinivel (no crítico):', e);
      }

      return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y pagos procesados' }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Action no soportada' }) };
  } catch (err) {
    console.error('🔥 Error confirm-order:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
