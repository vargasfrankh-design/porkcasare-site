// test/commissions.test.js
// Tests unitarios para computeDistribution (sin Firestore)

const { computeDistribution } = require('../src/commissions');

// helper que construye una cadena de sponsors en memoria
function buildSponsorMap(chainArray) {
  // chainArray: [userA, userB, userC] donde userB.sponsor = userA, userC.sponsor = userB
  const map = new Map();
  for (let i = 0; i < chainArray.length; i++) {
    const id = chainArray[i];
    const sponsor = i === 0 ? null : chainArray[i - 1];
    map.set(id, sponsor);
  }
  return id => map.get(id) || null;
}

test('signup con 10 uplines -> sponsor + 10 pool', async () => {
  const chain = [];
  for (let i = 0; i < 11; i++) chain.push(`u${i}`); // u0..u10, target = u10
  const getSponsorFn = async (id) => {
    const idx = chain.indexOf(id);
    if (idx <= 0) return null;
    return chain[idx - 1];
  };
  const result = await computeDistribution({ userId: 'u10', getSponsorFn, type: 'signup' });
  // esperar sponsor + 10 pool
  const totalPoolEntries = result.commissions.filter(c => c.reason === 'pool').length;
  const sponsorEntries = result.commissions.filter(c => c.reason === 'sponsor').length;
  expect(sponsorEntries).toBe(1);
  expect(totalPoolEntries).toBe(10);
  expect(result.paidSponsor).toBe(50000);
  expect(result.paidPoolTotal).toBe(1300 * 10);
});

test('signup con 0 uplines -> sin sponsor ni pool', async () => {
  const getSponsorFn = async () => null;
  const result = await computeDistribution({ userId: 'solo', getSponsorFn, type: 'signup' });
  expect(result.commissions.length).toBe(0);
  expect(result.paidSponsor).toBe(0);
  expect(result.paidPoolTotal).toBe(0);
});

test('recompra con 4 uplines -> 4 pool entries', async () => {
  const chain = ['a','b','c','d','e']; // target=e -> uplines d,c,b,a (4)
  const getSponsorFn = async (id) => {
    const idx = chain.indexOf(id);
    if (idx <= 0) return null;
    return chain[idx - 1];
  };
  const result = await computeDistribution({ userId: 'e', getSponsorFn, type: 'recompra' });
  const poolCount = result.commissions.filter(c => c.reason === 'pool').length;
  expect(poolCount).toBe(4);
  expect(result.paidSponsor).toBe(0);
});
