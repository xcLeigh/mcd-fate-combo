'use strict';
/**
 * 麦当劳 MCP 下单能力封装（零依赖）
 *
 *   const { createOrder } = require('./lib/order');
 *   const r = await createOrder({ token, storeCode, orderType: 1, beType: 1, codes: ['1440', ...] });
 *
 * 下单链路（与麦当劳 MCP 官方工具约定一致）：
 *   1. calculate-price → 拿到金额与「取餐方式」选项（data.takeWayList[].code）
 *   2. create-order    → 携带 takeWayCode（到店场景必传）创建订单
 *   3. 返回订单号 + 支付链接，用户去麦当劳 App / 扫码完成支付
 */

const { McpClient } = require('./mcp');
const { extractJson } = require('./mcp-source');

/** 深度遍历，按字段名正则找第一个匹配值（应对未知返回结构） */
function deepFind(obj, keyRe, valRe, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      const hit = deepFind(v, keyRe, valRe, depth + 1);
      if (hit) return hit;
      continue;
    }
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const sv = String(v);
    if (!keyRe.test(k)) continue;
    if (valRe && !valRe.test(sv)) continue;
    if (sv.length < 4) continue;
    return sv;
  }
  return null;
}

/**
 * 创建订单
 * @param {object} o
 * @param {string} o.token       MCP Token
 * @param {string} o.storeCode   门店编码
 * @param {number} o.orderType   1=到店 2=外送
 * @param {number} o.beType      1=到店自提 2=麦乐送 5=得来速 6=团餐
 * @param {string[]} o.codes     商品编码数组（各 1 份）
 * @param {string} [o.takeWayCode] 取餐方式 code（不传则自动取 takeWayList[0]，如 eat-in/take-in-store）
 * @param {string} [o.remark]    备注（外送场景）
 * @param {number[]} [o.quantities] 与 codes 对应的数量，默认各 1
 */
async function createOrder({ token, storeCode, orderType = 1, beType = 1, codes, takeWayCode, remark, quantities }) {
  if (!storeCode) throw new Error('缺少 storeCode');
  if (!codes || !codes.length) throw new Error('缺少商品列表');

  const mcp = new McpClient({ token });
  await mcp.connect();

  const items = codes.map((c, i) => ({
    productCode: String(c),
    quantity: (quantities && quantities[i]) || 1
  }));

  // 1) 核价：拿金额 + 取餐方式
  const priceRes = await mcp.callTool('calculate-price', { storeCode, orderType, beType, items });
  const priceObj = extractJson(priceRes.text);
  const pdata = (priceObj && priceObj.data) || {};
  const takeWayList = Array.isArray(pdata.takeWayList) ? pdata.takeWayList : [];

  let takeWay = takeWayCode || (takeWayList[0] && takeWayList[0].code) || '';
  if (orderType === 1 && !takeWay) {
    throw new Error('未获取到取餐方式（takeWayList 为空），无法创建到店订单');
  }

  const price = {
    total: Number(pdata.price || 0) / 100,
    original: Number(pdata.originalPrice || 0) / 100,
    discount: Number(pdata.discount || 0) / 100,
    productList: (pdata.productList || []).map((p) => ({
      code: p.productCode, name: p.productName,
      quantity: p.quantity, subtotal: Number(p.subtotal || 0) / 100
    }))
  };

  // 2) 下单
  const args = { storeCode, orderType, beType, items };
  if (takeWay) args.takeWayCode = takeWay;
  if (remark) args.remark = String(remark).slice(0, 50);

  const orderRes = await mcp.callTool('create-order', args);
  const orderObj = extractJson(orderRes.text);

  const success = orderObj ? orderObj.success !== false : false;
  const message = (orderObj && orderObj.message) || '';

  // 3) 尽力提取订单号与支付链接（不同版本字段名可能不同）
  const orderId = deepFind(orderObj, /order(i|)d$|orderNo|orderCode|orderNumber/i, /^[A-Za-z0-9_-]{8,}$/)
    || deepFind(orderObj, /orderId/i);
  const payUrl = deepFind(orderObj, /payurl|paymenturl|pay_url|orderurl|url|link|qrcode|codeurl/i, /^https?:\/\//i);

  return {
    success: Boolean(success),
    message,
    orderId: orderId || null,
    payUrl: payUrl || null,
    takeWay,
    takeWayList,
    price,
    storeCode,
    orderType,
    beType,
    args,
    raw: orderObj,
    rawText: String(orderRes.text).slice(0, 4000)
  };
}

/** 查询订单状态（下单后确认支付结果） */
async function queryOrder({ token, orderId }) {
  const mcp = new McpClient({ token });
  await mcp.connect();
  const res = await mcp.callTool('query-order', { orderId: String(orderId) });
  return { raw: extractJson(res.text), rawText: String(res.text).slice(0, 3000) };
}

module.exports = { createOrder, queryOrder };
