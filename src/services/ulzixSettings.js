const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { validateApiKey } = require('./ulzix');
let database, encryptionKey;
const API_KEY = 'ulzix_api_key';
/** Attach the singleton panel's D1 binding and derive a separate encryption key. */
function configure(databaseBinding, secret) {
  database = databaseBinding;
  encryptionKey = database ? createHash('sha256').update('xiaoyizi:ulzix-api-key:v1:').update(secret).digest() : null;
}
/** Return metadata without exposing the API key or its ciphertext. */
async function status() {
  if (!database) return {configured:Boolean(process.env.ULZIX_API_KEY), writable:false, updatedAt:null};
  const row = await database.prepare('SELECT updated_at FROM integration_credentials WHERE name = ?').bind(API_KEY).first();
  return {configured:Boolean(row), writable:true, updatedAt:row?.updated_at || null};
}
/** Read the latest D1 value on every operation so updates never require deployment. */
async function read() {
  if (!database) return process.env.ULZIX_API_KEY || null;
  const row = await database.prepare('SELECT encrypted_value FROM integration_credentials WHERE name = ?').bind(API_KEY).first();
  if (!row) return null;
  try {
    const {iv, tag, data} = JSON.parse(row.encrypted_value);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv,'base64'));
    decipher.setAAD(Buffer.from(API_KEY));
    decipher.setAuthTag(Buffer.from(tag,'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');
  } catch { throw new Error('Ulzix API Key 解密失败，请重新保存'); }
}
/** Validate before atomically replacing the encrypted credential; never return its value. */
async function save(input) {
  if (!database) throw new Error('未绑定 Ulzix 配置 D1 数据库');
  const apiKey = validateApiKey(input);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(API_KEY));
  const data = Buffer.concat([cipher.update(apiKey,'utf8'),cipher.final()]);
  const encrypted = JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
  const updatedAt = new Date().toISOString();
  await database.batch([
    database.prepare('INSERT INTO integration_credentials (name, encrypted_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = excluded.updated_at').bind(API_KEY,encrypted,updatedAt),
    database.prepare('DELETE FROM integration_credentials WHERE name = ?').bind('ulzix_cookies'),
  ]);
  return {configured:true, writable:true, updatedAt};
}
module.exports = {configure, status, read, save};
