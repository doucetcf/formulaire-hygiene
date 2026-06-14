#!/usr/bin/env node
/** Capture le format de recherche par ZONE géographique de Centris (bounds/polygone). */
import { chromium } from 'playwright';
import { gunzipSync } from 'node:zlib';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  locale: 'fr-CA',
});

const reqs = [];
page.on('request', (r) => {
  if (/GetInscriptions|UpdateQuery|GetGeographies|GetResult/i.test(r.url())) {
    const pd = r.postData();
    if (pd) reqs.push({ url: r.url().replace('https://www.centris.ca', ''), body: pd });
  }
});

console.log('1. Chargement page Saint-Jérôme…');
await page.goto('https://www.centris.ca/fr/propriete~a-vendre~saint-jerome', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(() => { document.querySelector('#didomi-notice-agree-button')?.click(); document.querySelector('#didomi-host')?.remove(); }).catch(()=>{});
await page.waitForTimeout(2000);

// 2. Bascule vue Carte (déclenche une recherche par bounds)
console.log('2. Bascule vers la carte…');
for (const sel of ['a[href*="carte"]', 'a:has-text("Carte")', '#mapTab', '[data-view="Map"]', '.toggle-map', 'a.map']) {
  const el = page.locator(sel).first();
  if (await el.count().catch(()=>0)) { await el.click({force:true,timeout:5000}).catch(()=>{}); break; }
}
await page.waitForTimeout(5000);

// 3. Décoder le cookie property-search-query (peut contenir la forme géo)
const cookies = await page.context().cookies();
const psq = cookies.find(c => c.name === 'property-search-query');
if (psq) {
  try {
    const j = JSON.parse(gunzipSync(Buffer.from(decodeURIComponent(psq.value), 'base64')).toString());
    console.log('\nCookie query décodé:', JSON.stringify(j).slice(0, 700));
  } catch(e) { console.log('decode cookie échec:', e.message); }
}

console.log('\n=== Requêtes capturées (' + reqs.length + ') ===');
for (const r of reqs.slice(0, 8)) {
  console.log(`\n▶ ${r.url}`);
  console.log('  body:', r.body.slice(0, 600));
}
await browser.close();
