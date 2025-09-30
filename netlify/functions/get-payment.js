
const fetch = global.fetch || require('node-fetch');
const admin = require('firebase-admin');
const { createCommissionsForTransaction } = require('./process-commissions');

let appInitialized = false;

function initAdmin() {
  if (appInitialized) return;
  const sa_b64 = process.env.FIREBASE_ADMIN_SA || '';
  if (!sa_b64) throw new Error('FIREBASE_ADMIN_SA not configured');
  const sa_json = JSON.parse(Buffer.from(sa_b64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa_json) });
  appInitialized = true;
}

exports.handler = async function(event) {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const collection_id = body.collection_id;
    const token = process.env.MP_ACCESS_TOKEN;

    // If collection_id provided and MP token configured -> use Mercado Pago flow
    if (collection_id && token) {
      // fetch payment from Mercado Pago
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${collection_id}`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      const pay = await res.json();

      // parse external_reference for uid|type
      const external = pay.external_reference || '';
      const parts = external.split('|');
      const uid = parts[0] || null;
      const type = parts[1] || 'recompra';

      // init firebase admin
      initAdmin();
      const db = admin.firestore();

      // store payment
      await db.collection('payments').add({
        uid,
        type,
        amount: pay.transaction_amount || 0,
        status: pay.status || pay.status_detail || 'unknown',
        raw: pay,
        createdAt: new Date().toISOString()
      });

      // if approved, increment user points (example: 10 points per 60k)
      if (pay.status === 'approved') {
        const userRef = db.collection('usuarios').doc(uid);
        await db.runTransaction(async t => {
          const doc = await t.get(userRef);
          const cur = doc.exists ? (doc.data().puntos || 0) : 0;
          const increment = 10;
          t.set(userRef, { puntos: cur + increment }, { merge: true });
        });

        // create Transaction + Commissions (ACID) for approved payment
        if (uid) {
          await createCommissionsForTransaction({
            id: collection_id,
            user_id: uid,
            type: type,
            pts: 0,
            amount: pay.transaction_amount || 0
          });
        }
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true, payment: pay }) };
    }

    // Otherwise, if user_id provided -> treat as direct/simulated transaction (no Mercado Pago)
    if (body.user_id) {
      // init firebase admin (createCommissionsForTransaction will also initialize admin via require)
      try { initAdmin(); } catch(e) { /* ignore if already set or missing; createCommissions handles missing */ }

      const txObj = {
        id: body.external_id || body.id || null,
        user_id: body.user_id,
        type: body.type || 'recompra',
        pts: body.pts || 0,
        amount: body.amount || 0
      };

      const result = await createCommissionsForTransaction(txObj);
      return { statusCode: 200, body: JSON.stringify({ ok: true, commissionSummary: result }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'collection_id (MP) or user_id (direct) required' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
