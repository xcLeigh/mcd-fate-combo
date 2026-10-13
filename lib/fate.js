'use strict';
/**
 * 麦门本命套餐机 · 核心算法
 * ---------------------------------------------------------------
 * 设计原则（与 McDonald's MCP 解耦）：
 *   1. 取数交给 MCP（query-meals / list-nutrition-foods / available-coupons）
 *   2. 算钱交给确定性代码（穷举 + 组合优化，可复现、可核验，不让大模型心算）
 *   3. 表达交给 Agent（运势文案由模板拼装，保证每次输出稳定又好读）
 *
 * 纯 Node 内置模块，无任何第三方依赖。
 */

const ZODIAC = {
  白羊: '火', 狮子: '火', 射手: '火',
  金牛: '土', 处女: '土', 摩羯: '土',
  双子: '风', 天秤: '风', 水瓶: '风',
  巨蟹: '水', 天蝎: '水', 双鱼: '水'
};

// 心情 -> 偏好标签权重
const MOOD_TAGS = {
  开心:   { '经典': 3, '分享': 3, '脆': 2, '快乐水': 3, '甜': 2 },
  emo:    { '甜': 4, '治愈': 4, '温润': 3, '芝士': 2, '浓郁': 2, '经典': 2, '轻盈': 1 },
  暴躁:   { '辣': 5, '解压': 4, '咖啡因': 3, '上头': 3, '脆': 1 },
  平静:   { '清淡': 3, '均衡': 3, '健康': 3, '轻盈': 3, '经典': 1 },
  想暴富: { '牛肉': 4, '招牌': 4, '扎实': 3, '浓郁': 2, '芝士': 2 },
  好累:   { '咖啡因': 5, '提神': 4, '续命': 4, '省事': 2, '易食': 2 }
};

// 星座四元素 -> 偏好标签
const ELEMENT_TAGS = {
  火: { '辣': 3, '牛肉': 2, '解压': 2, '招牌': 1 },
  土: { '扎实': 3, '经典': 3, '均衡': 2, '粗粮': 1 },
  风: { '轻盈': 3, '清爽': 3, '气泡': 2, '分享': 2 },
  水: { '甜': 3, '治愈': 3, '温润': 3, '冰': 2 }
};

// 代码状态 -> 偏好标签 + 文案
const CODE_TAGS = {
  '刚提PR':   { '提神': 3, '零负担': 2, '轻盈': 1 },
  '被review打回': { '解压': 4, '甜': 3, '辣': 2 },
  '改了一天bug': { '咖啡因': 5, '续命': 4, '上头': 2 },
  '摸鱼划水': { '快乐水': 4, '脆': 3, '经典': 2 },
  '上线成功': { '招牌': 4, '扎实': 3, '甜': 2 }
};

const CODE_LINES = {
  '刚提PR':   'PR 已提交，本命套餐给你一口气撑到 review 通过 ✅',
  '被review打回': '被打回不丢人，代码会有的、周末也会有的。先补糖 🍬',
  '改了一天bug': '今天你改的 bug 比吃过的饭还多，咖啡因必须拉满 ☕',
  '摸鱼划水': '摸鱼是高级的生产力，套餐要选得理直气壮 🐟',
  '上线成功': '恭喜上线！今天这顿，值得点好一点 🚀'
};

const MOOD_LINES = {
  开心:   '你今天的状态像刚 build 成功的终端——一路绿灯。',
  emo:    '心情有点 off？没关系，碳水是最好的 debugger。',
  暴躁:   'CPU 温度有点高，让辣椒和气泡把你重新 oom 过来。',
  平静:   '状态宛如一次优雅的 refactor，不多不少，刚刚好。',
  想暴富: '暴富还没来，但牛肉和芝士可以先到位。',
  好累:   '电量低于 20%，这一顿是给你自己插上充电器。'
};

const ELEMENT_LINES = {
  火: '火象星座，天生自带高并发，需要一点辣来降降温。',
  土: '土象星座，讲究扎实稳定，主食必须给够。',
  风: '风象星座，喜欢轻盈自由，别让胃里太拥挤。',
  水: '水象星座，情绪细腻，甜和温润最懂你。'
};

