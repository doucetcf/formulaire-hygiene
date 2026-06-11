#!/usr/bin/env node
/**
 * Diagnostic Centris v4 (jetable) — INTERCEPTION via navigateur réel.
 * Au lieu de deviner l'API de pagination, on charge la page dans Chromium
 * (Playwright), on déclenche le passage à la page suivante, et on capture
 * la requête EXACTE (URL, méthode, en-têtes, corps) + sa réponse.
 * Lecture via les logs du workflow.
 */

import { chromium } from 'playwright';

const BASE = 'https://www.centris.ca';
const URL = `${BASE}/fr/propriete~a-vendre~saint-jerome`;
const line = (s = '') => console.log(s);
const hr = () => line('═'.repeat(72));

async function main() {
  hr(); line('DIAGNOSTIC CENTRIS v4 — interception navigateur'); hr();

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'fr-CA',
  });
  const page = await ctx.newPage();

  const captured = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/GetInscriptions|UpdateQuery|GetResult|Inscription/i.test(u)) {
      captured.push({
        url: u, method: req.method(),
        headers: req.headers(),
        postData: req.postData(),
      });
    }
  });
  const responses = {};
  page.on('response', async (res) => {
    const u = res.url();
    if (/GetInscriptions|UpdateQuery/i.test(u)) {
      let body = '';
      try { body = (await res.text()).slice(0, 400); } catch {}
      responses[u] = { status: res.status(), body };
    }
  });

  line(`\nNavigation : ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.property-thumbnail-item', { timeout: 20000 }).catch(() => {});
  const initial = await page.locator('.property-thumbnail-item').count();
  line(`Cartes initiales : ${initial}`);

  // Nombre total annoncé
  const total = await page.locator('.didomi-notice, .resultSummary, [class*=result]').first().textContent().catch(() => '');
  const totalCount = await page.evaluate(() => {
    const el = document.querySelector('#mainContentPropertyResultThumbnailNumber, .property-result-count, [class*=count]');
    return el ? el.textContent.trim() : null;
  });
  line(`Total annoncé : ${totalCount || '∅'}`);

  // Cherche un contrôle de pagination « page suivante »
  const pagerInfo = await page.evaluate(() => {
    const sels = ['.next', '.pager-next', 'li.next a', 'a[rel=next]', '[class*=pager] [class*=next]', 'ul.pagination li:last-child a'];
    const found = [];
    for (const s of sels) { const e = document.querySelector(s); if (e) found.push({ sel: s, html: e.outerHTML.slice(0, 120) }); }
    return found;
  });
  line(`\nContrôles de pagination détectés :`);
  pagerInfo.forEach((p) => line(`  ${p.sel} → ${p.html}`));

  // Tente de cliquer « suivant » (plusieurs sélecteurs)
  let clicked = false;
  for (const sel of ['li.next a', 'a[rel=next]', '.pager-next', '.next']) {
    const el = page.locator(sel).first();
    if (await el.count() && await el.isVisible().catch(() => false)) {
      line(`\nClic sur : ${sel}`);
      await el.click().catch((e) => line('  clic échoué: ' + e.message));
      clicked = true;
      break;
    }
  }
  if (!clicked) line('\nAucun bouton « suivant » cliquable — tentative de scroll.');
  await page.mouse.wheel(0, 4000).catch(() => {});
  await page.waitForTimeout(4000);

  const afterCount = await page.locator('.property-thumbnail-item').count();
  line(`Cartes après pagination : ${afterCount}`);

  // Rapport des requêtes capturées
  hr(); line('REQUÊTES CAPTURÉES :'); hr();
  if (!captured.length) line('Aucune requête GetInscriptions/UpdateQuery capturée.');
  for (const c of captured) {
    line(`\n▶ ${c.method} ${c.url}`);
    line('  En-têtes pertinents :');
    for (const [k, v] of Object.entries(c.headers)) {
      if (/content-type|x-requested|verification|token|referer|origin|cookie|csrf/i.test(k))
        line(`    ${k}: ${String(v).slice(0, 120)}`);
    }
    if (c.postData) line(`  CORPS: ${c.postData.slice(0, 500)}`);
    const r = responses[c.url];
    if (r) line(`  RÉPONSE: ${r.status} — ${r.body.replace(/\s+/g, ' ').slice(0, 200)}`);
  }

  hr(); line('FIN'); hr();
  await browser.close();
}
main().catch((e) => { console.error('Erreur:', e); process.exit(1); });
