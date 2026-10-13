'use strict';
/**
 * 麦当劳 MCP 数据源适配层
 * 职责：把 MCP 返回的「文本型」结果解析成结构化菜单 / 营养 / 券，喂给 lib/fate.js。
 *
 * 取数链路：
 *   query-nearby-stores  → 门店
 *   query-meals          → 菜单（含现价）
 *   list-nutrition-foods → 营养（toon 格式）
 *   available-coupons    → 可领券
 *   calculate-price      → 官方核价（选品完成后复核）
 */

const { McpClient } = require('./mcp');

/* ---------------- 文本解析工具 ---------------- */

/** 从工具返回的 markdown 包裹文本中抠出 JSON 对象 */
function extractJson(text) {
  const marker = String(text).indexOf('Original Response');
  const start = marker >= 0 ? text.indexOf('{', marker) : text.indexOf('{');
  if (start < 0) return null;
  for (let i = start; i < text.length; i++) {
    if (text[i] !== '{') continue;
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
      else if (c === '}') {
        depth--;
        if (depth === 0) { try { return JSON.parse(text.slice(i, p + 1)); } catch (e) { break; } }
      }
    }
  }
  return null;
}

/** 解析 toon 格式的营养表（list-nutrition-foods 的 data 字段） */
function parseToonNutrition(dataStr) {
  const lines = String(dataStr).split('\n');
  let header = null;
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!header) {
      const a = t.indexOf('{'), b = t.indexOf('}');
      if (a >= 0 && b > a) { header = t.slice(a + 1, b).split(',').map((s) => s.trim()); continue; }
      continue;
    }
    const parts = t.split(',');
    if (parts.length >= header.length - 1) {
      const rec = {};
      header.forEach((h, i) => { rec[h] = (parts[i] || '').trim(); });
      if (rec.productName) rows.push(rec);
    }
  }
  return rows;
}

/** 解析 available-coupons 的 markdown 列表 */
function parseCouponTitles(text) {
  const out = [];
  for (const m of String(text).matchAll(/优惠券标题：\s*(.+?)\s*\\?\s*$/gm)) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/* ---------------- 餐品归类与营养匹配 ---------------- */

const DRINK_RE = /可乐|雪碧|芬达|咖啡|拿铁|卡布奇诺|美式|摩卡|茶|橙汁|苹果汁|果汁|牛奶|豆浆|矿泉水|饮用水|麦炫酷|冰沙|气泡|奶昔|椰|奶茶/;
const DESSERT_RE = /冰淇淋|甜筒|圆筒|新地|麦旋风|派|蛋糕|松饼|圣代|布丁|马卡龙|曲奇/;
const SIDE_RE = /薯条|薯饼|玉米杯|麦乐鸡|鸡块|鸡翅|沙拉|苹果片|小食|拼盘|鸡排|麦麦脆汁鸡|脆薯/;
const MAIN_RE = /汉堡|堡|卷|鸡腿|鳕鱼|牛肉|巨无霸|麦香鱼|麦香鸡|安格斯|不素之霸|双牛|厚牛|板烧/;

function classify(name) {
  const n = String(name);
  if (DRINK_RE.test(n)) return 'drink';
  if (DESSERT_RE.test(n)) return 'dessert';
  if (MAIN_RE.test(n)) return 'main';
  if (SIDE_RE.test(n)) return 'side';
  return 'other';
}

/**
 * 从真实餐品名推导「风味标签」。
 * MCP 的 query-meals 不返回风味标签，但本命算法需要它做情绪匹配——
 * 因此这里用一套可解释的规则把菜名翻译成标签（不依赖大模型，结果稳定可复现）。
 */
const TAG_RULES = [
  [/麦辣|香辣|辣|椒|川/, ['辣', '解压', '上头']],
  [/麦旋风|新地|圣代|冰淇淋|甜筒|圆筒|蛋糕|松饼|派$|甜品/, ['甜', '治愈', '冰']],
  [/咖啡|拿铁|卡布奇诺|美式|浓缩|摩卡/, ['咖啡因', '提神', '续命']],
  [/红茶|奶茶|茶$|茶[^叶]/, ['提神', '温润']],
  [/可乐|雪碧|芬达|气泡|苏打/, ['快乐水', '气泡', '经典']],
  [/无糖|零度|零卡/, ['零负担', '轻盈']],
  [/巨无霸|安格斯|厚牛|不素之霸|双层牛/, ['牛肉', '招牌', '扎实']],
  [/牛/, ['牛肉']],
  [/鸡|翅/, ['鸡肉']],
  [/鱼|鳕|虾/, ['鱼']],
  [/吉士|芝士|奶酪/, ['芝士', '浓郁']],
  [/麦乐鸡|鸡块/, ['易食', '分享', '脆']],
  [/薯条|薯饼|脆薯/, ['脆', '经典', '解压']],
  [/玉米杯/, ['轻盈', '均衡', '粗粮']],
  [/沙拉|苹果片|蔬菜/, ['轻盈', '清爽', '健康']],
  [/牛奶|豆浆/, ['温润', '轻盈']],
  [/橙汁|果汁|苹果汁|柠檬/, ['果味', '清甜', '维C']],
  [/矿泉水|饮用水/, ['零负担', '清爽']],
  [/板烧|煎鸡|蒸/, ['清淡', '均衡']],
  [/麦香鱼|鱼堡/, ['轻盈', '清淡']],
  [/早餐|麦满分|松饼/, ['省事', '经典']],
  [/巨无霸|薯条|可乐|麦乐鸡|圆筒/, ['经典']]
];

function deriveTags(name, cat) {
  const set = new Set();
  for (const [re, tags] of TAG_RULES) {
    if (re.test(name)) tags.forEach((t) => set.add(t));
  }
  if (cat === 'main' && !set.size) set.add('经典');
  return [...set];
}

function normName(s) {
  return String(s)
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[™®·\s"'"'—-]/g, '')
    .replace(/^(大|中|小|迷你)/, '')
    .replace(/(杯|块|个|盒装|装|份|一袋|袋)$/g, '')
    .trim();
}

/** 最长公共子串长度 */
function lcsLen(a, b) {
  if (!a || !b) return 0;
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let last = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? last + 1 : 0;
      if (prev[j] > best) best = prev[j];
      last = tmp;
    }
  }
  return best;
}

