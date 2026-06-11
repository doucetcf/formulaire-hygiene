#!/usr/bin/env node
/** Diagnostic DuProprio v5 — fiche individuelle + pagination. */
const H = { 'User-Agent': 'Mozilla/5.0 Chrome/124', 'Accept-Language': 'fr-CA' };

// 1. Récupère la liste depuis la page de recherche
const r1 = await fetch('https://duproprio.com/fr/rechercher/liste?search=true', { headers: H });
const html1 = await r1.text();
const ldText = [...html1.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).find(t => /SearchResultsPage/.test(t));
const ld = JSON.parse(ldText);
const items = ld.mainEntity?.itemListElement || [];
console.log('Items page 1:', items.length);
const firstUrl = items[0]?.item?.url;
console.log('1ère URL:', firstUrl);

// 2. Test pagination ?pageNumber=2
const r2 = await fetch('https://duproprio.com/fr/rechercher/liste?search=true&pageNumber=2', { headers: H });
const html2 = await r2.text();
const ld2 = JSON.parse([...html2.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).find(t => /SearchResultsPage/.test(t)));
const items2 = ld2.mainEntity?.itemListElement || [];
const overlap = items2.filter(x => items.some(y => y.item.url === x.item.url)).length;
console.log('Items page 2:', items2.length, '| chevauchement avec page 1:', overlap);

// 3. Fiche individuelle — JSON-LD Product ?
if (firstUrl) {
  const r3 = await fetch(firstUrl, { headers: H });
  const html3 = await r3.text();
  console.log('\nFiche:', r3.status, '| HTML:', html3.length);
  const lds = [...html3.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  console.log('JSON-LD sur la fiche:', lds.length);
  for (const [i, m] of lds.entries()) {
    try {
      const j = JSON.parse(m[1]);
      console.log(`  [${i}] type=${j['@type']} | keys=${Object.keys(j).join(',')}`);
      if (j['@type'] === 'Product' || j.offers || j.address) {
        console.log('   PRODUCT:', JSON.stringify(j).slice(0, 1500));
      }
    } catch (e) { console.log(`  [${i}] parse fail: ${e.message}`); }
  }
  // Régions (pour cibler le Grand Montréal après)
  const titre = html3.match(/<title>([^<]+)<\/title>/)?.[1];
  console.log('Title:', titre);
}

// 4. Filtrer par région : URL avec ?regions[0]=X
console.log('\n── filtre régional ──');
for (const id of [10, 8]) {  // 10 = peut-être RMR Montréal ; 8 = test
  const r = await fetch(`https://duproprio.com/fr/rechercher/liste?search=true&regions%5B0%5D=${id}`, { headers: H });
  const h = await r.text();
  const t = [...h.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(x => /SearchResultsPage/.test(x));
  if (!t) { console.log(`  regions[0]=${id} → pas de ld`); continue; }
  const J = JSON.parse(t);
  console.log(`  regions[0]=${id} → ${J.mainEntity?.itemListElement?.length || 0} items | kw=${J.keywords?.slice(0, 60)}`);
}
