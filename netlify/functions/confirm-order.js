// netlify/functions/confirm-order.js
// Confirm order function (cleaned & safe): updates order status, user points and creates commissions.
// - Uses a safe firebase-admin initialization that doesn't throw at module load.
// - Uses getDb() to lazily access Firestore.
// - Supports dev bypass with ALLOW_DEV_CONFIRM=true for local testing (no auth required).

const admin = require('firebase-admin');
const { createCommissionsForTransaction } = require('./process-commissions');

let appInitialized_confirm = false;
function initAdminConfirm() {
  if (appInitialized_confirm) return;
  const sa_b64 = process.env.FIREBASE_ADMIN_SA || '';
  if (sa_b64) {
    try {
      const sa_json = JSON.parse(Buffer.from(sa_b64, 'base64').toString('utf8'));
      admin.initializeApp({ credential: admin.credential.cert(sa_json) });
      appInitialized_confirm = true;
      return;
    } catch (e) {
      console.warn('FIREBASE_ADMIN_SA present but invalid JSON:', e.message);
    }
  }
  try {
    if (admin.apps.length === 0) admin.initializeApp();
    appInitialized_confirm = true;
  } catch (e) {
    console.warn('firebase-admin default initialization failed:', e.message);
  }
}

// Lazily obtain Firestore instance (so module load doesn't fail if admin isn't initialized yet)
function getDb() {
  try {
    return admin.firestore();
  } catch (e) {
    throw new Error('Firestore not initialized: ' + e.message);
  }
}

// Helper to extract bearer token
function getAuthHeader(event) {
  const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || null;
  if (!h) return null;
  const parts = h.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return null;
}

initAdminConfirm();

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

    const allowDev = process.env.ALLOW_DEV_CONFIRM === 'true' || process.env.NODE_ENV === 'development';

    let adminUid = null;
    if (!allowDev) {
      const token = getAuthHeader(event);
      if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        adminUid = decoded.uid;
      } catch (err) {
        console.warn('Token verify failed:', err.message);
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
      }
    } else {
      // Dev mode: allow operation without a token. Use a fake adminUid if present in body.
      try {
        const bodyTmp = JSON.parse(event.body || '{}');
        adminUid = bodyTmp.adminUid || 'dev-admin';
      } catch (e) {
        adminUid = 'dev-admin';
      }
    }

    // Basic validation
    const body = JSON.parse(event.body || '{}');
    const { orderId, action } = body;
    if (!orderId || !action) return { statusCode: 400, body: JSON.stringify({ error: 'orderId y action requeridos' }) };

    const db = getDb();

    // Verify admin privileges (if not dev bypass)
    if (!allowDev) {
      const adminDoc = await db.collection('usuarios').doc(adminUid).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado' }) };
      }
    }

    // Locate order
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

      // 1) Critical transaction: update order status and buyer points atomically
      await db.runTransaction(async (tx) => {
        const ordSnap = await tx.get(orderRef);
        if (!ordSnap.exists) throw new Error('Orden desapareció durante la transacción');

        const buyerRef = db.collection('usuarios').doc(buyerUid);
        const buyerSnap = await tx.get(buyerRef);
        if (!buyerSnap.exists) throw new Error('Comprador no encontrado en la transacción');

        // Mark order confirmed
        tx.update(orderRef, {
          status: 'confirmed',
          admin: adminUid,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Increment buyer's points and add history entry
        tx.update(buyerRef, {
          personalPoints: admin.firestore.FieldValue.increment(points),
          puntos: admin.firestore.FieldValue.increment(points),
          history: admin.firestore.FieldValue.arrayUnion({
            action: `Compra confirmada: ${order.productName || order.product || ''}`,
            amount: order.price || order.amount || null,
            points: points,
            orderId,
            date: new Date().toISOString(),
            by: adminUid
          })
        });
      });

      // 2) Create commissions (outside the transaction): use createCommissionsForTransaction
      try {
        const txType = (points === 50 && order.isInitial) ? 'signup' : 'recompra';
        await createCommissionsForTransaction({
          id: orderId,
          user_id: buyerUid,
          type: txType,
          pts: points,
          amount: order.price || order.amount || 0
        });
      } catch (e) {
        // Log but do not fail the confirm; commissions can be reconciled later
        console.warn('Error creando comisiones:', e && e.message ? e.message : e);
      }

      return { statusCode: 200, body: JSON.stringify({ message: 'Orden confirmada y puntos distribuidos' }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Action no soportada' }) };
  } catch (err) {
    console.error("🔥 Error confirm-order:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
