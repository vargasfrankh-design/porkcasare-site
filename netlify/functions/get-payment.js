// netlify/functions/get-payment.js
// Versión simplificada: acepta POST JSON para crear una transacción y generar comisiones

const { createCommissionsForTransaction } = require('./process-commissions');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    // Espera: { user_id, type:'signup'|'recompra', pts, amount, external_id }
    if (!body.user_id) return { statusCode: 400, body: JSON.stringify({ error: 'user_id es requerido' }) };

    const txObj = {
      id: body.external_id || null,
      user_id: body.user_id,
      type: body.type || 'recompra',
      pts: body.pts || 0,
      amount: body.amount || 0
    };

    const result = await createCommissionsForTransaction(txObj);
    return { statusCode: 200, body: JSON.stringify({ ok: true, commissionSummary: result }) };
  } catch (err) {
    console.error('get-payment error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
