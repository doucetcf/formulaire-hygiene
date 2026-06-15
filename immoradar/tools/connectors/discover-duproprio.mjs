#!/usr/bin/env node
/** DuProprio — capture API recherche + scrape du DOM rendu (fallback). */
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  locale: 'fr-CA',
});

const apis = [];
page.on('response', async (res) => {
  const u = res.url();
  if (!/duproprio\.com/.test(u)) return;
  if (!/json/.test(res.headers()['content-type'] || '')) return;
  let b = ''; try { b = await res.text(); } catch { return; }
  if ((b.match(/"price"|"latitude"|"civic_number"|"city"/gi) || []).length >= 4)
    apis.push({ url: u.replace('https://duproprio.com',''), n: (b.match(/"id"/g)||[]).length, sample: b.slice(0,150) });
});

// recherche région Laurentides (regions[0]=15)
await page.goto('https://duproprio.com/fr/rechercher/liste?search=true', { waitUntil: 'networkidle', timeout: 60000 }).catch(e=>console.log('goto',e.message));
await page.evaluate(() => { document.querySelector('#didomi-notice-agree-button')?.click(); document.querySelector('#didomi-host')?.remove(); }).catch(()=>{});
await page.waitForTimeout(4000);
// scroller pour déclencher le rendu/lazy-load
await page.evaluate(async () => { for(let i=0;i<8;i++){ window.scrollBy(0,1500); await new Promise(r=>setTimeout(r,300)); } });
await page.waitForTimeout(3000);

console.log('=== API listings capturées:', apis.length, '===');
for (const a of apis.slice(0,5)) console.log(`  ${a.url}\n    ${a.n} ids | ${a.sample.replace(/\s+/g,' ')}`);

// === SCRAPE du DOM rendu ===
console.log('\n=== DOM rendu ===');
const dom = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.search-results-listings-list__item, [class*=listing-card], article')];
  const out = { count: items.length, samples: [] };
  for (const it of items.slice(0, 3)) {
    const a = it.querySelector('a[href*="/fr/"]');
    const txt = it.innerText.replace(/\s+/g,' ').slice(0, 150);
    out.samples.push({ href: a?.getAttribute('href')?.slice(0,70), text: txt });
  }
  return out;
});
console.log('Items rendus:', dom.count);
dom.samples.forEach((s,i)=>console.log(`  [${i}] href=${s.href}\n      text=${s.text}`));
await browser.close();
