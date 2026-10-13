'use strict';
/* 拉取真实门店 + 菜单 + 营养 + 券，落盘为样本 */
const fs = require('fs');
const path = require('path');
const { McpClient } = require('../lib/mcp');

function loadToken() {
  if (process.env.MCD_MCP_TOKEN) return process.env.MCD_MCP_TOKEN;
  const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .match(/^\s*MCD_MCP_TOKEN\s*=\s*(.+)\s*$/m);
  return m[1].trim();
}

const OUT = path.join(__dirname, '..', 'data', 'mcp-raw');
fs.mkdirSync(OUT, { recursive: true });
const save = (n, t) => fs.writeFileSync(path.join(OUT, n), t, 'utf8');

const show = (n, t, len = 1400) => {
  console.log('\n===== ' + n + ' =====');
  console.log(String(t).slice(0, len));
};

(async () => {
  const mcp = new McpClient({ token: loadToken() });
  await mcp.connect();

  // 1) 附近门店
  const stores = await mcp.callTool('query-nearby-stores', {
    beType: 1, searchType: 2, city: '北京市', keyword: '麦当劳'
  });
  save('nearby-stores.txt', stores.text);
  show('query-nearby-stores', stores.text, 1800);

  // 尝试从返回文本里抓 storeCode
  const codes = [...String(stores.text).matchAll(/"?storeCode"?\s*[:："']\s*"?(\d{4,})/g)].map((m) => m[1]);
  const uniq = [...new Set(codes)];
  console.log('\n解析到的 storeCode 候选:', uniq.slice(0, 5));
  const storeCode = uniq[0] || '1001';

  // 2) 菜单
  const meals = await mcp.callTool('query-meals', { storeCode, orderType: 1, beType: 1 });
  save('query-meals.txt', meals.text);
  show('query-meals', meals.text, 2500);

  // 3) 营养
  const nut = await mcp.callTool('list-nutrition-foods', {});
  save('nutrition.txt', nut.text);
  show('list-nutrition-foods', nut.text, 1200);

  // 4) 可领券
  const cp = await mcp.callTool('available-coupons', {});
  save('available-coupons.txt', cp.text);
  show('available-coupons', cp.text, 900);

  // 5) 我的券
  try {
    const my = await mcp.callTool('query-my-coupons', { page: '1', pageSize: '200' });
    save('my-coupons.txt', my.text);
    show('query-my-coupons', my.text, 900);
  } catch (e) { console.log('\n[query-my-coupons] 跳过：' + e.message); }

  console.log('\n样本已保存到 data/mcp-raw/');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
