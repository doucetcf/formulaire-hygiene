#!/usr/bin/env node
/** Diagnostic DuProprio — capture l'API de recherche (interaction réelle). */
import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

// A) Sonder featured-homes avec filtres (cheap fetch) — sert-il de recherche ?
const H = { 'User-Agent': UA, 'Accept-Language': 'fr-CA', 'Accept': 'application/json' };
console.log('=== A) featured-homes avec filtres ===');
for (const q of ['province=qc&page%5Bsize%5D=50', 'province=qc&regions%5B0%5D=10&page%5Bsize%5D=50',
                 'province=qc&cities%5B0%5D=11215&page%5Bsize%5D=50']) {
  try {
    const r = await fetch('https://duproprio.com/fr/api-proxy/featured-homes?' + q, { headers: H });
    const j = await r.json().catch(() => ({}));
    console.log(`  ${q.slice(0,45)} → ${r.status}, ${(j.listings||[]).length} annonces`);
  } catch (e) { console.log('  err', e.message); }
}

// B) Navigateur : capturer la requête de listings de la page de recherche
console.log('\n=== B) capture navigateur ===');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ userAgent: UA, locale: 'fr-CA' });
const hits = [];
page.on('response', async (res) => {
  const u = res.url();
  if (!/duproprio\.com/.test(u)) return;
  const ct = res.headers()['content-type'] || '';
  if (!/json/.test(ct)) return;
  let body = ''; try { body = await res.text(); } catch { return; }
  const n = (body.match(/"city"|"civic_number"|"price"|"latitude"/gi) || []).length;
  if (n >= 5) hits.push({ url: u.replace('https://duproprio.com',''), status: res.status(), len: body.length, n,
    req: res.request().postData()?.slice(0,200), sample: body.slice(0, 250) });
});

await page.goto('https://duproprio.com/fr/rechercher/liste?search=true', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e=>console.log('goto', e.message));
await page.evaluate(() => { document.querySelector('#didomi-notice-agree-button')?.click(); document.querySelector('#didomi-host')?.remove(); }).catch(()=>{});
await page.waitForTimeout(3000);
// scroller le conteneur de résultats pour déclencher lazy-load / pagination
await page.evaluate(() => {
  const el = document.querySelector('.search-results-listings-list, [class*=results], main') || document.body;
  for (let i=0;i<5;i++) el.scrollTop = el.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
}).catch(()=>{});
await page.waitForTimeout(3000);
// cliquer page 2 si pager présent
for (const sel of ['[class*=pagination] a:has-text("2")', 'a[aria-label*="2"]', '.pagination__next', '[class*=next]']) {
  const el = page.locator(sel).first();
  if (await el.count().catch(()=>0)) { await el.click({force:true,timeout:4000}).catch(()=>{}); break; }
}
await page.waitForTimeout(4000);

console.log('Requêtes listings capturées:', hits.length);
for (const h of hits.slice(0, 8)) {
  console.log(`\n▶ ${h.status} ${h.url}`);
  if (h.req) console.log('  POST body:', h.req);
  console.log('  sample:', h.sample.replace(/\s+/g,' '));
}
await browser.close();
