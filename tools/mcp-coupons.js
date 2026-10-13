'use strict';
/* 探查门店可用券的真实结构（是否含面额/可用条件） */
const fs = require('fs');
const path = require('path');
const { McpClient } = require('../lib/mcp');

const token = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .match(/^\s*MCD_MCP_TOKEN\s*=\s*(.+)\s*$/m)[1].trim();

(async () => {
  const mcp = new McpClient({ token });
  await mcp.connect();

  for (const [name, args] of [
    ['query-store-coupons', { storeCode: '1950970', orderType: 1, beType: 1 }],
    ['query-promotions', {}]
  ]) {
    try {
      const r = await mcp.callTool(name, args);
      console.log('\n===== ' + name + ' =====');
      console.log('长度:', r.text.length);
      console.log('--- JSON 尾部 ---');
      console.log(String(r.text).slice(-2200));
    } catch (e) { console.log('\n[' + name + '] 失败:', e.message); }
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
