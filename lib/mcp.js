'use strict';
/**
 * 麦当劳 MCP 客户端（Streamable HTTP / JSON-RPC 2.0）
 * 零依赖：仅使用 Node 内置 https / http 模块。
 *
 *   const mcp = new McpClient({ token });
 *   await mcp.connect();
 *   const tools = await mcp.listTools();
 *   const r = await mcp.callTool('list-nutrition-foods', {});
 *   console.log(r.text);
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_URL = 'https://mcp.mcd.cn';
const PROTOCOL_VERSION = '2025-06-18'; // 麦当劳 MCP 仅支持该版本及更早

function isEventStream(ct) { return !!ct && ct.includes('text/event-stream'); }

/** MCP Streamable HTTP 可能返回 application/json，也可能返回 SSE */
function extractMessages(contentType, raw) {
  if (isEventStream(contentType)) {
    const out = [];
    for (const line of String(raw).split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { out.push(JSON.parse(payload)); } catch (e) { /* 非 JSON 片段忽略 */ }
    }
    return out;
  }
  try { return [JSON.parse(raw)]; } catch (e) { return []; }
}

class McpClient {
  constructor({ url = DEFAULT_URL, token, timeout = 20000 } = {}) {
    if (!token) throw new Error('McpClient 需要 token');
    this.url = url;
    this.token = token;
    this.timeout = timeout;
    this.sessionId = null;
    this.serverInfo = null;
    this._seq = 1;
  }

  _post(method, params, { notify = false } = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(this.url);
      const transport = u.protocol === 'https:' ? https : http;
      const body = JSON.stringify(
        notify
          ? { jsonrpc: '2.0', method, params }
          : { jsonrpc: '2.0', id: this._seq++, method, params }
      );
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer ' + this.token,
        'Content-Length': Buffer.byteLength(body)
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

      const req = transport.request(
        { protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: 'POST', headers },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            if (!this.sessionId && res.headers['mcp-session-id']) {
              this.sessionId = res.headers['mcp-session-id'];
            }
            const msgs = extractMessages(res.headers['content-type'], raw);
            resolve({ status: res.statusCode, msgs, raw });
          });
        }
      );
      req.setTimeout(this.timeout, () => req.destroy(new Error('MCP 请求超时')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async connect() {
    const r = await this._post('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcd-fate-combo', version: '1.0.0' }
    });
    const msg = r.msgs.find((m) => m && m.result);
    if (!msg) throw new Error('MCP initialize 失败：' + String(r.raw).slice(0, 200));
    this.serverInfo = msg.result.serverInfo || null;
    await this._post('notifications/initialized', {}, { notify: true });
    return this.serverInfo;
  }

  async listTools() {
    const r = await this._post('tools/list', {});
    const msg = r.msgs.find((m) => m && m.result && m.result.tools);
    return msg ? msg.result.tools : [];
  }

  async callTool(name, args = {}) {
    const r = await this._post('tools/call', { name, arguments: args });
    const msg = r.msgs.find((m) => m && (m.result || m.error));
    if (!msg) throw new Error(`工具 ${name} 无返回：` + String(r.raw).slice(0, 200));
    if (msg.error) throw new Error(`工具 ${name} 报错：${JSON.stringify(msg.error)}`);
    const content = (msg.result && msg.result.content) || [];
    const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { text, raw: msg.result, isError: !!(msg.result && msg.result.isError) };
  }
}

module.exports = { McpClient, DEFAULT_URL };
