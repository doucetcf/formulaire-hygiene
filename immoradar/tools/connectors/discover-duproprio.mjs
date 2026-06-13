#!/usr/bin/env node
/** Diagnostic DuProprio — schéma featured-homes + recherche des endpoints. */
const UA = 'Mozilla/5.0 Chrome/124';
const H = { 'User-Agent': UA, 'Accept-Language': 'fr-CA', 'Accept': 'application/json' };

// cookies
const pg = await fetch('https://duproprio.com/fr/rechercher/liste?search=true', { headers: { ...H, Accept: 'text/html' } });
const cookies = (pg.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
const HH = { ...H, Cookie: cookies };

// 1. Schéma complet d'une annonce featured-homes
const f = await fetch('https://duproprio.com/fr/api-proxy/featured-homes?province=qc&page%5Bsize%5D=2', { headers: HH });
console.log('featured-homes:', f.status);
const fj = await f.json();
if (fj.listings?.[0]) {
  const l = fj.listings[0];
  console.log('Clés annonce:', Object.keys(l).join(', '));
  console.log('Échantillon complet (1 annonce, 1200c):');
  console.log(JSON.stringify(l).slice(0, 1200));
  console.log('meta/pagination:', JSON.stringify(fj.meta || fj.links || {}).slice(0, 300));
}

// 2. Sonder les endpoints de recherche plausibles
console.log('\n=== endpoints candidats ===');
const eps = [
  'search?province=qc&page%5Bsize%5D=5',
  'listings?province=qc&page%5Bsize%5D=5',
  'properties?province=qc&page%5Bsize%5D=5',
  'for-sale?province=qc&page%5Bsize%5D=5',
  'homes?province=qc&page%5Bsize%5D=5',
  'search-results?province=qc&page%5Bsize%5D=5',
  'listings/search?province=qc&page%5Bsize%5D=5',
];
for (const ep of eps) {
  try {
    const r = await fetch('https://duproprio.com/fr/api-proxy/' + ep, { headers: HH });
    const t = await r.text();
    let n = 0; try { const j = JSON.parse(t); n = (j.listings || j.data || []).length; } catch {}
    console.log(`  ${ep.split('?')[0].padEnd(18)} → ${r.status} (${t.length}c, ${n} annonces)`);
  } catch (e) { console.log(`  ${ep} → err ${e.message}`); }
}
