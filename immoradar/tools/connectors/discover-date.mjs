#!/usr/bin/env node
/** Vérifie si Centris expose une DATE de mise en marché (carte ou réponse API). */
import { gunzipSync } from 'node:zlib';
const UA = 'Mozilla/5.0 Chrome/124';
const BASE = 'https://www.centris.ca';

const r1 = await fetch(`${BASE}/fr/propriete~a-vendre~saint-jerome`, {
  headers: { 'User-Agent': UA, 'Accept-Language': 'fr-CA', Accept: 'text/html' } });
const cookies = (r1.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
const html = await r1.text();

// 1. Patterns de date dans une carte de la page
const card = html.match(/property-thumbnail-item[\s\S]{0,3500}/)?.[0] || '';
console.log('=== recherche de date dans la CARTE ===');
for (const [n, re] of [
  ['date- attribut', /date[-\w]*="[^"]*"/gi],
  ['data-*date', /data-[\w-]*(?:date|jour|day|time|published)[\w-]*="[^"]+"/gi],
  ['mot "jour"', /\d+\s*jour/gi],
  ['date AAAA-MM-JJ', /\b20\d\d-\d\d-\d\d\b/g],
  ['"nouveau"/"new"', /nouveau|recently|new-listing/gi],
]) {
  const m = card.match(re);
  console.log(`  ${n.padEnd(20)} : ${m ? m.slice(0,3).join(' | ') : '∅'}`);
}

// 2. Réponse GetInscriptions : structure complète de d.Result (au-delà du html)
const m = cookies.match(/property-search-query=([^;]+)/);
const c = JSON.parse(gunzipSync(Buffer.from(decodeURIComponent(m[1]), 'base64')).toString());
const num = v => /^\d+$/.test(String(v)) ? Number(v) : v;
const fields = (c.fieldsValues || []).map(f => ({ fieldId: f.fieldId, value: num(f.value), fieldConditionId: '', valueConditionId: '' }));
const geo = fields.find(f => /City|Geographic|Region/i.test(f.fieldId));
const query = { SearchName: '', UseGeographyShapes: 0, Filters: geo ? [{ MatchType: geo.fieldId, Text: '', Id: geo.value }] : [], FieldsValues: fields };
const res = await fetch(`${BASE}/Property/GetInscriptions`, { method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest',
    Cookie: cookies, Referer: `${BASE}/fr/propriete~a-vendre~saint-jerome`, Origin: BASE, 'User-Agent': UA },
  body: JSON.stringify({ mode: 'Result', searchView: 'Thumbnail', sortSeed: 0, sort: 'None', pageSize: 20, page: 1, query }) });
const j = await res.json();
console.log('\n=== structure réponse GetInscriptions ===');
console.log('d keys:', Object.keys(j.d || {}));
console.log('d.Result keys:', Object.keys(j.d?.Result || {}));
// chercher une date dans tout le JSON (hors html)
const noHtml = { ...j.d?.Result }; delete noHtml.html; delete noHtml.Html;
console.log('d.Result (sans html):', JSON.stringify(noHtml).slice(0, 500));

// 3. Tester les options de SORT par date (révèle si le tri par date existe)
console.log('\n=== test sort par date ===');
for (const sort of ['1', '3', 'Date', 'CreationDate-Desc']) {
  const rr = await fetch(`${BASE}/Property/GetInscriptions`, { method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookies, Referer: `${BASE}/fr/propriete~a-vendre~saint-jerome`, Origin: BASE, 'User-Agent': UA },
    body: JSON.stringify({ mode: 'Result', searchView: 'Thumbnail', sortSeed: 0, sort, pageSize: 20, page: 1, query }) });
  const jj = await rr.json().catch(()=>({}));
  const ids = [...new Set([...(jj.d?.Result?.html||'').matchAll(/data-mlsnumber='(\d+)'/g)].map(x=>x[1]))];
  console.log(`  sort="${sort}" → ${rr.status}, 1ers MLS: ${ids.slice(0,4).join(', ')}`);
}