/** 用“精确 → 归一 → 包含 → 最长公共子串”四级策略匹配营养数据 */
function buildNutritionIndex(rows) {
  const exact = new Map();
  const norm = new Map();
  for (const r of rows) {
    const n = r.productName;
    if (!exact.has(n)) exact.set(n, r);
    const k = normName(n);
    if (k && !norm.has(k)) norm.set(k, r);
  }
  const entries = [...norm.entries()];
  return {
    find(name) {
      if (exact.has(name)) return exact.get(name);
      const k = normName(name);
      if (!k) return null;
      if (norm.has(k)) return norm.get(k);
      // 包含关系
      for (const [key, row] of entries) {
        if (key && (key.includes(k) || k.includes(key)) && Math.abs(key.length - k.length) <= 3) return row;
      }
      // 最长公共子串兜底：≥3 字且覆盖较短名的一半以上
      let best = null, bestLen = 0;
      for (const [key, row] of entries) {
        const l = lcsLen(key, k);
        const ratio = l / Math.min(key.length, k.length);
        if (l >= 3 && ratio >= 0.5 && l > bestLen) { bestLen = l; best = row; }
      }
      return best;
    }
  };
}

/** 归一化为数字 */
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/* ---------------- 主流程 ---------------- */

/** 查附近门店（供前端做门店选择） */
async function listStores(mcp, { city = '北京市', keyword = '麦当劳', beType = 1 }) {
  const res = await mcp.callTool('query-nearby-stores', { beType, searchType: 2, city, keyword });
  const obj = extractJson(res.text);
  const arr = (obj && obj.data) || [];
  return arr.map((s) => ({
    storeCode: String(s.storeCode),
    storeName: s.storeName,
    address: s.address,
    beCode: s.beCode || ''
  }));
}

/** 独立导出：附近门店列表（含距离等原始字段） */
async function fetchNearbyStores({ token, city = '北京市', keyword = '麦当劳', beType = 1 }) {
  const mcp = new McpClient({ token });
  const serverInfo = await mcp.connect();
  const stores = await listStores(mcp, { city, keyword, beType });
  if (!stores.length) throw new Error('未查询到附近门店');
  return { serverInfo, stores };
}

