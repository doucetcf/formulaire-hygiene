#!/usr/bin/env node
/** Diagnostic DuProprio v4 — dump du JSON-LD SearchResultsPage. */
const r = await fetch('https://duproprio.com/fr/rechercher/liste?search=true', {
  headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124', 'Accept-Language': 'fr-CA' },
});
const html = await r.text();
const scripts = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
console.log('JSON-LD trouvés:', scripts.length);
scripts.forEach((s, i) => {
  console.log(`\n── JSON-LD [${i}] (${s[1].length} car.) ──`);
  try {
    const j = JSON.parse(s[1]);
    // Si c'est trop gros, juste les clés et un résumé
    if (s[1].length > 3000) {
      console.log('Type:', j['@type']);
      console.log('Clés top niveau:', Object.keys(j));
      if (j.mainEntity) console.log('  mainEntity:', JSON.stringify(j.mainEntity).slice(0, 500));
      if (j.offers) {
        console.log('  offers (type=' + j.offers['@type'] + '):');
        console.log('    keys:', Object.keys(j.offers));
        if (Array.isArray(j.offers.offers)) console.log('    offers.offers.length:', j.offers.offers.length);
        else if (j.offers.offers) console.log('    offers.offers (200c):', JSON.stringify(j.offers.offers).slice(0, 500));
      }
      if (j.itemListElement) console.log('  itemListElement[0]:', JSON.stringify(j.itemListElement[0]).slice(0, 500));
    } else {
      console.log(JSON.stringify(j, null, 1).slice(0, 2500));
    }
  } catch (e) { console.log('Parse fail:', e.message, '| brut:', s[1].slice(0, 300)); }
});

// Aussi : meta csrf-token (pour les requêtes API)
const csrf = html.match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/)?.[1];
console.log('\nmeta csrf-token:', csrf ? csrf.slice(0, 40) + '...' : '∅');
