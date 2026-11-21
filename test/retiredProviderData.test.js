const test = require('node:test');
const assert = require('node:assert/strict');
const NativeDatabase = require('better-sqlite3');
const databasePath = require.resolve('../src/services/database');
const sqlitePath = require.resolve('better-sqlite3');
const nativeModule = require.cache[sqlitePath];

// Use the application's schema with an isolated SQLite database.
require.cache[sqlitePath] = { ...nativeModule, exports: function () { return new NativeDatabase(':memory:'); } };
const database = require(databasePath);
require.cache[sqlitePath] = nativeModule;
const { runMigrations, retiredOrderColumn, retiredPurchasesTable } = require('../src/services/migrations');
const { createBackup, restoreBackup, readBackup } = require('../workers/backups');

test('upgrade and old snapshot restoration discard retired orders and preserve nodes', t => {
  t.after(() => database.closeDb());
  const db = database.getDb();
  const { lastInsertRowid: nodeId } = database.addNode({
    name: 'Existing node', host: '192.0.2.10', port: 443, uuid: 'legacy-node',
  });
  db.exec(`ALTER TABLE nodes ADD COLUMN ${retiredOrderColumn} INTEGER`);
  db.exec(`CREATE TABLE ${retiredPurchasesTable} (order_id INTEGER)`);
  db.exec(`INSERT INTO ${retiredPurchasesTable} VALUES (51)`);
  db.prepare(`UPDATE nodes SET ${retiredOrderColumn} = 51 WHERE id = ?`).run(nodeId);

  const oldSnapshot = createBackup();
  runMigrations(db);
  runMigrations(db);

  assert.equal(database.getNodeById(nodeId).name, 'Existing node');
  assert.equal(db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(retiredPurchasesTable), undefined);
  assert.ok(!db.pragma('table_info(nodes)').some(column => column.name === retiredOrderColumn));

  database.updateNode(nodeId, { name: 'Updated node' });
  restoreBackup(oldSnapshot);
  assert.equal(database.getNodeById(nodeId).name, 'Existing node');
  const current = JSON.parse(readBackup(createBackup()));
  assert.ok(!Object.hasOwn(current.tables, retiredPurchasesTable));
  assert.ok(!Object.hasOwn(current.tables.nodes[0], retiredOrderColumn));
});
