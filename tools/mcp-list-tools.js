'use strict';
/* 列出麦当劳 MCP 全部工具，重点找点单/下单相关能力 */
const fs = require('fs');
const path = require('path');
const { McpClient } = require('../lib/mcp');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const token = env.match(/MCD_MCP_TOKEN\s*=\s*(.+)/)[1].trim();

(async () => {
  const mcp = new McpClient({ token });
  const tools = await mcp.listTools();
  console.log('工具总数:', tools.length);
  console.log('\n===== 全部工具 =====');
  for (const t of tools) {
    const d = (t.description || '').replace(/\s+/g, ' ').slice(0, 90);
    console.log('- ' + t.name + ' :: ' + d);
  }
  const ORDER_RE = /order|下单|点单|提交|create|submit|pay|支付|cart|购物车|checkout|结算|confirm/i;
  console.log('\n===== 与"下单"相关的候选 =====');
  for (const t of tools) {
    if (ORDER_RE.test(t.name) || ORDER_RE.test(t.description || '')) {
      console.log('\n### ' + t.name);
      console.log('desc:', (t.description || '').replace(/\s+/g, ' ').slice(0, 300));
      console.log('schema:', JSON.stringify(t.inputSchema).slice(0, 900));
    }
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
