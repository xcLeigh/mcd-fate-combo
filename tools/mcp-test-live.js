'use strict';
/* 端到端验证：真实 MCP → 结构化菜单 → 本命套餐 → 官方核价 */
const fs = require('fs');
const path = require('path');
const { fetchLiveMenu, quotePrice } = require('../lib/mcp-source');
const { divine } = require('../lib/fate');

const token = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .match(/^\s*MCD_MCP_TOKEN\s*=\s*(.+)\s*$/m)[1].trim();

(async () => {
  const menu = await fetchLiveMenu({ token, city: '北京市', keyword: '麦当劳' });
  console.log('门店:', menu.store.storeName, '(', menu.store.storeCode, ')');
  console.log('菜单条目:', menu.items.length, '| 营养来自 MCP:', menu.nutrition.matched, '| 同类估算:', menu.nutrition.estimated);
  console.log('可领券:', menu.coupons.length, '张 →', menu.coupons.slice(0, 5).join(' / '));

  const byCat = (c) => menu.items.filter((i) => i.cat === c).length;
  console.log('分类分布: main=' + byCat('main'), 'side=' + byCat('side'), 'drink=' + byCat('drink'), 'dessert=' + byCat('dessert'));

  console.log('\n各分类抽样:');
  ['main', 'side', 'drink', 'dessert'].forEach((c) => {
    menu.items.filter((i) => i.cat === c).slice(0, 4).forEach((i) =>
      console.log('  [' + c + ']', i.name, '¥' + i.price, i.kcal != null ? i.kcal + 'kcal' : '(无营养)'));
  });

  // 用真实菜单跑本命算法：验证不同心情是否给出不同套餐
  console.log('\n不同心情的推荐（同一预算 ¥35）:');
  const moods = ['暴躁', 'emo', '好累', '平静', '想暴富'];
  for (const mood of moods) {
    const r = divine({ zodiac: '狮子', mood, code: '改了一天bug', budget: 35 }, menu.items, []);
    console.log('  ' + mood.padEnd(4, '　'), '→', r.picked.map((p) => p.name).join(' + '),
      '| ¥' + r.subtotal, '|', r.kcal + 'kcal', '| 指数', r.destiny);
  }

  const r = divine({ zodiac: '狮子', mood: '暴躁', code: '改了一天bug', budget: 40 }, menu.items, []);
  console.log('\n本命套餐:', r.picked.map((p) => p.name).join(' + '),
    '| 合计 ¥' + r.subtotal, '| 热量', r.kcal, '| 本命指数', r.destiny);

  // 官方核价
  const q = await quotePrice({ token, storeCode: menu.store.storeCode, orderType: 1, beType: 1, codes: r.picked.map((p) => p.code) });
  console.log('\ncalculate-price 官方核价:', JSON.stringify(q).slice(0, 700));

  fs.writeFileSync(path.join(__dirname, '..', 'data', 'mcp-live.json'), JSON.stringify(menu, null, 2), 'utf8');
  console.log('\n实时菜单已缓存到 data/mcp-live.json');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
