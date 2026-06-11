#!/usr/bin/env node
/** Diagnostic DuProprio (jetable) — 1 page, structure brute. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const URL = 'https://duproprio.com/fr/rechercher/liste?search=true&regions[0]=10&cities[0]=11215&parent=1&pageNumber=1';

const r = await fetch(URL, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'fr-CA' } });
console.log('Statut:', r.status, '| Content-Type:', r.headers.get('content-type'));
const setCookie = r.headers.getSetCookie?.() ?? [];
console.log('Cookies:', setCookie.map(c => c.split('=')[0]).join(', '));
const html = await r.text();
console.log('Taille HTML:', html.length);

// Indices de protection anti-bot
console.log('cloudflare/captcha:', /cloudflare|cf-challenge|captcha|checking your browser/i.test(html));
console.log('script JSON inline:', (html.match(/window\.__\w+\s*=/g) || []).length);

// Marqueurs probables des cartes
for (const [n, re] of [
  ['data-listing-id', /data-listing-id/g],
  ['search-results-listings-list__item', /search-results-listings-list__item/g],
  ['property-listing', /property-listing/g],
  ['listing-card', /listing-card/g],
  ['itemtype Product', /itemtype="[^"]*\/Product"/g],
  ['itemprop price', /itemprop="price"/g],
  ['duproprio.com/fr/.*/[0-9]+', /\/fr\/[a-z-]+\/[a-z-]+\/[a-z-]+-\d+/g],
  ['prix en $', /\d[\d\s ]{2,}\$/g],
]) console.log(`  ${n.padEnd(35)} : ${(html.match(re) || []).length}`);

// Premier « item » trouvé (échantillon court)
const m = html.match(/<article[\s\S]{50,2500}?<\/article>/) ||
          html.match(/<li[^>]+class="[^"]*search-results[^"]*"[\s\S]{50,2500}?<\/li>/);
if (m) console.log('\nÉchantillon (1500 car.):\n' + m[0].replace(/\s+/g, ' ').slice(0, 1500));
else console.log('\nAucun <article>/<li> de résultat trouvé.');
