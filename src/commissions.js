// src/commissions.js
// Implementación pura (sin BD) del algoritmo de distribución que se puede usar para tests y simulaciones.

const DEFAULTS = {
  SPONSOR_BONUS: 50000,
  POOL_PER_EVENT: 13000,
  LEVELS_PAID: 10
};

function computeDistribution({ userId, getSponsorFn, type = 'recompra', config = {} }) {
  // getSponsorFn(userId) => sponsorId or null (puede ser async)
  const cfg = Object.assign({}, DEFAULTS, config);
  const PER_LEVEL_SHARE = Math.floor(cfg.POOL_PER_EVENT / cfg.LEVELS_PAID);

  return (async () => {
    let paidSponsor = 0;
    const commissions = []; // { recipient, amount, reason, level }

    const sponsorId = await getSponsorFn(userId);
    if (type === 'signup' && sponsorId) {
      commissions.push({ recipient: sponsorId, amount: cfg.SPONSOR_BONUS, reason: 'sponsor', level: 1 });
      paidSponsor = cfg.SPONSOR_BONUS;
    }

    let current = sponsorId;
    const visited = new Set();
    let paidPoolTotal = 0;

    for (let dist = 1; dist <= cfg.LEVELS_PAID; dist++) {
      if (!current) break;
      if (visited.has(current)) {
        // ciclo detectado
        break;
      }
      visited.add(current);
      commissions.push({ recipient: current, amount: PER_LEVEL_SHARE, reason: 'pool', level: dist });
      paidPoolTotal += PER_LEVEL_SHARE;
      current = await getSponsorFn(current);
    }

    const poolUnassigned = cfg.POOL_PER_EVENT - paidPoolTotal;
    return { commissions, paidSponsor, paidPoolTotal, poolUnassigned };
  })();
}

module.exports = { computeDistribution };
