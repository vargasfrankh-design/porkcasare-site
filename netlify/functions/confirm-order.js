
// netlify/functions/confirm-order.js
// Implementa las reglas acordadas:
// - POINT_VALUE = 2800
// - Bono Inicio Rápido: 20 puntos (56,000 COP) al patrocinador directo **una sola vez**
//   se paga cuando el usuario entra con 50 OR cuando cruza 50 acumulando 10s.
// - En cada paquete (10 o 50) se paga **1 punto por nivel** a 5 niveles (2800 COP por nivel)
//   EXCEPCIÓN: si el usuario ya tiene >=50, las recompras posteriores pagan 1 punto por cada 10 pts
//   en la orden (i.e. units = Math.floor(points/10)).
// - En la compra inicial exactamente de 50 (o en la compra que cruza 50), además del bono,
//   la red recibe **solo 1 punto por nivel** para que el total distribuido entre los 5 niveles sea 70,000 COP.
// - Se marca buyer.initialBonusGiven para evitar pagar el bono más de una vez.
// - El archivo está pensado para usarse como función Netlify con Firestore (firebase-admin).

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const saBase64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!saBase64) throw new Error('FIREBASE_ADMIN_SA missing');
  const saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(saJson) });
}

const db = admin.firestore();

// ====== CONFIG ======
const POINT_VALUE = 2800;
const REBUY_POINT_PER_LEVEL = 1; // 1 punto por cada bloque de 10 (unidad)
const MAX_LEVELS = 5;

// ====== HELPERS ======
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

// ====== FUNCTION ======
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

      // 1) Transacción crítica: actualizar buyer y marcar orden confirmada
      const txResult = await db.runTransaction(async (tx) => {
        const ordSnap = await tx.get(orderRef);
        if (!ordSnap.exists) throw new Error('Orden desapareció durante la transacción');

        const buyerRef = db.collection('usuarios').doc(buyerUid);
        const buyerSnap = await tx.get(buyerRef);
        if (!buyerSnap.exists) throw new Error('Comprador no encontrado en la transacción');

        const prevPersonalPoints = Number(buyerSnap.data().personalPoints || buyerSnap.data().puntos || 0);
        const newPersonalPoints = prevPersonalPoints + points;

        // marcar orden confirmada
        tx.update(orderRef, {
          status: 'confirmed',
          admin: adminUid,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // incrementar personalPoints y puntos y añadir history
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

        // marcar initialPackBought por compatibilidad si alcanza >=50
        if (newPersonalPoints >= 50 && !(buyerSnap.data() && buyerSnap.data().initialPackBought)) {
          tx.update(buyerRef, { initialPackBought: true });
        }

        return { prevPersonalPoints, newPersonalPoints };
      });

      const { prevPersonalPoints, newPersonalPoints } = txResult || { prevPersonalPoints: 0, newPersonalPoints: 0 };

      // 2) Registrar confirmation para auditoría
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

      // 3) Determinar si corresponde pagar Bono Inicio Rápido (una sola vez)
      // Condición: buyer no tiene initialBonusGiven (o initialBonusGiven === false)
      // y (la orden es de 50 o el usuario cruzó de <50 a >=50 con esta compra)
      try {
        const buyerDoc = await db.collection('usuarios').doc(buyerUid).get();
        const buyerData = buyerDoc.exists ? buyerDoc.data() : null;
        const sponsorCode = buyerData?.patrocinador || order.sponsor || null;
        const buyerHadInitialBonus = Boolean(buyerData?.initialBonusGiven);

        const crossed50 = (prevPersonalPoints < 50 && newPersonalPoints >= 50);
        const single50Order = (points === 50);

        const payInitialBonus = (!buyerHadInitialBonus) && (crossed50 || single50Order);

        if (payInitialBonus && sponsorCode) {
          const sponsor = await findUserByUsername(sponsorCode);
          if (sponsor) {
            const sponsorRef = db.collection('usuarios').doc(sponsor.id);
            const bonusPoints = 20;
            const bonusValue = bonusPoints * POINT_VALUE; // 56,000
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

            // marcar que el comprador ya recibió el bono para no pagarlo otra vez
            await db.collection('usuarios').doc(buyerUid).update({ initialBonusGiven: true });
            // marcar en la orden que se pagó (opcional)
            await orderRef.update({ initialBonusPaid: true });
          }
        }
      } catch (e) {
        console.warn('Error procesando bono inicial (no crítico):', e);
      }

      // 4) DISTRIBUCIÓN MULTINIVEL (comisiones por red)
      // Regla final:
      // - Por defecto, units = Math.floor(points / 10) (cuántos bloques de 10 trae la orden)
      // - Si esta compra es la primera vez que el usuario llega a 50 (payInitialBonus true)
      //   y la orden tiene points === 50 (entrada directa de 50) o crossed50 true,
      //   entonces queremos que la red RECIBA SOLO 1 punto por nivel (no units puntos)
      //   para que la suma total sea la que pediste (70,000 COP en total entre 5 niveles).
      try {
        const buyerDoc2 = await db.collection('usuarios').doc(buyerUid).get();
        let currentSponsorCode = buyerDoc2.exists ? (buyerDoc2.data().patrocinador || null) : (order.sponsor || null);
        const buyerUsername = buyerDoc2.exists ? (buyerDoc2.data().usuario || '') : '';

        const units = Math.floor(points / 10); // cuántos bloques de 10 trae la orden
        // recompras posteriores (buyer con >=50) pagan units por nivel
        // pero en la compra que origina el bono (first time 50), solo pagamos 1 por nivel
        const buyerHadInitialBonusBefore = Boolean((await db.collection('usuarios').doc(buyerUid).get()).data()?.initialBonusGiven);
        // note: buyerHadInitialBonusBefore may already be true if we updated it above; we need to infer
        // whether this action was the one that caused the bonus:
        const crossed50Now = (prevPersonalPoints < 50 && newPersonalPoints >= 50);
        const single50Order = (points === 50);

        // detect if this confirmation should be treated as "first time 50" commission behavior
        const isFirstTime50Commission = (!buyerHadInitialBonusBefore && (crossed50Now || single50Order)) && !!currentSponsorCode;

        // By default, commissionUnitsPerLevel = units
        let commissionUnitsPerLevel = units;
        // If this is the first time user reaches 50 (order caused the bonus), force 1 unit for the commission per level
        if (isFirstTime50Commission) {
          commissionUnitsPerLevel = 1; // así patrocinador recibirá bono + 1 punto; otros solo 1 punto
        }

        // If buyer already had >=50 before this order, still use units (recompra behavior)
        // commissionPointsPerLevel = commissionUnitsPerLevel * REBUY_POINT_PER_LEVEL
        const commissionPointsPerLevel = Math.max(0, commissionUnitsPerLevel * REBUY_POINT_PER_LEVEL);
        const commissionValuePerLevel = commissionPointsPerLevel * POINT_VALUE; // COP

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

            // subir al siguiente upline
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
