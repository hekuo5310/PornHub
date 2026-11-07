/** Fixed-origin FOSSBilling API client for Ulzix. */
const BASE_URL = 'https://idc-new.ulzix.com';
const CLIENT_METHODS = new Set(['order/get_list', 'order/get', 'order/service', 'profile/get']);
const GUEST_METHODS = new Set(['product/category_get_list', 'product/get_list', 'product/get']);

/** Normalize a client API key and reject whitespace and control characters. */
function validateApiKey(input) {
  const key = typeof input === 'string' ? input.trim() : '';
  if (!/^[!-~]{1,512}$/.test(key)) throw new Error('请输入有效的 Ulzix 客户 API Key');
  return key;
}

class UlzixClient {
  /** Use a server-side key for client endpoints; public catalog requests are anonymous. */
  constructor(apiKey, fetcher = (...args) => fetch(...args)) {
    this.apiKey = apiKey ? validateApiKey(apiKey) : null;
    this.fetcher = fetcher;
  }
  /** Send an allowlisted Client API request and validate its bounded JSON response. */
  async call(method, params = {}, scope = 'client') {
    const readOnly = scope === 'guest';
    const allowed = readOnly ? GUEST_METHODS : scope === 'client' ? CLIENT_METHODS : null;
    if (!allowed?.has(method)) {
      throw new Error('未支持的 Ulzix API 方法');
    }
    const headers = { Accept: 'application/json' };
    if (!readOnly) {
      if (!this.apiKey) throw new Error('请在后台 Ulzix 集成中保存客户 API Key');
      headers.Authorization = 'Basic ' + Buffer.from('client:' + this.apiKey).toString('base64');
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const body = new URLSearchParams(params);
    let response;
    const url = `${BASE_URL}/api/${scope}/${method}`;
    try { response = await this.fetcher(readOnly ? url+'?'+body : url, {method:readOnly ? 'GET' : 'POST', headers, ...(readOnly ? {} : {body}), redirect:'manual', signal: AbortSignal.timeout(15000)}); }
    catch { throw new Error('Ulzix 连接失败或超时'); }
    if ([301,302,303,307,308,401,403].includes(response.status)) throw new Error('Ulzix 拒绝 API 请求，请检查客户 API Key 与权限');
    if (!response.ok) throw new Error(`Ulzix API 请求失败（HTTP ${response.status}）`);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Ulzix 返回非 JSON 响应，请检查 API 配置');
    // Bound upstream responses before parsing (contains account-owned data).
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) { const {done,value} = await reader.read(); if(done) break; size += value.byteLength; if(size > 2097152) {await reader.cancel(); throw new Error('Ulzix API 响应过大');} chunks.push(value); }
    let json;
    try { const bytes = new Uint8Array(size); let i=0; for(const c of chunks) {bytes.set(c,i); i+=c.length;} json = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error('Ulzix API 响应格式无效'); }
    if (json.error) throw new Error(`Ulzix API 拒绝请求（代码 ${Number(json.error.code) || 'unknown'}），请检查 API 配置与权限`);
    if (!Object.hasOwn(json,'result')) throw new Error('Ulzix API 缺少 result');
    return json.result;
  }
  /** Access only the explicitly supported public catalog and product endpoints. */
  guest(method, params = {}) { return this.call(method,params,'guest'); }
  /** Read every catalog page with the same bounded pagination used for orders. */
  async catalog(method) {
    const list=[];
    for(let page=1;page<=100;page++) {
      const result=await this.guest(method,{page,per_page:20});
      if(!result || !Array.isArray(result.list)) throw new Error('Ulzix 商品列表格式无效');
      list.push(...result.list);
      if(page>=Number(result.pages || 1)) return list;
    }
    throw new Error('Ulzix 商品超过分页上限');
  }
  /** Collect every client order page while enforcing the pagination limit. */
  async listOrders() {
    const orders = [];
    for(let page=1; page<=100; page++) {
      const result = await this.call('order/get_list', {page, per_page:100});
      if (!result || !Array.isArray(result.list)) throw new Error('Ulzix 订单列表格式无效');
      orders.push(...result.list);
      if (page >= Number(result.pages || 1)) return orders;
    }
    throw new Error('Ulzix 订单超过分页上限');
  }
}
module.exports = { UlzixClient, validateApiKey, BASE_URL };
