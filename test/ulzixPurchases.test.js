const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const service = require('../src/services/ulzixPurchases');

/** Seed an uncertain checkout written by the previous session-based integration. */
function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  service.list(db);
  db.prepare('INSERT INTO ulzix_purchases (token,user_id,state,quote,created_at,started_at) VALUES (?,?,?,?,?,?)')
    .run('old-token', 1, 'processing', JSON.stringify({ accountId: 7, productId: 67 }), new Date(0).toISOString(), 0);
  assert.equal(service.list(db)[0].state, 'unknown');
  return db;
}

test('Ulzix reconciles an old checkout against a matching API-owned order', async t => {
  const db = fixture(t);
  const client = { async call(method, params) {
    if (method === 'profile/get') return { id: 7 };
    assert.equal(method, 'order/get');
    return { id: params.id, product_id: 67 };
  } };
  assert.equal((await service.reconcile(db, client, 1, 'old-token', 991)).orderId, 991);
  assert.equal(service.list(db)[0].state, 'ordered');
});

test('Ulzix rejects reconciliation across users, accounts, and products', async t => {
  const db = fixture(t);
  const client = { async call(method) { return method === 'profile/get' ? { id: 7 } : { id: 991, product_id: 68 }; } };
  await assert.rejects(service.reconcile(db, client, 2, 'old-token', 991), /不存在/);
  await assert.rejects(service.reconcile(db, { call: async () => ({ id: 8 }) }, 1, 'old-token', 991), /账户不一致/);
  await assert.rejects(service.reconcile(db, client, 1, 'old-token', 991), /商品不匹配/);
  assert.equal(service.list(db)[0].state, 'unknown');
});
