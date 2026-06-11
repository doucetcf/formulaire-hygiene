#!/usr/bin/env node
/** Diagnostic DuProprio v6 — fix parseur + fiche individuelle. */
const H = { 'User-Agent': 'Mozilla/5.0 Chrome/124', 'Accept-Language': 'fr-CA' };

function parseLD(html, type) {
  const m = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean);
  return type ? m.find(x => x['@type'] === type || (Array.isArray(x['@type']) && x['@type'].includes(type))) : m;
}

// 1. Liste — fix : mainEntity est un tableau
const r1 = await fetch('https://duproprio.com/fr/rechercher/liste?search=true&pageNumber=1', { headers: H });
const html1 = await r1.text();
const ld = parseLD(html1, 'SearchResultsPage');
const me = Array.isArray(ld.mainEntity) ? ld.mainEntity[0] : ld.mainEntity;
const items = me?.itemListElement || [];
console.log('Items page 1:', items.length);
if (items[0]) console.log('Échantillon item:', JSON.stringify(items[0]));
const url = items[0]?.item?.url;

// 2. Pagination
const r2 = await fetch('https://duproprio.com/fr/rechercher/liste?search=true&pageNumber=2', { headers: H });
const me2 = parseLD(await r2.text(), 'SearchResultsPage');
const me2It = (Array.isArray(me2?.mainEntity) ? me2.mainEntity[0] : me2?.mainEntity)?.itemListElement || [];
console.log('Items page 2:', me2It.length, '| URL[0]:', me2It[0]?.item?.url?.slice(-60));

// 3. Fiche individuelle
if (url) {
  const r3 = await fetch(url, { headers: H });
  const html3 = await r3.text();
  console.log('\nFiche:', r3.status, '| HTML:', html3.length);
  const lds = parseLD(html3);
  for (const j of lds) {
    const t = Array.isArray(j['@type']) ? j['@type'].join(',') : j['@type'];
    console.log(`  type=${t} | keys=${Object.keys(j).slice(0, 10).join(',')}`);
    if (j['@type'] === 'Product' || j.offers || j.price || j['@type'] === 'Place' || j['@type'] === 'House') {
      console.log('  ▶ contenu (1500c):', JSON.stringify(j).slice(0, 1500));
    }
  }
}

// 4. Filtre régional (corrigé)
console.log('\n── filtres régionaux ──');
for (const id of [10, 5, 8, 16]) {
  const r = await fetch(`https://duproprio.com/fr/rechercher/liste?search=true&regions%5B0%5D=${id}`, { headers: H });
  const j = parseLD(await r.text(), 'SearchResultsPage');
  const n = ((Array.isArray(j?.mainEntity) ? j.mainEntity[0] : j?.mainEntity)?.itemListElement || []).length;
  console.log(`  regions[0]=${id} → ${n} items | kw=${j?.keywords?.slice(0, 60)}`);
}