async function fetchLiveMenu({ token, city = '北京市', keyword = '麦当劳', orderType = 1, beType = 1, storeCode = null }) {
  const mcp = new McpClient({ token });
  const serverInfo = await mcp.connect();

  // 1. 门店：未指定则取最近的一家
  const all = await listStores(mcp, { city, keyword, beType });
  if (!all.length) throw new Error('未查询到附近门店');
  const store = (storeCode && all.find((s) => String(s.storeCode) === String(storeCode))) || all[0];

  // 2. 菜单
  const mealsRes = await mcp.callTool('query-meals', { storeCode: store.storeCode, orderType, beType });
  const mealsObj = extractJson(mealsRes.text);
  const mealsMap = (mealsObj && mealsObj.data && mealsObj.data.meals) || {};

  // 3. 营养
  let nutritionRows = [];
  try {
    const nutRes = await mcp.callTool('list-nutrition-foods', {});
    const nutObj = extractJson(nutRes.text);
    nutritionRows = parseToonNutrition((nutObj && nutObj.data) || '');
  } catch (e) { /* 营养失败不阻断主流程 */ }
  const nutIndex = buildNutritionIndex(nutritionRows);

  // 4. 券
  let coupons = [];
  try {
    const cpRes = await mcp.callTool('available-coupons', {});
    coupons = parseCouponTitles(cpRes.text);
  } catch (e) { /* 忽略 */ }

  // 5. 组装
  //    排除“套餐/组合/精选/卡券”类条目，避免与单品重复计价
  const EXCLUDE_RE = /套餐|单品精选|随心|组合|\d+\s*件|[一二三四五六七八九十]件|福袋|麦金卡|早餐卡|兑换券|券$|桶$|卡$|乐园|餐$/;
  const raw = [];
  for (const code of Object.keys(mealsMap)) {
    const m = mealsMap[code];
    if (EXCLUDE_RE.test(m.name)) continue;
    const cat = classify(m.name);
    if (cat === 'other') continue;              // 无法归类的（蘸酱/餐盒等）跳过
    const price = num(m.currentPrice);
    if (price <= 0) continue;                   // 无有效价格跳过
    const nut = nutIndex.find(m.name);
    raw.push({
      code: String(code),
      name: m.name,
      en: '',
      cat,
      price,
      originalPrice: num(m.originalPrice) || price,
      kcal: nut ? num(nut.energyKcal) : null,
      protein: nut ? num(nut.protein) : null,
      image: m.image || '',
      tags: deriveTags(m.name, cat),
      nutritionSource: nut ? 'mcp' : 'missing'
    });
  }

  // 6. 营养兜底：未匹配到的餐品，用同分类中位数估算并标记
  const medians = {};
  for (const cat of ['main', 'side', 'drink', 'dessert']) {
    const ks = raw.filter((i) => i.cat === cat && i.kcal != null).map((i) => i.kcal);
    const ps = raw.filter((i) => i.cat === cat && i.protein != null).map((i) => i.protein);
    medians[cat] = { kcal: median(ks), protein: median(ps) };
  }
  let matched = 0, estimated = 0;
  for (const it of raw) {
    if (it.kcal != null) { matched++; continue; }
    it.kcal = medians[it.cat].kcal;
    it.protein = medians[it.cat].protein;
    it.nutritionSource = 'estimated';
    estimated++;
  }

  return {
    source: '麦当劳 MCP 实时',
    serverInfo,
    store: {
      storeCode: store.storeCode, storeName: store.storeName,
      address: store.address, beCode: store.beCode || ''
    },
    stores: all,
    orderType,
    beType,
    fetchedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    items: raw,
    coupons,
    nutrition: { totalRows: nutritionRows.length, matched, estimated }
  };
}

/** 官方核价：把选好的组合交给 calculate-price 复核 */
async function quotePrice({ token, storeCode, orderType = 1, beType = 1, codes }) {
  const mcp = new McpClient({ token });
  await mcp.connect();
  const r = await mcp.callTool('calculate-price', {
    storeCode,
    orderType,
    beType,
    items: codes.map((c) => ({ productCode: String(c), quantity: 1 }))
  });
  return extractJson(r.text);
}

module.exports = { fetchLiveMenu, fetchNearbyStores, quotePrice, extractJson, parseToonNutrition, classify, normName };
