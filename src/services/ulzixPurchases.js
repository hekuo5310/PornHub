/** Identify expected purchase failures without exposing upstream payloads or credentials. */
class PurchaseError extends Error {}
/** Initialize the table used by historical purchase records. */
function initialize(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ulzix_purchases (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, state TEXT NOT NULL, quote TEXT, order_id INTEGER, invoice_hash TEXT, created_at TEXT NOT NULL, started_at INTEGER NOT NULL)`);
}
/** Return only browser-safe purchase metadata, never the account or cart fingerprint. */
function publicRecord(row) {
  const q=row.quote ? JSON.parse(row.quote) : {};
  return {token:row.token,state:row.state,orderId:row.order_id,invoiceUrl:row.invoice_hash ? 'https://idc-new.ulzix.com/invoice/'+encodeURIComponent(row.invoice_hash) : null,title:q.title,period:q.period,total:q.total,currency:q.currency,createdAt:row.created_at};
}
/** List durable purchases including pending payment and uncertain checkout outcomes. */
function list(db) {
  initialize(db);
  const cutoff=Date.now()-300000;
  db.prepare("UPDATE ulzix_purchases SET state = 'failed' WHERE state = 'preparing' AND started_at < ?").run(cutoff);
  db.prepare("UPDATE ulzix_purchases SET state = 'unknown' WHERE state = 'processing' AND started_at < ?").run(cutoff);
  return db.prepare('SELECT * FROM ulzix_purchases ORDER BY created_at DESC LIMIT 100').all().map(publicRecord);
}

/** Check that the administrator and current Ulzix account own the historical purchase. */
async function getQuote(db,client,userId,token) {
  initialize(db);
  const row=db.prepare('SELECT * FROM ulzix_purchases WHERE token = ? AND user_id = ?').get(token,userId);
  if(!row) throw new PurchaseError('购买记录不存在');
  const q=JSON.parse(row.quote || '{}');
  const account=await client.call('profile/get');
  if(Number(account?.id)!==q.accountId) throw new PurchaseError('API Key 所属账户与历史购买账户不一致');
  return {row,q};
}
/** Resolve an uncertain checkout only by explicitly associating an account-owned matching order. */
async function reconcile(db,client,userId,token,orderId) {
  const {row,q}=await getQuote(db,client,userId,token);
  if(row.state!=='unknown') throw new PurchaseError('此购买不需要核对关联');
  const order=await client.call('order/get',{id:orderId});
  if(Number(order?.id)!==orderId || Number(order.product_id)!==q.productId) throw new PurchaseError('订单与购买商品不匹配');
  db.prepare("UPDATE ulzix_purchases SET state = 'ordered', order_id = ? WHERE token = ? AND state = 'unknown'").run(orderId,token);
  return publicRecord(db.prepare('SELECT * FROM ulzix_purchases WHERE token = ?').get(token));
}
module.exports={PurchaseError,list,reconcile};
