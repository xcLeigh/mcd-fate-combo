'use strict';
/* 解析已落盘的 query-meals 样本，输出餐品摘要，便于设计映射 */
const fs = require('fs');
const path = require('path');

function extractJson(text) {
  // 优先从 "Original Response" 之后开始扫描（前面是字段说明，含 { } 占位符）
  const marker = text.indexOf('Original Response');
  let start = marker >= 0 ? text.indexOf('{', marker) : text.indexOf('{');
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
        if (depth === 0) {
          try { return JSON.parse(text.slice(i, p + 1)); } catch (e) { break; }
        }
      }
    }
  }
  return null;
}

const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'mcp-raw', 'query-meals.txt'), 'utf8');
const obj = extractJson(raw);
if (!obj) { console.error('解析失败'); process.exit(1); }
const d = obj.data;
console.log('顶层 keys:', Object.keys(d));
console.log('分类:', (d.categories || []).map((c) => c.name.replace(/\n/g, '') + '(' + c.meals.length + ')').join(' | '));
const meals = d.meals || {};
const keys = Object.keys(meals);
console.log('meals 条目数:', keys.length);
console.log('\n前 20 条示例（code | name | 现价 | 原价 | 有无图）:');
keys.slice(0, 20).forEach((k) => {
  const m = meals[k];
  console.log(' ', k, '|', m.name, '|', m.currentPrice, '|', m.originalPrice, '|', m.image ? 'Y' : 'N');
});
// 打印其中一条完整结构
console.log('\n完整结构示例:', JSON.stringify(meals[keys[0]], null, 2).slice(0, 800));
