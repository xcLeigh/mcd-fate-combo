'use strict';
/* 抓取 MCP 工具 schema 与真实返回样本，用于构建数据映射 */
const fs = require('fs');
const path = require('path');
const { McpClient } = require('../lib/mcp');

function loadToken() {
  if (process.env.MCD_MCP_TOKEN) return process.env.MCD_MCP_TOKEN;
  const p = path.join(__dirname, '..', '.env');
  if (fs.existsSync(p)) {
    const m = fs.readFileSync(p, 'utf8').match(/^\s*MCD_MCP_TOKEN\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('no token');
}

const OUT = path.join(__dirname, '..', 'data', 'mcp-raw');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const mcp = new McpClient({ token: loadToken() });
  const info = await mcp.connect();
  console.log('serverInfo:', JSON.stringify(info));

  const tools = await mcp.listTools();
  fs.writeFileSync(path.join(OUT, 'tools.json'), JSON.stringify(tools, null, 2), 'utf8');
  console.log('工具数:', tools.length, '→ data/mcp-raw/tools.json');

  const want = ['query-meals', 'query-nearby-stores', 'list-nutrition-foods',
                'available-coupons', 'query-my-coupons', 'calculate-price', 'query-meal-detail'];
  for (const t of tools) {
    if (!want.includes(t.name)) continue;
    console.log('\n===== ' + t.name + ' =====');
    console.log('desc:', (t.description || '').slice(0, 160));
    console.log('schema:', JSON.stringify(t.inputSchema || {}).slice(0, 900));
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