const LUCK_CODES = [
  'console.log("今天也要好好吃饭")',
  'if (hungry) eat(burger)',
  'while (alive) { hope() }',
  'return "本命套餐";',
  'try { enjoy() } catch { eatMore() }',
  'git commit -m "吃了再说"',
  '0 && 1 // 有饭就不报错'
];

const CHARMS = ['═══════[ 无 BUG 结 ]═══════', '───┤ 防 弹 幕 罩 ├───', '╰┈➤ 一键免蹲坑', '☰☰☰ 编译必过符 ☰☰☰', '⌇⌇⌇ 永 不 宕 机 ⌇⌇⌇'];

/** 稳定的字符串散列（FNV-1a 变体），保证同样输入永远同样输出 */
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 由种子生成的稳定伪随机序列 */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function scoreItem(item, ctx) {
  let score = 0;
  const bump = (map, factor) => {
    for (const tag of item.tags) if (map[tag]) score += map[tag] * factor;
  };
  bump(MOOD_TAGS[ctx.mood] || {}, 1.0);
  bump(ELEMENT_TAGS[ctx.element] || {}, 0.8);
  bump(CODE_TAGS[ctx.code] || {}, 0.9);
  // 价格亲和：预算越宽裕越鼓励点贵的（但只作为微调）
  score += (item.price / 25) * (ctx.budget / 35) * 1.5;
  // 稳定抖动，避免总是同一种组合
  score += ctx.rand() * 1.6;
  return score;
}

/** 组合优化的“钱袋子”部分：给出可用券里的最低总价 */
function bestPrice(picked, coupons, subtotal) {
  const has = (code) => picked.some((p) => p.code === code);
  let best = { total: subtotal, coupon: null, saved: 0 };

  for (const c of coupons || []) {
    let t = null;
    if (c.type === 'threshold' && subtotal >= c.threshold) t = subtotal - c.off;
    else if (c.type === 'item' && has(c.item)) t = subtotal - c.off;
    else if (c.type === 'combo') {
      // 1+1随心配：仅对 eligible 名单内的餐品生效，取其中“最贵的两件”打包价，其余原价
      const elig = picked.filter((p) => !c.eligible || c.eligible.includes(p.code));
      if (elig.length >= 2) {
        const sorted = [...elig].sort((a, b) => b.price - a.price);
        const rest = picked.filter((p) => !sorted.slice(0, 2).includes(p))
          .reduce((s, x) => s + x.price, 0);
        t = c.comboPrice + rest;
      }
    }
    if (t !== null && t < best.total) {
      best = { total: t, coupon: c, saved: subtotal - t };
    }
  }
  // 多个满减里取最优（简单起见上面循环已逐个比较）
  best.total = Math.max(0, Math.round(best.total * 100) / 100);
  best.saved = Math.round(best.saved * 100) / 100;
  return best;
}

/**
 * 主入口：输入用户画像 + 菜单快照，输出“本命套餐”
 *
 * 选品策略：穷举求最优解（而非贪心或随机）。
 *   候选空间 = 主食 × 小食 × 饮品（真实菜单下约 1 万种组合），
 *   在预算内取“情绪匹配总分”最高的一组；
 *   预算允许时再追加一份甜点作为“小确幸”。
 *   得分预先按固定顺序计算并缓存，保证同一输入永远得到同一结果。
 */
