'use strict';
/* 不同预算 × 不同心情的推荐矩阵，用于调参 */
const fs = require('fs');
const path = require('path');
const { divine } = require('../lib/fate');

// 优先用本地实时缓存（若存在），否则回退到入库的 MCP 快照
const LIVE = path.join(__dirname, '..', 'data', 'mcp-live.json');
const SNAP = path.join(__dirname, '..', 'data', 'mcd-menu.json');
const menu = JSON.parse(fs.readFileSync(fs.existsSync(LIVE) ? LIVE : SNAP, 'utf8'));
const moods = ['暴躁', 'emo', '好累', '平静', '想暴富', '开心'];

for (const budget of [35, 45, 55]) {
  console.log('\n========= 预算 ¥' + budget + ' (狮子座 / 改了一天bug) =========');
  for (const mood of moods) {
    const r = divine({ zodiac: '狮子', mood, code: '改了一天bug', budget }, menu.items, []);
    console.log('  ' + mood.padEnd(4, '　'), '→',
      r.picked.map((p) => p.name).join(' + '),
      '| ¥' + r.subtotal, '|', r.kcal + 'kcal', '| 指数', r.destiny);
  }
}
