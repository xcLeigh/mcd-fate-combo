'use strict';
/* 麦门本命套餐机 · 前端逻辑（原生 JS，无框架无依赖） */

const state = { zodiac: '水瓶', mood: '平静', code: '摸鱼划水', budget: 45, storeCode: null, takeWay: null };
const CAT_LABEL = { main: '主食', side: '小食', drink: '饮品', dessert: '甜点' };

let STORES = [];
let MAP_LIVE = false;      // 是否运行在实时模式（实时模式才允许下单）

const $ = (id) => document.getElementById(id);

function chip(label, active, onClick) {
  const el = document.createElement('div');
  el.className = 'chip' + (active ? ' on' : '');
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function renderChips(boxId, list, key) {
  const box = $(boxId);
  box.innerHTML = '';
  list.forEach((label) => {
    box.appendChild(chip(label, state[key] === label, () => {
      state[key] = label;
      renderChips(boxId, list, key);
    }));
  });
}

function money(n) { return '¥' + Number(n).toFixed(2).replace(/\.00$/, ''); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------- 启动 ---------------- */
async function boot() {
  const res = await fetch('/api/options').then((r) => r.json());
  const o = res.data;
  renderChips('zodiacBox', o.zodiacs, 'zodiac');
  renderChips('moodBox', o.moods, 'mood');
  renderChips('codeBox', o.codes, 'code');

  const range = $('budget');
  range.value = state.budget;
  $('budgetVal').textContent = '¥' + state.budget;
  range.addEventListener('input', () => {
    state.budget = Number(range.value);
    $('budgetVal').textContent = '¥' + state.budget;
  });

  $('drawBtn').addEventListener('click', draw);

  // 连接状态 + 附近门店列表
  try {
    const m = await fetch('/api/menu').then((r) => r.json());
    const d = m.data;
    MAP_LIVE = d.source.indexOf('实时') >= 0;
    $('liveText').textContent = MAP_LIVE ? '麦当劳 MCP 已连接' : '使用 MCP 数据快照';
    $('liveBadge').classList.toggle('offline', !MAP_LIVE);

    STORES = d.stores || (d.store ? [d.store] : []);
    const sel = $('storeSelect');
    if (STORES.length) {
      state.storeCode = STORES[0].storeCode;
      sel.innerHTML = STORES.map((s) =>
        `<option value="${esc(s.storeCode)}">${esc(s.storeName)}</option>`).join('');
      sel.value = state.storeCode;
      $('storeCount').textContent = '· 附近 ' + STORES.length + ' 家';
      paintStoreAddr();
      sel.addEventListener('change', () => {
        state.storeCode = sel.value;
        state.takeWay = null;
        paintStoreAddr();
        if (!$('resultState').classList.contains('hidden')) draw();
      });
    } else {
      sel.innerHTML = '<option>快照模式：未连接真实门店</option>';
      sel.disabled = true;
      $('storeCount').textContent = '· 快照模式';
      $('storeAddr').textContent = '配置 MCD_MCP_TOKEN 后可关联附近真实门店并下单';
    }
  } catch (e) {
    $('liveText').textContent = '数据源状态未知';
  }
}

function paintStoreAddr() {
  const s = STORES.find((x) => String(x.storeCode) === String(state.storeCode));
  $('storeAddr').textContent = s ? '📍 ' + s.address : '';
}

/* ---------------- 抽套餐 ---------------- */
async function draw() {
  const btn = $('drawBtn');
  btn.classList.add('loading');
  btn.textContent = '🔮 正在调麦当劳 MCP 算本命…';

  try {
    const res = await fetch('/api/divine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).then((r) => r.json());

    if (!res.ok) throw new Error(res.error || 'unknown');
    render(res.data);
  } catch (e) {
    alert('出错了：' + e.message);
  } finally {
    btn.classList.remove('loading');
    btn.textContent = '🎲 抽 我 的 本 命 套 餐';
  }
}

function render(d) {
  $('emptyState').classList.add('hidden');
  $('resultState').classList.remove('hidden');

  $('resTitle').textContent = `${d.input.mood}份「本命套餐」已生成`;
  $('resSub').textContent = `${d.input.zodiac}座 · ${d.input.code} · 预算 ¥${d.input.budget} · ${d.element}象`;
  $('destinyNum').textContent = d.destiny;

  const combo = $('comboBox');
  combo.innerHTML = '';
  combo.style.gridTemplateColumns = 'repeat(' + Math.min(4, Math.max(3, d.picked.length)) + ', 1fr)';
  d.picked.forEach((it, i) => {
    const card = document.createElement('div');
    card.className = 'combo-card';
    card.style.animationDelay = (i * 70) + 'ms';
    const visual = it.image
      ? `<img class="cimg" src="${it.image}" alt="${esc(it.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/><span class="ce" style="display:none">${it.emoji || '🍔'}</span>`
      : `<span class="ce">${it.emoji || '🍔'}</span>`;
    card.innerHTML = `
      <span class="cat-label">${CAT_LABEL[it.cat] || ''}</span>
      ${visual}
      <div class="cn">${esc(it.name)}</div>
      <div class="cp">${money(it.price)} · ${it.kcal}kcal</div>`;
    combo.appendChild(card);
  });

  $('stTotal').textContent = money(d.total);
  $('stSaved').textContent = d.saved > 0 ? money(d.saved) : '—';
  $('stKcal').textContent = d.kcal;
  $('stProtein').textContent = d.protein;

  // 券与优惠
  const parts = [];
  if (d.coupon) parts.push(`🎫 已叠加「${d.coupon}」：单品合计 ${money(d.subtotal)} → ${money(d.total)}`);
  if (d.menuSaved > 0) parts.push(`🏷 菜单自带优惠已省 ${money(d.menuSaved)}`);
  if (!parts.length) parts.push(`🎫 本单按现价合计 ${money(d.subtotal)}，暂时没有可叠加的立减`);
  $('couponLine').innerHTML = parts.join('　|　');

  // 官方核价
  const q = d.officialQuote;
  if (q && q.price != null) {
    $('quoteLine').innerHTML = `✅ 麦当劳 MCP <b>calculate-price</b> 官方核价：<b>${money(q.price)}</b>` +
      (q.discount > 0 ? `（已优惠 ${money(q.discount)}）` : '（无额外优惠）') +
      `<br/><span class="dim">${q.productList.map((p) => esc(p.name) + ' ' + money(p.subtotal)).join(' ｜ ')}</span>`;
  } else {
    $('quoteLine').textContent = '';
  }

  // 可领券
  const cps = d.availableCoupons || [];
  $('couponList').innerHTML = cps.length
    ? `<div class="cl-title">🎁 当前可领的麦麦省券（${cps.length}）</div><div class="cl-items">` +
      cps.map((c) => `<span class="cl-chip">${esc(c)}</span>`).join('') + '</div>'
    : '';

  // 营养说明
  const est = d.nutritionEstimated || 0;
  $('nutrNote').textContent = est > 0
    ? `注：本单有 ${est} 项餐品未在营养表中匹配到，热量按同分类中位数估算，仅供参考。`
    : '';

  $('rdMood').textContent = '· ' + d.reading.mood;
  $('rdCode').textContent = '· ' + d.reading.code;
  $('rdElement').textContent = '· ' + d.reading.element;

  $('lkNum').textContent = d.lucky.num;
  $('lkCode').textContent = d.lucky.code;
  $('lkCharm').textContent = d.lucky.charm;

  const ul = $('traceList');
  ul.innerHTML = '';
  (d.mcpTrace || []).forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    ul.appendChild(li);
  });
  if (d.officialQuote) {
    const li = document.createElement('li');
    li.textContent = 'calculate-price → 官方核价 ¥' + d.officialQuote.price.toFixed(2);
    ul.appendChild(li);
  }

  setupOrderZone(d);

  $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------------- 结算下单 ---------------- */
function setupOrderZone(d) {
  const store = d.store;
  $('orderResult').classList.add('hidden');
  $('orderResult').innerHTML = '';
  $('ozStore').innerHTML = store
    ? '📍 ' + esc(store.storeName) + '<br/><span class="dim">' + esc(store.address) + '</span>'
    : '<span class="dim">当前为快照模式，未关联真实门店</span>';

  // 取餐方式：来自 calculate-price 返回的 takeWayList
  const list = (d.officialQuote && d.officialQuote.takeWayList) || [];
  const box = $('takeWayBox');
  box.innerHTML = '';
  if (list.length) {
    if (!list.some((t) => t.code === state.takeWay)) state.takeWay = list[0].code;
    list.forEach((t) => {
      box.appendChild(chip(t.title, state.takeWay === t.code, () => {
        state.takeWay = t.code;
        setupOrderZone(d);
      }));
    });
  } else {
    box.innerHTML = '<span class="dim" style="font-size:12px">取餐方式将在下单时自动确定</span>';
  }

  const btn = $('orderBtn');
  const can = MAP_LIVE && !!store && (list.length > 0 || !(d.officialQuote));
  btn.disabled = !can;
  btn.textContent = can ? '⚡ 一 键 下 单' : '⚡ 一键下单（需实时模式）';
  btn.onclick = can ? () => confirmOrder(d) : null;
}

function confirmOrder(d) {
  const box = $('orderResult');
  const tw = ((d.officialQuote && d.officialQuote.takeWayList) || []).find((t) => t.code === state.takeWay);
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="order-confirm">
      <div class="oc-title">确认下单？</div>
      <div class="oc-kv"><span>门店</span><b>${esc(d.store.storeName)}</b></div>
      <div class="oc-kv"><span>取餐方式</span><b>${esc(tw ? tw.title : (state.takeWay || '默认'))}</b></div>
      <div class="oc-kv"><span>套餐</span><b>${d.picked.map((p) => esc(p.name)).join(' + ')}</b></div>
      <div class="oc-kv"><span>应付</span><b class="hl">${money(d.total)}</b></div>
      <div class="oc-btns">
        <button class="oc-go" id="ocGo">确认下单</button>
        <button class="oc-cancel" id="ocCancel">再想想</button>
      </div>
      <p class="oc-note">下单会在你的麦当劳账户中生成真实订单（未支付），可自行支付或取消。</p>
    </div>`;
  $('ocCancel').onclick = () => { box.classList.add('hidden'); box.innerHTML = ''; };
  $('ocGo').onclick = () => placeOrder(d);
}

async function placeOrder(d) {
  const box = $('orderResult');
  const btn = $('orderBtn');
  btn.classList.add('loading');
  btn.textContent = '⚡ 正在调用 create-order…';
  box.classList.remove('hidden');
  box.innerHTML = '<div class="order-pending">⏳ 正在调用麦当劳 MCP create-order 创建订单…</div>';

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, storeCode: state.storeCode, takeWay: state.takeWay })
    }).then((r) => r.json());

    if (!res.ok) {
      box.innerHTML = `<div class="order-fail">❌ 下单失败：${esc(res.error || '未知错误')}</div>`;
      return;
    }
    renderOrderResult(res.data);
  } catch (e) {
    box.innerHTML = `<div class="order-fail">❌ 下单异常：${esc(e.message)}</div>`;
  } finally {
    btn.classList.remove('loading');
    btn.textContent = '⚡ 一 键 下 单';
  }
}

function renderOrderResult(data) {
  const o = data.order || {};
  const box = $('orderResult');

  if (!o.success) {
    box.innerHTML = `
      <div class="order-fail">
        ❌ 下单未成功：${esc(o.message || '麦当劳 MCP 返回失败')}
        <details class="rawbox"><summary>查看 MCP 原始返回</summary><pre>${esc(o.rawText || '')}</pre></details>
      </div>`;
    return;
  }

  const pay = o.payUrl
    ? `<a class="pay-link" href="${esc(o.payUrl)}" target="_blank" rel="noopener">👉 打开支付链接完成支付</a>`
    : '<span class="dim">麦当劳 MCP 未返回支付链接，请到「麦当劳 App → 我的订单」中完成支付。</span>';

  box.innerHTML = `
    <div class="order-ok">
      <div class="ok-title">✅ 订单已创建</div>
      <div class="oc-kv"><span>订单号</span><b class="mono" id="oidText">${esc(o.orderId || '（见下方原始返回）')}</b>
        ${o.orderId ? '<button class="copy-btn" id="copyOid">复制</button>' : ''}</div>
      <div class="oc-kv"><span>门店</span><b>${esc(data.store.storeName)}</b></div>
      <div class="oc-kv"><span>取餐方式</span><b>${esc((o.takeWayList.find((t) => t.code === o.takeWay) || {}).title || o.takeWay || '—')}</b></div>
      <div class="oc-kv"><span>应付金额</span><b class="hl">${money(o.price ? o.price.total : data.total)}</b></div>
      <div class="oc-kv"><span>商品</span><b>${(data.items || []).map((p) => esc(p.name)).join(' + ')}</b></div>
      <div class="pay-row">${pay}</div>
      <p class="oc-note">支付完成后，可在麦当劳 App「我的订单」中查看取餐进度。</p>
      <details class="rawbox"><summary>🧩 查看 create-order 的 MCP 原始返回</summary><pre>${esc(o.rawText || '')}</pre></details>
    </div>`;

  const cp = $('copyOid');
  if (cp) {
    cp.onclick = () => {
      navigator.clipboard.writeText(o.orderId).then(() => { cp.textContent = '已复制'; });
    };
  }
}

boot();
