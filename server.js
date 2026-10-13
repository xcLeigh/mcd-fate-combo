'use strict';
/**
 * 麦门本命套餐机 · 本地服务
 * 零依赖：仅使用 Node 内置 http / fs / path / url 模块。
 *
 *   node server.js            # 默认 http://localhost:8788
 *   PORT=9000 node server.js
 *
 * 数据源：
 *   · 配置了 MCD_MCP_TOKEN（环境变量或 .env）→ 调用麦当劳 MCP 实时拉取
 *   · 未配置或调用失败 → 回退到 data/mcd-menu.json 快照
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { divine } = require('./lib/fate');
const { fetchLiveMenu, fetchNearbyStores, quotePrice } = require('./lib/mcp-source');
const { createOrder, queryOrder } = require('./lib/order');

const PORT = process.env.PORT || 8788;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const LIVE_TTL = 10 * 60 * 1000;   // 实时菜单缓存 10 分钟

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/* ---------------- 极简 .env 读取（零依赖） ---------------- */
function loadDotEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
loadDotEnv();
const TOKEN = process.env.MCD_MCP_TOKEN || '';

/* ---------------- 数据源 ---------------- */
let liveCache = null;
let liveError = null;

function loadSnapshot() {
  const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mcd-menu.json'), 'utf8'));
  return {
    source: 'MCP 数据快照',
    store: null,
    stores: [],
    fetchedAt: snap.snapshotAt,
    items: snap.items,
    coupons: snap.coupons,
    nutrition: null
  };
}

async function getMenu({ force = false, storeCode = null } = {}) {
  if (!TOKEN) return loadSnapshot();
  const now = Date.now();
  const key = storeCode ? String(storeCode) : 'nearest';
  if (!force && liveCache && liveCache.key === key && now - liveCache.ts < LIVE_TTL) return liveCache.data;
  try {
    const data = await fetchLiveMenu({
      token: TOKEN,
      city: process.env.MCD_CITY || '北京市',
      keyword: '麦当劳',
      storeCode
    });
    liveCache = { ts: now, data, key };
    liveError = null;
    return data;
  } catch (e) {
    liveError = e.message;
    console.warn('[MCP] 实时拉取失败，回退快照：' + e.message);
    return liveCache ? liveCache.data : loadSnapshot();
  }
}

