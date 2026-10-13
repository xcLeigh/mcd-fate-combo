'use strict';
/* 探明：门店列表结构 / calculate-price 的 takeWayList / create-order 所需字段（只读，不产生订单） */
const fs = require('fs');
const path = require('path');
const { McpClient } = require('../lib/mcp');
const { fetchLiveMenu } = require('../lib/mcp-source');
const { divine } = require('../lib/fate');

const token = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .match(/MCD_MCP_TOKEN\s*=\s*(.+)/)[1].trim();

function extractJson(text) {
  const i = String(text).indexOf('{');
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let p = i; p < text.length; p++) {
    const c = text[p];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(i, p + 1)); } catch (e) { return null; } } }
  }
  return null;
}

(async () => {
  const mcp = new McpClient({ token });

  // ---- 1. 附近门店列表（看是否能拿到多家门店供用户选择）----
  console.log('===== query-nearby-stores =====');
  const storesRes = await mcp.callTool('query-nearby-stores', {
    beType: 1, searchType: 2, city: '北京市', keyword: '麦当劳'
  });
  const stores = extractJson(storesRes.text);
  const sl = (stores && (stores.data || stores.stores || stores.list)) || [];
  console.log('门店条数:', Array.isArray(sl) ? sl.length : '(非数组)');
  if (Array.isArray(sl)) {
    sl.slice(0, 5).forEach((s) => console.log('  -', s.storeCode, s.storeName, '|', s.address, '| beCode:', s.beCode || '(无)'));
  }
  console.log('原始 JSON 顶层键:', stores ? Object.keys(stores) : 'null');

  // ---- 2. 用真实菜单算出套餐，再核价，看 takeWayList ----
  const menu = await fetchLiveMenu({ token, city: '北京市', keyword: '麦当劳' });
  const r = divine({ zodiac: '狮子', mood: '暴躁', code: '改了一天bug', budget: 45 }, menu.items, []);
  console.log('\n===== 本命套餐 =====');
  console.log(r.picked.map((p) => `  ${p.code} ${p.name} ¥${p.price}`).join('\n'));

  const items = r.picked.map((p) => ({ productCode: p.code, quantity: 1 }));
  console.log('\n===== calculate-price 请求 =====');
  console.log(JSON.stringify({ storeCode: menu.store.storeCode, orderType: 1, beType: 1, items }, null, 1));

  const priceRes = await mcp.callTool('calculate-price', {
    storeCode: menu.store.storeCode, orderType: 1, beType: 1, items
  });
  console.log('\n===== calculate-price 返回（截断 2500 字）=====');
  console.log(String(priceRes.text).slice(0, 2500));
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