function divine({ zodiac, mood, code, budget }, menu, coupons) {
  const element = ZODIAC[zodiac] || '风';
  const seed = hash(`${zodiac}|${mood}|${code}|${budget}`);
  const rand = seeded(seed);
  const ctx = { zodiac, mood, code, element, budget, rand };

  // --- 预计算得分（顺序固定 + 缓存，确保可复现）---
  const scoreMap = new Map();
  for (const it of menu) scoreMap.set(it.code, scoreItem(it, ctx));
  const sc = (it) => scoreMap.get(it.code) || 0;

  const byCat = (cat) => menu.filter((m) => m.cat === cat);
  const mains = byCat('main');
  const sides = byCat('side');
  const drinks = byCat('drink');
  const desserts = byCat('dessert');

  // --- 穷举：主食 + 小食 + 饮品 ---
  let best = null;
  for (const m of mains) {
    for (const s of sides) {
      const base = m.price + s.price;
      if (base > budget) continue;
      for (const d of drinks) {
        const sum = base + d.price;
        if (sum > budget + 1e-6) continue;
        const total = sc(m) + sc(s) + sc(d);
        if (!best || total > best.score) best = { items: [m, s, d], score: total };
      }
    }
  }

  // --- 兜底：预算过紧时退化为两件 / 单件 ---
  if (!best) {
    const tryTwo = (A, B) => {
      for (const a of A) for (const b of B) {
        const sum = a.price + b.price;
        if (sum > budget + 1e-6) continue;
        const total = sc(a) + sc(b);
        if (!best || total > best.score) best = { items: [a, b], score: total };
      }
    };
    tryTwo(mains, drinks);
    tryTwo(mains, sides);
    tryTwo(mains, []);
    if (!best) {
      const one = mains.concat(sides, desserts)
        .filter((x) => x.price <= budget)
        .sort((a, b) => sc(b) - sc(a))[0];
      if (one) best = { items: [one], score: sc(one) };
    }
  }
  if (!best) best = { items: [], score: 0 };

  const picked = best.items.slice();
  const subtotalRaw = picked.reduce((s, x) => s + x.price, 0);

  // --- 预算富余则追加甜点（在剩余额度里挑得分最高的）---
  const restAfter = budget - subtotalRaw;
  const fitDesserts = desserts.filter((d) => d.price <= restAfter + 1e-6 && sc(d) > 0);
  if (fitDesserts.length) {
    fitDesserts.sort((a, b) => sc(b) - sc(a) || a.price - b.price);
    picked.push(fitDesserts[0]);
  }

  const subtotal = Math.round(picked.reduce((s, x) => s + x.price, 0) * 100) / 100;
  const price = bestPrice(picked, coupons, subtotal);

  const kcal = picked.reduce((s, x) => s + (x.kcal || 0), 0);
  const protein = picked.reduce((s, x) => s + (x.protein || 0), 0);

  // 菜单自身折扣（原价 - 现价）
  const menuSaved = Math.round(picked.reduce((s, x) => s + Math.max(0, (x.originalPrice || x.price) - x.price), 0) * 100) / 100;
  const totalSaved = Math.round((price.saved + menuSaved) * 100) / 100;

  // 本命指数：把匹配度映射到 66~99，图个吉利
  const raw = picked.reduce((s, x) => s + sc(x), 0);
  const destiny = Math.min(99, Math.round(66 + (raw % 34)));

  const luckNum = 1 + (hash(zodiac + mood) % 99);
  const luckCode = LUCK_CODES[hash(zodiac + code) % LUCK_CODES.length];
  const charm = CHARMS[hash(mood + code) % CHARMS.length];

  return {
    input: { zodiac, mood, code, budget },
    element,
    picked: picked.map((p) => ({
      code: p.code, name: p.name, en: p.en, cat: p.cat,
      price: p.price, kcal: p.kcal, protein: p.protein,
      emoji: p.emoji || '', image: p.image || '',
      nutritionSource: p.nutritionSource || 'snapshot'
    })),
    subtotal,
    total: price.total,
    saved: totalSaved,
    coupon: price.coupon ? price.coupon.name : null,
    menuSaved,
    kcal,
    protein,
    nutritionEstimated: picked.filter((p) => p.nutritionSource === 'estimated').length,
    destiny,
    reading: {
      mood: MOOD_LINES[mood] || '',
      code: CODE_LINES[code] || '',
      element: ELEMENT_LINES[element] || ''
    },
    lucky: { num: luckNum, code: luckCode, charm },
    mcpTrace: [
      'query-nearby-stores → 定位门店',
      'query-meals → 门店在售餐品与现价',
      'list-nutrition-foods → 热量 / 蛋白质',
      `available-coupons → ${(coupons || []).length} 张可领券参与比价`,
      `确定性穷举 → ${mains.length}×${sides.length}×${drinks.length} 组合取最优`
    ]
  };
}

module.exports = { divine, ZODIAC, hash };
