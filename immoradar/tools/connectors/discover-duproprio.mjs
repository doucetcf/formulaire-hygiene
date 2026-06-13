#!/usr/bin/env node
/** Diagnostic DuProprio Playwright — capture la vraie API XHR de React. */
import { chromium } from 'playwright';

const URL = 'https://duproprio.com/fr/rechercher/liste?search=true';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  locale: 'fr-CA',
});

const hits = [];
page.on('response', async (res) => {
  const u = res.url();
  const ct = res.headers()['content-type'] || '';
  if (!/json/.test(ct)) return;
  if (/duproprio\.com/.test(u) === false) return;
  let body = '';
  try { body = await res.text(); } catch { return; }
  // Heuristique : réponse qui ressemble à des annonces
  const score = (body.match(/price|prix|civicNumber|latitude|bedroom|chambre|listingId|propertyId/gi) || []).length;
  if (score >= 3) {
    hits.push({ url: u, method: res.request().method(), status: res.status(), len: body.length, score,
      reqBody: res.request().postData()?.slice(0, 300), sample: body.slice(0, 600) });
  }
});

console.log('Navigation…');
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.log('goto:', e.message));
await page.waitForTimeout(4000);
// fermer le consentement et re-déclencher
await page.evaluate(() => { document.querySelector('#didomi-host')?.remove(); }).catch(() => {});
await page.waitForTimeout(2000);

console.log('\n=== Requêtes JSON candidates (' + hits.length + ') ===');
for (const h of hits.slice(0, 6)) {
  console.log(`\n▶ ${h.method} ${h.url}`);
  console.log(`  status=${h.status} len=${h.len} score=${h.score}`);
  if (h.reqBody) console.log(`  reqBody: ${h.reqBody}`);
  console.log(`  sample: ${h.sample.replace(/\s+/g, ' ')}`);
}
if (!hits.length) {
  console.log('Aucune. Toutes les requêtes JSON DuProprio vues :');
  // fallback : recharger en listant tout
}
await browser.close();
