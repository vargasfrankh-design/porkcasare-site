// netlify/functions/process-commissions.js
// Implementa createCommissionsForTransaction y exporta un handler POST para testing/dry-run

const admin = require('firebase-admin');
try {
  admin.initializeApp();
} catch (e) {
  // ignore if already initialized
}
const db = admin.firestore();

const SPONSOR_BONUS = Number(process.env.SPONSOR_BONUS) || 50000;
const POOL_PER_EVENT = Number(process.env.POOL_PER_EVENT) || 13000;
const LEVELS_PAID = Number(process.env.LEVELS_PAID) || 10;
const PER_LEVEL_SHARE = Math.floor(POOL_PER_EVENT / LEVELS_PAID);

async function _getUserDocInEitherCollection(userId, t) {
  // Busca en 'users' y en 'usuarios' por compatibilidad con distintos esquemas
  const usersRef = db.collection('users').doc(userId);
  const usuariosRef = db.collection('usuarios').doc(userId);
  const snapUsers = await t.get(usersRef);
  if (snapUsers.exists) return { ref: usersRef, snap: snapUsers };
  const snapUsuarios = await t.get(usuariosRef);
  if (snapUsuarios.exists) return { ref: usuariosRef, snap: snapUsuarios };
  return null;
}

/**
 * Crea registros Transaction y Commission de manera atómica.
 * txObj = { id?: externalId, user_id, type: 'signup'|'recompra', pts?, amount? }
 */
async function createCommissionsForTransaction(txObj) {
  if (!txObj || !txObj.user_id) throw new Error('txObj.user_id requerido');
  return await db.runTransaction(async t => {
    const transactionRef = db.collection('Transaction').doc();
    t.set(transactionRef, {
      external_id: txObj.id || null,
      user_id: txObj.user_id,
      type: txObj.type || 'recompra',
      pts: txObj.pts || 0,
      amount: txObj.amount || 0,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Obtener user doc (intentar ambas colecciones)
    const userLookup = await _getUserDocInEitherCollection(txObj.user_id, t);
    if (!userLookup) {
      // crear resumen pero no generar comisiones si usuario no existe
      const summaryRef = db.collection('CommissionSummary').doc();
      t.set(summaryRef, {
        transaction_id: transactionRef.id,
        user_id: txObj.user_id,
        type: txObj.type || 'recompra',
        paidSponsor: 0,
        paidPoolTotal: 0,
        poolUnassigned: POOL_PER_EVENT,
        note: 'usuario no encontrado',
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      return { paidSponsor: 0, paidPoolTotal: 0, poolUnassigned: POOL_PER_EVENT };
    }

    const userDoc = userLookup.snap;
    const sponsorId = userDoc.data().sponsor_id || null;

    // Sponsor bonus solo para 'signup'
    let paidSponsor = 0;
    if (txObj.type === 'signup' && sponsorId) {
      const cRef = db.collection('Commission').doc();
      t.set(cRef, {
        transaction_id: transactionRef.id,
        recipient_user_id: sponsorId,
        amount: SPONSOR_BONUS,
        reason: 'sponsor',
        level_distance: 1,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        paid_flag: false
      });
      paidSponsor = SPONSOR_BONUS;
    }

    // Pool distribution up to LEVELS_PAID
    let paidPoolTotal = 0;
    let currentUpline = sponsorId; // distance 1
    const visited = new Set();
    for (let dist = 1; dist <= LEVELS_PAID; dist++) {
      if (!currentUpline) break;
      if (visited.has(currentUpline)) {
        // ciclo detectado, romper
        console.error('Ciclo detectado en uplines para usuario', txObj.user_id, 'upline', currentUpline);
        break;
      }
      visited.add(currentUpline);

      // Si la distancia 1 ya fue pagada como sponsor, igualmente recibe PER_LEVEL_SHARE (espec del spec)
      const cRef = db.collection('Commission').doc();
      t.set(cRef, {
        transaction_id: transactionRef.id,
        recipient_user_id: currentUpline,
        amount: PER_LEVEL_SHARE,
        reason: 'pool',
        level_distance: dist,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        paid_flag: false
      });
      paidPoolTotal += PER_LEVEL_SHARE;

      // avanzar al siguiente sponsor (buscar user doc)
      const uLookup = await _getUserDocInEitherCollection(currentUpline, t);
      if (!uLookup) break;
      const uDoc = uLookup.snap;
      currentUpline = uDoc.data().sponsor_id || null;
    }

    const poolUnassigned = POOL_PER_EVENT - paidPoolTotal;

    const summaryRef = db.collection('CommissionSummary').doc();
    t.set(summaryRef, {
      transaction_id: transactionRef.id,
      user_id: txObj.user_id,
      type: txObj.type || 'recompra',
      paidSponsor,
      paidPoolTotal,
      poolUnassigned,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    return { paidSponsor, paidPoolTotal, poolUnassigned };
  });
}

// Export para ser requerido por otras netlify functions
module.exports = { createCommissionsForTransaction };

// Además, exportar un handler POST para poder probar desde frontend (dry-run)
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const txObj = {
      id: body.external_id || body.id || null,
      user_id: body.user_id || body.uid || body.userId,
      type: body.type || 'recompra',
      pts: body.pts || 0,
      amount: body.amount || 0
    };
    const result = await createCommissionsForTransaction(txObj);
    return { statusCode: 200, body: JSON.stringify({ ok: true, result }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
