#!/usr/bin/env node
/** Diagnostic pagination Saint-Jérôme : profondeur réelle + impact sortSeed. */
import { gunzipSync } from 'node:zlib';
const UA = 'Mozilla/5.0 Chrome/124';
const BASE = 'https://www.centris.ca';

const r1 = await fetch(`${BASE}/fr/propriete~a-vendre~saint-jerome`, {
  headers: { 'User-Agent': UA, 'Accept-Language': 'fr-CA', Accept: 'text/html' } });
const cookies = (r1.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
const html = await r1.text();
const m = cookies.match(/property-search-query=([^;]+)/);
const c = JSON.parse(gunzipSync(Buffer.from(decodeURIComponent(m[1]), 'base64')).toString());
const num = v => /^\d+$/.test(String(v)) ? Number(v) : v;
const fields = (c.fieldsValues || []).map(f => ({ fieldId: f.fieldId, value: num(f.value), fieldConditionId: '', valueConditionId: '' }));
const geo = fields.find(f => /City|Geographic|Region|Borough/i.test(f.fieldId));
const query = { SearchName: '', UseGeographyShapes: c.useGeographyShapes || 0,
  Filters: geo ? [{ MatchType: geo.fieldId, Text: '', Id: geo.value }] : [], FieldsValues: fields };
console.log('Query filtre géo:', JSON.stringify(query.Filters), '| fields:', fields.map(f=>f.fieldId+'='+f.value).join(','));

async function page(n, seed) {
  const res = await fetch(`${BASE}/Property/GetInscriptions`, { method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookies, Referer: `${BASE}/fr/propriete~a-vendre~saint-jerome`, Origin: BASE, 'User-Agent': UA },
    body: JSON.stringify({ mode: 'Result', searchView: 'Thumbnail', sortSeed: seed, sort: 'None', pageSize: 20, page: n, query }) });
  const j = await res.json();
  const h = j?.d?.Result?.html || '';
  const ids = [...h.matchAll(/data-mlsnumber='(\d+)'/g)].map(x => x[1]);
  return { count: j?.d?.Result?.Count, n: ids.length, ids: [...new Set(ids)] };
}

// Page 1 du HTML (compte total annoncé ?)
const totalMatch = html.match(/"Count":(\d+)/) || html.match(/(\d+)\s*(?:r[ée]sultats|propri[ée]t[ée]s|inscriptions)/i);
console.log('Total annoncé page HTML:', totalMatch?.[1] || '?');

for (const seed of [0, 12345]) {
  console.log(`\n=== sortSeed=${seed} ===`);
  const allIds = new Set();
  for (let p = 1; p <= 15; p++) {
    const r = await page(p, seed);
    const newIds = r.ids.filter(i => !allIds.has(i));
    r.ids.forEach(i => allIds.add(i));
    console.log(`  page ${p}: ${r.n} cartes, ${newIds.length} nouvelles | Count API=${r.count} | cumul unique=${allIds.size}`);
    if (r.n < 20) { console.log('  → fin (page incomplète)'); break; }
    await new Promise(z => setTimeout(z, 400));
  }
}
