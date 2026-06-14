#!/usr/bin/env node
/** Diagnostic DuProprio — schéma complet + pagination + filtre région. */
const H = { 'User-Agent': 'Mozilla/5.0 Chrome/124', 'Accept-Language': 'fr-CA', 'Accept': 'application/json' };
const API = 'https://duproprio.com/fr/api-proxy/featured-homes';

// 1. Schéma COMPLET d'une annonce (coordonnées ? chambres ?)
const r1 = await fetch(`${API}?parent=1&sort=-published_at&province=qc&page%5Bsize%5D=3&page%5Bnumber%5D=1`, { headers: H });
const j1 = await r1.json();
console.log('Statut:', r1.status, '| annonces:', j1.listings?.length, '| meta:', JSON.stringify(j1.meta||{}).slice(0,200));
console.log('\n=== ANNONCE COMPLÈTE ===');
console.log(JSON.stringify(j1.listings?.[0], null, 1).slice(0, 1800));

// 2. Pagination : pages 1-3 donnent-elles des annonces DIFFÉRENTES ?
const ids = new Set();
for (let p = 1; p <= 3; p++) {
  const r = await fetch(`${API}?parent=1&sort=-published_at&province=qc&page%5Bsize%5D=50&page%5Bnumber%5D=${p}`, { headers: H });
  const j = await r.json();
  const pageIds = (j.listings||[]).map(l => l.id);
  const newOnes = pageIds.filter(i => !ids.has(i));
  pageIds.forEach(i => ids.add(i));
  console.log(`\npage ${p}: ${pageIds.length} annonces, ${newOnes.length} nouvelles | cumul ${ids.size}`);
}

// 3. Filtre régional : trouver les IDs des régions qui nous intéressent
console.log('\n=== filtre régions (cherche Laurentides/Lanaudière/Montérégie) ===');
for (let rid = 1; rid <= 18; rid++) {
  const r = await fetch(`${API}?parent=1&sort=-published_at&province=qc&page%5Bsize%5D=3&regions%5B0%5D=${rid}`, { headers: H });
  const j = await r.json().catch(()=>({}));
  const reg = j.listings?.[0]?.address?.region;
  if (reg) console.log(`  regions[0]=${rid} → ${(j.meta?.total ?? '?')} total, ex: ${reg}`);
}
