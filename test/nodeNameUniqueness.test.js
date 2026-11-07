const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-session-secret';
}

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

function withMockedAdminNodesRouter(mockDb, fn, mockDeploy = {}) {
  const routePath = require.resolve('../src/routes/admin/adminNodes');
  const dbPath = require.resolve('../src/services/database');
  const deployPath = require.resolve('../src/services/deploy');
  const agentWsPath = require.resolve('../src/services/agent-ws');
  const loggerPath = require.resolve('../src/services/logger');
  const configEventsPath = require.resolve('../src/services/configEvents');

  const prev = {
    route: require.cache[routePath],
    db: require.cache[dbPath],
    deploy: require.cache[deployPath],
    agentWs: require.cache[agentWsPath],
    logger: require.cache[loggerPath],
    configEvents: require.cache[configEventsPath],
  };

  delete require.cache[routePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockDb };
  require.cache[deployPath] = { id: deployPath, filename: deployPath, loaded: true, exports: mockDeploy };
  require.cache[agentWsPath] = { id: agentWsPath, filename: agentWsPath, loaded: true, exports: { isAgentOnline: () => false } };
  require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { error() {}, warn() {}, info() {}, debug() {} } };
  require.cache[configEventsPath] = { id: configEventsPath, filename: configEventsPath, loaded: true, exports: { emitSyncNode() {} } };

  return Promise.resolve()
    .then(() => require('../src/routes/admin/adminNodes'))
    .then((router) => fn(router))
    .finally(() => {
      delete require.cache[routePath];
      if (prev.route) require.cache[routePath] = prev.route; else delete require.cache[routePath];
      if (prev.db) require.cache[dbPath] = prev.db; else delete require.cache[dbPath];
      if (prev.deploy) require.cache[deployPath] = prev.deploy; else delete require.cache[deployPath];
      if (prev.agentWs) require.cache[agentWsPath] = prev.agentWs; else delete require.cache[agentWsPath];
      if (prev.logger) require.cache[loggerPath] = prev.logger; else delete require.cache[loggerPath];
      if (prev.configEvents) require.cache[configEventsPath] = prev.configEvents; else delete require.cache[configEventsPath];
    });
}

test('generateNodeName falls back to numbered suffix when city names are exhausted', () => {
  const { generateNodeName } = require('../src/services/deploy');
  const { BEAUTIFUL_NAMES } = require('../src/utils/names');
  const geo = { cityCN: '新加坡' };
  const existingNodes = BEAUTIFUL_NAMES.map((word) => ({ name: `新加坡-${word}` }));

  const name = generateNodeName(geo, existingNodes, false);

  assert.match(name, /^新加坡-.+ \(\d+\)$/);
  assert.ok(!existingNodes.some((node) => node.name === name));
});

test('POST /nodes/manual rejects duplicate node names', async (t) => {
  await withMockedAdminNodesRouter({
    getNodeByName: (name) => (name === '新加坡-万紫千红' ? { id: 2, name } : null),
    addNode: () => { throw new Error('should not insert duplicate name'); },
    updateNode: () => {},
    addAuditLog: () => {},
  }, async (router) => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use((req, _res, next) => {
      req.user = { id: 1 };
      req.clientIp = '127.0.0.1';
      next();
    });
    app.use('/admin/api', router);

    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/admin/api/nodes/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '新加坡-万紫千红',
        host: '1.2.3.4',
        port: 443,
        protocol: 'vless',
      }),
    });

    assert.equal(resp.status, 400);
    assert.deepEqual(await resp.json(), { error: '节点名称已存在' });
  });
});

test('smart deployment forwards fixed ports and rejects invalid or conflicting ports', async (t) => {
  const calls = [];
  const deploy = async (info) => { calls.push(info); };
  await withMockedAdminNodesRouter({ getAllNodes: () => [], addAuditLog() {} }, async (router) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 1 }; next(); });
    app.use(router);
    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise(resolve => server.close(resolve)));

    const send = fields => fetch(baseUrl + '/nodes/deploy-smart', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: '203.0.113.20', ssh_password: 'test', ssh_port: '2200',
        enable_vless: 'on', enable_ss: 'on', enable_hy2: 'on',
        vless_port: '14443', hy2_port: '14443', ...fields,
      }),
    });

    for (const fields of [{ ss_port: '14443' }, { ss_port: '2200' }, { ss_port: '65536' }, { ss_port: '123x' }, { vless_port: '7653' }, { hy2_port: '24443', ss_port: '24443' }]) {
      assert.match((await send(fields)).headers.get('location'), /invalid_deploy_port/);
    }
    assert.equal(calls.length, 0);
    assert.match((await send({})).headers.get('location'), /deploying/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].ports.vless, 14443);
    assert.equal(calls[0].ports.hy2, 14443);
    assert.notEqual(calls[0].ports.ss, 14443);
    assert.notEqual(calls[0].ports.ss, 2200);
    assert.deepEqual(calls[0].fixedPorts, { vless: true, hy2: true });
    assert.deepEqual(calls[0].ports, calls[1].ports);
  }, { deployDualNode: deploy, deployHy2Node: deploy });
});
