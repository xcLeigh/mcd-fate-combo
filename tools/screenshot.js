const { chromium } = require('playwright');
const path = require('path');

const OUT = 'D:/temp/workbuddy/麦当劳征文/mcd-fate-combo/shots';
const BASE = 'http://localhost:8788';

async function pick(page, boxId, text) {
  await page.locator(`${boxId} .chip`, { hasText: new RegExp('^' + text + '$') }).first().click();
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '01-home.png'), fullPage: true });

  // 场景 A：狮子座 / 暴躁 / 改了一天bug / 预算45
  await pick(page, '#zodiacBox', '狮子');
  await pick(page, '#moodBox', '暴躁');
  await pick(page, '#codeBox', '改了一天bug');
  await page.$eval('#budget', (el) => { el.value = 45; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  await page.click('#drawBtn');
  await page.waitForSelector('#resultState:not(.hidden)', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '02-result.png'), fullPage: true });
  await page.locator('#resultPanel').screenshot({ path: path.join(OUT, '03-card.png') });

  // 下单确认面板（仅展示确认 UI，不会真实下单）
  await page.click('#orderBtn');
  await page.waitForSelector('#orderResult:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.locator('.order-zone').screenshot({ path: path.join(OUT, '05-order-confirm.png') });
  await page.click('#ocCancel');

  // 场景 B：双鱼座 / emo / 被review打回 / 预算55
  await pick(page, '#zodiacBox', '双鱼');
  await pick(page, '#moodBox', 'emo');
  await pick(page, '#codeBox', '被review打回');
  await page.$eval('#budget', (el) => { el.value = 55; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  await page.click('#drawBtn');
  await page.waitForTimeout(3000);
  await page.locator('#resultPanel').screenshot({ path: path.join(OUT, '04-card-emo.png') });

  await browser.close();
  console.log('SHOTS DONE');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