/* ---------------- HTTP 工具 ---------------- */
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const ZODIACS = ['白羊','金牛','双子','巨蟹','狮子','处女','天秤','天蝎','射手','摩羯','水瓶','双鱼'];
const MOODS = ['开心','emo','暴躁','平静','想暴富','好累'];
const CODES = ['刚提PR','被review打回','改了一天bug','摸鱼划水','上线成功'];

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  if (pathname === '/api/health') {
    return sendJSON(res, 200, {
      ok: true,
      mcp: TOKEN ? 'live' : 'mock-snapshot',
      mcpError: liveError,
      ts: Date.now()
    });
  }

  if (pathname === '/api/options') {
    return sendJSON(res, 200, { ok: true, data: { zodiacs: ZODIACS, moods: MOODS, codes: CODES } });
  }

  if (pathname === '/api/menu') {
    const menu = await getMenu({ storeCode: parsed.query.store });
    return sendJSON(res, 200, {
      ok: true,
      data: {
        source: menu.source, store: menu.store, stores: menu.stores || [],
        fetchedAt: menu.fetchedAt, itemCount: menu.items.length,
        coupons: menu.coupons, nutrition: menu.nutrition
      }
    });
  }

  /* 附近门店列表（供前端切换门店） */
  if (pathname === '/api/stores') {
    if (!TOKEN) return sendJSON(res, 200, { ok: true, data: { stores: [], source: '快照模式不支持门店切换' } });
    try {
      const { stores } = await fetchNearbyStores({
        token: TOKEN,
        city: process.env.MCD_CITY || '北京市',
        keyword: '麦当劳'
      });
      return sendJSON(res, 200, { ok: true, data: { stores } });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, error: e.message, data: { stores: [] } });
    }
  }

  /* 一键下单：真实调用麦当劳 MCP create-order */
  if (pathname === '/api/order' && req.method === 'POST') {
    if (!TOKEN) {
      return sendJSON(res, 400, { ok: false, error: '未配置 MCD_MCP_TOKEN，无法调用真实下单接口' });
    }
    try {
      const body = await readBody(req);
      const zodiac = ZODIACS.includes(body.zodiac) ? body.zodiac : '水瓶';
      const mood = MOODS.includes(body.mood) ? body.mood : '平静';
      const code = CODES.includes(body.code) ? body.code : '摸鱼划水';
      const budget = Math.min(90, Math.max(15, Number(body.budget) || 45));

      const menu = await getMenu({ storeCode: body.storeCode });
      if (!menu.store || !menu.store.storeCode) {
        return sendJSON(res, 400, { ok: false, error: '当前为快照模式，未连接真实门店，无法下单' });
      }

      // 用同一套确定性算法复算，确保下单内容与用户看到的一致
      const result = divine({ zodiac, mood, code, budget }, menu.items, menu.coupons || []);
      if (!result.picked.length) {
        return sendJSON(res, 400, { ok: false, error: '未能生成本命套餐' });
      }

      const order = await createOrder({
        token: TOKEN,
        storeCode: menu.store.storeCode,
        orderType: menu.orderType || 1,
        beType: menu.beType || 1,
        codes: result.picked.map((p) => p.code),
        takeWayCode: body.takeWay || undefined,
        remark: body.remark
      });

      return sendJSON(res, 200, {
        ok: true,
        data: {
          order,
          store: menu.store,
          items: result.picked.map((p) => ({ code: p.code, name: p.name, price: p.price })),
          total: result.total
        }
      });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, error: e.message });
    }
  }

  /* 查询订单状态 */
  if (pathname === '/api/order/query' && req.method === 'POST') {
    if (!TOKEN) return sendJSON(res, 400, { ok: false, error: '未配置 MCD_MCP_TOKEN' });
    try {
      const body = await readBody(req);
      if (!body.orderId) return sendJSON(res, 400, { ok: false, error: '缺少 orderId' });
      const r = await queryOrder({ token: TOKEN, orderId: body.orderId });
      return sendJSON(res, 200, { ok: true, data: r });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/divine' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const zodiac = ZODIACS.includes(body.zodiac) ? body.zodiac : '水瓶';
      const mood = MOODS.includes(body.mood) ? body.mood : '平静';
      const code = CODES.includes(body.code) ? body.code : '摸鱼划水';
      const budget = Math.min(90, Math.max(15, Number(body.budget) || 45));

      const menu = await getMenu({ storeCode: body.storeCode });
      const result = divine({ zodiac, mood, code, budget }, menu.items, menu.coupons || []);
      result.dataSource = menu.source;
      result.store = menu.store;
      result.stores = menu.stores || [];
      result.fetchedAt = menu.fetchedAt;
      result.availableCoupons = (menu.coupons || []).slice(0, 12);

      // 官方核价：把选好的组合交给 calculate-price 复核（失败不影响主流程）
      if (TOKEN && menu.store && menu.store.storeCode && result.picked.length) {
        try {
          const q = await quotePrice({
            token: TOKEN,
            storeCode: menu.store.storeCode,
            orderType: menu.orderType || 1,
            beType: menu.beType || 1,
            codes: result.picked.map((p) => p.code)
          });
          if (q && q.success && q.data) {
            const cents = Number(q.data.price);
            result.officialQuote = {
              price: isNaN(cents) ? null : Math.round(cents) / 100,
              discount: Number(q.data.discount || 0) / 100,
              takeWayList: (q.data.takeWayList || []).map((t) => ({
                code: t.code, title: t.title, subtitle: t.subtitle || ''
              })),
              productList: (q.data.productList || []).map((p) => ({
                code: p.productCode, name: p.productName, subtotal: Number(p.subtotal) / 100
              }))
            };
          }
        } catch (e) {
          result.officialQuoteError = e.message;
        }
      }

      return sendJSON(res, 200, { ok: true, data: result });
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: '请求解析失败：' + e.message });
    }
  }

  if (pathname.startsWith('/api/')) return sendJSON(res, 404, { ok: false, error: 'no such api' });
  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  麦门本命套餐机 已启动 🍔');
  console.log('  → http://localhost:' + PORT);
  console.log('  数据源：' + (TOKEN ? '麦当劳 MCP 实时 (mcp.mcd.cn)' : '本地快照 data/mcd-menu.json'));
  console.log('');
});
