#!/usr/bin/env node
/**
 * Diagnostic Centris v5 (jetable) — réplication fetch de la pagination.
 * On connaît le contrat : POST /Property/GetInscriptions avec la requête
 * complète (Id CityDistrict de la ville). Reste à extraire cet Id de la page
 * et confirmer que la pagination marche en fetch pur (rapide, sans navigateur).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://www.centris.ca';
const SLUG = 'saint-jerome';
const line = (s = '') => console.log(s);
const hr = () => line('═'.repeat(72));

async function main() {
  hr(); line('DIAGNOSTIC v5 — pagination fetch'); hr();

  // 1. GET page → cookies + Id de la ville
  const res = await fetch(`${BASE}/fr/propriete~a-vendre~${SLUG}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr-CA,fr;q=0.9', 'Accept': 'text/html' },
    redirect: 'follow',
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
  const html = await res.text();
  line(`GET → ${res.status}, ${html.length} car., ${setCookie.length} cookies`);

  // Cherche l'Id CityDistrict dans le HTML / cookie
  const idCandidates = {
    'HTML CityDistrict ...Id': html.match(/CityDistrict[^}]{0,80}?Id["']?\s*[:=]\s*(\d+)/i)?.[1],
    'HTML "Id":NNN near CityDistrict': html.match(/["']?Id["']?\s*[:=]\s*(\d+)[^}]{0,60}CityDistrict/i)?.[1],
    'HTML data-... id': html.match(/GeoTagId["']?\s*[:=]\s*["']?(\d+)/i)?.[1],
    'HTML "value":NNN CityDistrict': html.match(/CityDistrict["'][^]{0,40}?value["']?\s*[:=]\s*["']?(\d+)/i)?.[1],
  };
  line('\nId CityDistrict candidats :');
  for (const [k, v] of Object.entries(idCandidates)) line(`  ${k.padEnd(38)} : ${v ?? '∅'}`);

  // Cookie property-search-query (contient probablement la requête)
  const psq = setCookie.find((c) => c.startsWith('property-search-query'));
  if (psq) {
    const val = decodeURIComponent(psq.split('=').slice(1).join('=').split(';')[0]);
    line(`\nCookie property-search-query (500 car.) :\n  ${val.slice(0, 500)}`);
  } else line('\nPas de cookie property-search-query.');

  // 2. Tente la pagination page 2 avec l'Id trouvé (ou 927 connu pour test)
  const id = Object.values(idCandidates).find(Boolean) || 927;
  line(`\n→ Test GetInscriptions page 2 avec Id=${id}`);
  const body = {
    mode: 'Result', searchView: 'Thumbnail', sortSeed: 0, sort: 'None',
    pageSize: 20, page: 2,
    query: {
      SearchName: '', UseGeographyShapes: 0,
      Filters: [{ MatchType: 'CityDistrict', Text: SLUG, Id: Number(id) }],
      FieldsValues: [
        { fieldId: 'CityDistrict', value: Number(id), fieldConditionId: '', valueConditionId: '' },
        { fieldId: 'Category', value: 'Residential', fieldConditionId: '', valueConditionId: '' },
        { fieldId: 'SellingType', value: 'Sale', fieldConditionId: '', valueConditionId: '' },
      ],
    },
  };
  const r = await fetch(`${BASE}/Property/GetInscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': '*/*', 'Cookie': cookies,
      'Referer': `${BASE}/fr/propriete~a-vendre~${SLUG}`,
      'Origin': BASE, 'User-Agent': UA,
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  const nbCards = (txt.match(/property-thumbnail-item/g) || []).length;
  line(`Réponse : ${r.status} (${txt.length} car.) | cartes=${nbCards}`);
  if (r.status === 200) {
    try {
      const j = JSON.parse(txt);
      const inner = j?.d?.Result?.html || j?.d?.Result?.Html || '';
      line(`  html length=${inner.length} | count=${j?.d?.Result?.Count ?? j?.d?.Count ?? '?'}`);
      line(`  IDs page 2: ${[...inner.matchAll(/data-mlsnumber='(\d+)'/g)].slice(0,5).map(m=>m[1]).join(', ')}`);
    } catch { line('  (réponse non-JSON)  ' + txt.slice(0, 200)); }
  } else line('  corps: ' + txt.slice(0, 200));

  hr(); line('FIN'); hr();
}
main().catch((e) => { console.error('Erreur:', e); process.exit(1); });
