const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApiKey, UlzixClient, BASE_URL } = require('../src/services/ulzix');
const apiKey = 'test-client-key';

test('Ulzix normalizes API keys and rejects invalid input', () => {
  assert.equal(validateApiKey('  test-client-key  '), apiKey);
  for (const input of ['', {}, 'bad key', 'key\r\nother', 'a'.repeat(513)]) {
    assert.throws(() => validateApiKey(input), /API Key/);
  }
});

test('Ulzix authenticates fixed-origin client calls without session credentials', async () => {
  const client = new UlzixClient(apiKey, async (url, init) => {
    assert.equal(url, BASE_URL + '/api/client/order/get');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('client:' + apiKey).toString('base64'));
    assert.equal(init.headers.Cookie, undefined);
    assert.equal(init.headers['X-CSRF-Token'], undefined);
    assert.equal(init.body.get('CSRFToken'), null);
    assert.equal(init.body.get('id'), '42');
    return Response.json({ result: { id: 42 }, error: null });
  });
  assert.deepEqual(await client.call('order/get', { id: 42 }), { id: 42 });
  await assert.rejects(client.call('../admin/client/get'), /未支持/);
  await assert.rejects(client.call('cart/checkout'), /未支持/);
  await assert.rejects(client.guest('cart/add_item'), /未支持/);
  await assert.rejects(new UlzixClient().call('order/get'), /保存客户 API Key/);
});

test('Ulzix does not send the API key to public catalog endpoints', async () => {
  const client = new UlzixClient(apiKey, async (url, init) => {
    assert.equal(url, BASE_URL + '/api/guest/product/get?id=42');
    assert.equal(init.method, 'GET');
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    return Response.json({ result: { id: 42 } });
  });
  assert.deepEqual(await client.guest('product/get', { id: 42 }), { id: 42 });
});

test('Ulzix paginates client orders', async () => {
  const client = new UlzixClient(apiKey, async (_url, init) => {
    const page = Number(init.body.get('page'));
    return Response.json({ result: { list: [{ id: page }], pages: 2 } });
  });
  assert.deepEqual(await client.listOrders(), [{ id: 1 }, { id: 2 }]);
});

test('Ulzix rejects redirects and sanitizes upstream errors', async () => {
  await assert.rejects(new UlzixClient(apiKey, async () => new Response(null, { status: 302 })).call('order/get'), /API Key/);
  await assert.rejects(new UlzixClient(apiKey, async () => Response.json({ error: { code: 403, message: apiKey } })).call('order/get'), e => !e.message.includes(apiKey) && e.message.includes('403'));
  await assert.rejects(new UlzixClient(apiKey, async () => new Response('<html>Login</html>')).call('order/get'), /非 JSON/);
});
