const fetch = global.fetch || require('node-fetch');

exports.handler = async function(event) {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const uid = body.uid;
    const amount = body.amount || 60000;
    const type = body.type || 'recompra';
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return { statusCode: 500, body: JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }) };

    const preference = {
      items: [{ title: type, quantity: 1, currency_id: 'COP', unit_price: Number(amount) }],
      external_reference: `${uid}|${type}`,
      back_urls: { success: '/', failure: '/' },
      auto_return: 'approved'
    };

    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(preference)
    });
    const data = await res.json();
    return { statusCode: 200, body: JSON.stringify({ init_point: data.init_point, preference: data }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
