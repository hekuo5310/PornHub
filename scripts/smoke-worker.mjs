import { Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse } from 'miniflare';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const state=await fs.mkdtemp(path.join(os.tmpdir(),'xiaoyizi-worker-'));
let expectedUlzixKey;
const options=convertV4MiniflareOptions({
  workers:[{name:'xiaoyizi',scriptPath:'dist/worker.mjs',modules:true,compatibilityDate:'2026-11-06',compatibilityFlags:['nodejs_compat'],
    durableObjects:{PANEL:{className:'Panel',useSQLite:true}},
    d1Databases:['ULZIX_CONFIG'],
    // Block real outbound traffic and verify credentials through the complete Worker path.
    outboundService: async request => {
      const url=new URL(request.url);
      const method=url.pathname.replace('/api/','');
      const product={id:67,product_category_id:11,title:'Mock NAT',type:'lxdapi',pricing:{type:'recurrent',recurrent:{'1Y':{enabled:true,price:4.5,setup:0}}}};
      assert.equal(request.headers.get('cookie'),null);
      assert.equal(request.headers.get('x-csrf-token'),null);
      if(method.startsWith('guest/product/')) {
        assert.equal(request.headers.get('authorization'),null);assert.equal(request.method,'GET');assert.ok(!url.searchParams.has('CSRFToken'));
        const result=method==='guest/product/get' ? product : {list:method==='guest/product/category_get_list' ? [{id:11,title:'NAT'}] : [product],pages:1};
        return MiniflareResponse.json({result,error:null});
      }
      if(request.headers.get('authorization') !== 'Basic '+Buffer.from('client:'+expectedUlzixKey).toString('base64')) {
        return MiniflareResponse.json({result:null,error:{code:401}}, {status:401});
      }
      let result;
      if(method==='client/order/get_list') result={list:[{id:991,title:'Mock NAT',status:'pending_setup',service_type:'lxdapi'}],pages:1};
      else if(method==='client/profile/get') result={id:7};
      else if(method==='client/order/get') {const body=new URLSearchParams(await request.text());result={id:Number(body.get('id')),product_id:67,status:'pending_setup'};}
      else throw new Error('Unexpected outbound request: '+method);
      return MiniflareResponse.json({result,error:null});
    },
    bindings:{NODE_ENV:'production',SESSION_SECRET:'local-worker-smoke-test-secret-32-characters-minimum',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'Local123456',ADMIN_PASSWORD_REVISION:'local-revision-1'},
  }],cf:false,host:'127.0.0.1',port:0,inspectorPort:0,resourcePersistencePath:state,
});
let mf=new Miniflare(options), cookie='', csrf='';
/** Dispatch a local Worker request with the current test session cookie. */
const request=(route,init={})=>mf.dispatchFetch('https://panel.test'+route,{redirect:'manual',...init,headers:{Cookie:cookie,...init.headers}});
/** Send authenticated JSON to the local Worker with its session CSRF token. */
const post=(route,body)=>request(route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
try {
  const configDb = await mf.getD1Database('ULZIX_CONFIG');
  await configDb.prepare(await fs.readFile('migrations/0001_integration_credentials.sql','utf8')).run();
  assert.equal((await request('/healthz')).status,200);
  const loginPage=await request('/auth/login'); assert.equal(loginPage.status,200); assert.match(await loginPage.text(),/Pоrпнub/);
  assert.equal((await request('/admin')).status,302);
  let r=await request('/auth/email-login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:'admin@example.test',password:'Local123456'})});
  assert.equal(r.status,302); assert.equal(r.headers.get('location'),'/');
  cookie=r.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  r=await request('/admin'); const admin=await r.text(); assert.equal(r.status,200,admin.slice(0,500)); assert.match(admin,/Ulzix/);
  csrf=admin.match(/window\._csrf\s*=\s*['"]([^'"]+)/)?.[1] || admin.match(/const csrfToken\s*=\s*['"]([^'"]+)/)?.[1]; assert.ok(csrf,'CSRF token');
  for(const route of ['/admin/api/users','/admin/api/users?search=admin','/admin/api/invite-relations','/admin/api/invite-relations?search=admin','/admin/api/logs?search=admin','/admin/api/sub-stats?search=admin']) {
    const result=await request(route); assert.equal(result.status,200,await result.clone().text());
    if(route.startsWith('/admin/api/users')) assert.equal((await result.json()).total,1);
  }
  assert.deepEqual(await (await request('/admin/api/ulzix/config')).json(),{configured:false,writable:true,updatedAt:null,baseUrl:'https://idc-new.ulzix.com'});
  assert.equal((await post('/admin/api/ulzix/config',{apiKey:'bad key'})).status,400);
  assert.equal((await request('/admin/api/ulzix/config',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  await configDb.prepare("INSERT INTO integration_credentials VALUES ('ulzix_cookies', 'legacy-credential', '2026-11-06')").run();
  r=await request('/admin/api/ulzix/orders'); assert.equal(r.status,502); assert.match((await r.json()).error,/API Key/);
  expectedUlzixKey='local-smoke-key';
  r=await post('/admin/api/ulzix/config',{apiKey:expectedUlzixKey}); assert.equal(r.status,200,await r.clone().text());
  assert.ok(!(await r.text()).includes(expectedUlzixKey));
  assert.equal(await configDb.prepare("SELECT name FROM integration_credentials WHERE name = 'ulzix_cookies'").first(),null);
  let stored=await configDb.prepare('SELECT encrypted_value FROM integration_credentials').first();
  assert.ok(!stored.encrypted_value.includes(expectedUlzixKey),'D1 must store ciphertext');
  assert.equal((await request('/admin/api/ulzix/orders')).status,200);
  assert.equal((await post('/admin/api/ulzix/config',{apiKey:'wrong-key'})).status,502);
  assert.equal((await configDb.prepare('SELECT encrypted_value FROM integration_credentials').first()).encrypted_value,stored.encrypted_value,'Rejected keys preserve the last credential');
  expectedUlzixKey='updated-smoke-key';
  r=await post('/admin/api/ulzix/config',{apiKey:expectedUlzixKey}); assert.equal(r.status,200);
  assert.notEqual((await configDb.prepare('SELECT encrypted_value FROM integration_credentials').first()).encrypted_value,stored.encrypted_value);
  assert.equal((await request('/admin/api/ulzix/orders')).status,200,'Key replacement takes effect immediately');
  assert.equal((await request('/admin/api/nodes/manual',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  r=await post('/admin/api/nodes/manual',{name:'Worker smoke node',host:'203.0.113.10',port:443,protocol:'vless'}); assert.equal(r.status,200,await r.clone().text()); const nodeId=(await r.json()).id;
  r=await request(`/admin/api/nodes/${nodeId}/info`); assert.equal(r.status,200); const info=await r.json();
  r=await post('/admin/api/backups/create',{}); assert.equal(r.status,200,await r.clone().text()); const backup=(await r.json()).backup;
  r=await request('/admin/api/backups/download/'+backup); assert.equal(r.status,200); const snapshot=await r.json(); assert.equal(snapshot.format,'xiaoyizi-worker-v1');
  const node=snapshot.tables.nodes.find(n=>n.id===nodeId); assert.ok(node.agent_token,'Agent token');
  r=await request('/'); assert.equal(r.status,200,await r.clone().text());
  r=await request('/suball/'+snapshot.tables.users[0].sub_token,{headers:{'User-Agent':'clash-meta'}}); assert.equal(r.status,200,await r.clone().text());
  assert.ok((await r.text()).length,'Subscription');
  // Real WebSocket authentication and report flow through a Durable Object.
  r=await request('/ws/agent',{headers:{Upgrade:'websocket'}}); assert.equal(r.status,101); const ws=r.webSocket; ws.accept();
  /** Wait for one Agent reply and reject on a bounded timeout. */
  const nextMessage=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('WebSocket response timeout')),5000);ws.addEventListener('message',e=>{clearTimeout(timeout);resolve(JSON.parse(e.data));},{once:true});});
  let next=nextMessage(); ws.send(JSON.stringify({type:'auth',nodeId,token:node.agent_token})); assert.equal((await next).type,'auth_ok');
  ws.send(JSON.stringify({type:'report',xrayAlive:true,cnReachable:true,loadAvg:[0,0,0],memUsage:{usagePercent:10},trafficRecords:[]}));
  assert.equal((await request('/admin/api/agents')).status,200);
  const command=post(`/admin/api/agents/${nodeId}/command`,{type:'ping'}); next=nextMessage(); const payload=await next; ws.send(JSON.stringify({type:'cmd_result',id:payload.id,success:true,stdout:'pong'})); assert.equal((await (await command).json()).success,true); ws.close();
  const namespace=await mf.getDurableObjectNamespace('PANEL');
  const stub=namespace.get(namespace.idFromName('xiaoyizi'));
  const scheduledTime=Date.UTC(2026,10,5,18,0);
  await stub.runScheduled(scheduledTime);
  const backupCount=(await (await request('/admin/api/backups')).json()).backups.length;
  await stub.runScheduled(scheduledTime);
  assert.equal((await (await request('/admin/api/backups')).json()).backups.length,backupCount,'Cron retry must not duplicate backup');
  await mf.dispose(); mf=new Miniflare(options);
  r=await request('/admin'); assert.equal(r.status,200,await r.clone().text());
  assert.equal((await (await request('/admin/api/ulzix/config')).json()).configured,true,'D1 credential survives restart');
  assert.equal((await request('/admin/api/ulzix/orders')).status,200,'D1 key is usable after restart');
  r=await request(`/admin/api/nodes/${nodeId}/info`); assert.equal(r.status,200); assert.equal((await r.json()).traffic_cap,0);
  r=await request('/admin/api/ulzix/catalog');assert.equal(r.status,200,await r.clone().text());const catalog=await r.json();assert.equal(catalog.categories[0].id,11);assert.equal(catalog.products[0].id,67);
  const orders=await (await request('/admin/api/ulzix/orders')).json();assert.equal(orders.orders[0].id,991);
  r=await post('/admin/api/nodes/deploy-smart',{host:'203.0.113.20',ssh_password:'local-test-password',enable_vless:'on',ulzix_order_id:991});assert.equal(r.status,302);assert.match(r.headers.get('location'),/ulzix_not_active/);
  r=await post('/admin/api/backups/restore',{name:backup}); assert.equal(r.status,200,await r.clone().text());
  assert.equal((await request('/admin')).status,302,'Restore invalidates sessions');
  console.log('PASS: Worker boot, precompiled views, login, CSRF, Ulzix failure handling, node CRUD, Agent WebSocket/report/commands, backups and restore, Cron retry deduplication, session/data survival after restart');
} finally {await mf.dispose();await fs.rm(state,{recursive:true,force:true});}
