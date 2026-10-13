'use strict';
/**
 * 麦当劳 MCP 连通性探针
 * 用途：验证 Token 可用、列出工具、抽样调用。
 *   node tools/mcp-probe.js
 * Token 来源优先级：命令行参数 > 环境变量 MCD_MCP_TOKEN > .env 文件
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const MCP_HOST = 'mcp.mcd.cn';
const MCP_PATH = '/';

function loadToken() {
  if (process.argv[2]) return process.argv[2];
  if (process.env.MCD_MCP_TOKEN) return process.env.MCD_MCP_TOKEN;
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const txt = fs.readFileSync(envPath, 'utf8');
    const m = txt.match(/^\s*MCD_MCP_TOKEN\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/** 极简 SSE / JSON 解析：MCP Streamable HTTP 可能返回 application/json 或 text/event-stream */
function parseBody(contentType, raw) {
  if (contentType && contentType.includes('text/event-stream')) {
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('data:')) {
        const payload = t.slice(5).trim();
        if (payload && payload !== '[DONE]') {
          try { out.push(JSON.parse(payload)); } catch (e) { /* 跳过非 JSON 片段 */ }
        }
      }
    }
    return out;
  }
  try { return [JSON.parse(raw)]; } catch (e) { return []; }
}

let sessionId = null;

function rpc(method, params, { notify = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(
      notify
        ? { jsonrpc: '2.0', method, params }
        : { jsonrpc: '2.0', id: Date.now() % 100000 + Math.floor(Math.random() * 1000), method, params }
    );
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Length': Buffer.byteLength(body)
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;

    const req = https.request({ host: MCP_HOST, path: MCP_PATH, method: 'POST', headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        if (!sessionId && res.headers['mcp-session-id']) sessionId = res.headers['mcp-session-id'];
        const msgs = parseBody(res.headers['content-type'], raw);
        resolve({ status: res.statusCode, headers: res.headers, msgs, raw });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const TOKEN = loadToken();
if (!TOKEN) { console.error('找不到 Token'); process.exit(1); }

(async () => {
  console.log('Token 尾号:', TOKEN.slice(-6), '长度:', TOKEN.length);

  // 1. initialize
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'mcd-fate-combo', version: '1.0.0' }
  });
  console.log('\n[1] initialize → HTTP', init.status, '| session:', sessionId ? '已获取' : '未返回');
  console.log(JSON.stringify(init.msgs[0] || init.raw.slice(0, 300), null, 2).slice(0, 700));

  // 2. notifications/initialized
  await rpc('notifications/initialized', {}, { notify: true });
  console.log('\n[2] initialized 通知已发送');

  // 3. tools/list
  const list = await rpc('tools/list', {});
  console.log('\n[3] tools/list → HTTP', list.status);
  const tools = (list.msgs[0] && list.msgs[0].result && list.msgs[0].result.tools) || [];
  console.log('工具数量:', tools.length);
  tools.forEach((t) => console.log('  -', t.name));

  // 4. 抽样调用
  const samples = [
    ['list-nutrition-foods', {}],
    ['now-time-info', {}],
    ['available-coupons', {}],
    ['query-meals', { storeCode: 'TEST' }]
  ];
  for (const [name, args] of samples) {
    if (!tools.some((t) => t.name === name)) { console.log('\n[skip]', name, '不存在'); continue; }
    const r = await rpc('tools/call', { name, arguments: args });
    const txt = JSON.stringify(r.msgs[0] || r.raw).slice(0, 600);
    console.log('\n[' + name + '] HTTP', r.status, '→', txt);
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
