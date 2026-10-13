const { divine } = require('./lib/fate');
const menu = require('./data/mcd-menu.json');

function show(label, input) {
  const r = divine(input, menu.items, menu.coupons);
  console.log(label,
    '| 组合:', r.picked.map((p) => p.name).join(' + '),
    '| 合计:', r.subtotal,
    '| 券:', r.coupon,
    '| 实付:', r.total,
    '| 省:', r.saved,
    '| 本命指数:', r.destiny,
    '| 热量:', r.kcal);
  return r;
}

show('A 水瓶/平静/摸鱼/32', { zodiac: '水瓶', mood: '平静', code: '摸鱼划水', budget: 32 });
show('B 狮子/暴躁/改bug/40', { zodiac: '狮子', mood: '暴躁', code: '改了一天bug', budget: 40 });
show('C emo/双鱼/被review/26', { zodiac: '双鱼', mood: 'emo', code: '被review打回', budget: 26 });
show('D 想暴富/金牛/上线/60', { zodiac: '金牛', mood: '想暴富', code: '上线成功', budget: 60 });
const a1 = divine({ zodiac: '狮子', mood: '暴躁', code: '改了一天bug', budget: 40 }, menu.items, menu.coupons);
const a2 = divine({ zodiac: '狮子', mood: '暴躁', code: '改了一天bug', budget: 40 }, menu.items, menu.coupons);
console.log('确定性校验:', JSON.stringify(a1) === JSON.stringify(a2));
