#!/usr/bin/env node
/**
 * Script de DIAGNOSTIC Centris (jetable).
 * Tourne sur le runner GitHub (qui a accès à Centris) et imprime dans les logs
 * tout ce dont on a besoin pour écrire le vrai connecteur :
 *   - statut + taille de la page de recherche
 *   - présence de cookies / token CSRF
 *   - données d'annonces embarquées dans le HTML (JSON inline)
 *   - résultat de plusieurs variantes d'endpoint AJAX
 *
 * Lecture des résultats via les logs du workflow.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://www.centris.ca';
const SLUG = 'montreal';

const line = (s = '') => console.log(s);
const hr = () => line('─'.repeat(70));

async function main() {
  hr();
  line('DIAGNOSTIC CENTRIS — ' + new Date().toISOString());
  hr();

  // ---- 1. Page de recherche --------------------------------------------
  const searchUrl = `${BASE}/fr/propriete~a-vendre~${SLUG}`;
  line(`\n[1] GET ${searchUrl}`);
  let html = '', cookies = '', token = '';
  try {
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    line(`    Statut HTTP : ${res.status}`);
    line(`    Content-Type : ${res.headers.get('content-type')}`);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
    line(`    Cookies reçus : ${setCookie.length} (${cookies.slice(0, 80)}…)`);
    html = await res.text();
    line(`    Taille HTML : ${html.length} caractères`);

    const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    token = tokenMatch?.[1] ?? '';
    line(`    Token CSRF : ${token ? '✔ trouvé (' + token.slice(0, 16) + '…)' : '✗ absent'}`);

    // détecter une page de challenge anti-bot
    if (/captcha|cf-challenge|cloudflare|are you human|verifying you are/i.test(html)) {
      line('    ⚠️  La page ressemble à un challenge anti-bot (Cloudflare/captcha).');
    }
  } catch (err) {
    line(`    ✗ ÉCHEC : ${err.message}`);
    return;
  }

  // ---- 2. Données embarquées dans le HTML ------------------------------
  line(`\n[2] Recherche de données d'annonces dans le HTML`);
  const markers = [
    ['property-thumbnail', /property-thumbnail/g],
    ['<article', /<article/g],
    ['data-id=', /data-id=/g],
    ['/fr/...udi=', /udi=[A-Z0-9]+/g],
    ['mspublic media (photos)', /mspublic\.centris\.ca\/media\.ashx/g],
    ['$ (prix)', /\d[\d\s]{2,}\s*\$/g],
    ['__INITIAL', /__INITIAL[_A-Z]*\s*=/g],
    ['window.__', /window\.__\w+\s*=/g],
  ];
  for (const [name, re] of markers) {
    const n = (html.match(re) || []).length;
    line(`    ${name.padEnd(28)} : ${n} occurrence(s)`);
  }

  // Extrait un échantillon de carte pour voir la structure
  const cardSample = html.match(/<article[\s\S]{0,1200}?<\/article>/);
  if (cardSample) {
    line('\n    ── Échantillon de <article> (1200 car. max) ──');
    line(cardSample[0].replace(/\s+/g, ' ').slice(0, 1200));
  } else {
    line('    Aucun <article> trouvé dans le HTML.');
  }

  // ---- 3. Variantes d'endpoint AJAX ------------------------------------
  line(`\n[3] Test des endpoints AJAX (POST)`);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cookies,
    'Referer': searchUrl,
    'Origin': BASE,
    'User-Agent': UA,
    '__RequestVerificationToken': token,
  };

  const endpoints = [
    ['POST /Property/GetInscriptions', `${BASE}/Property/GetInscriptions`,
      { startPosition: 0 }],
    ['POST /Mvc/Property/GetInscriptions', `${BASE}/Mvc/Property/GetInscriptions`,
      { startPosition: 0 }],
    ['POST /property/GetInscriptions', `${BASE}/property/GetInscriptions`,
      { startPosition: 0 }],
    ['POST /UserContext/Lock', `${BASE}/UserContext/Lock`, { uc: 0 }],
    ['POST /property/UpdateQuery', `${BASE}/property/UpdateQuery`,
      { query: { UseGeographyShapes: 0, Filters: [], FieldsValues: [
        { fieldId: 'GeographicArea', value: 'GSGS4621', fieldConditionId: '', valueConditionId: '' },
        { fieldId: 'Category', value: 'Residential', fieldConditionId: 'IsResidential', valueConditionId: '' },
        { fieldId: 'SellingType', value: 'Sale', fieldConditionId: '', valueConditionId: '' },
      ] }, isHomePage: false }],
  ];

  for (const [name, url, body] of endpoints) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await res.text();
      let kind = 'texte';
      try { JSON.parse(txt); kind = 'JSON ✔'; } catch { /* html ou autre */ }
      line(`    ${name.padEnd(38)} → ${res.status} (${kind}, ${txt.length} car.)`);
      if (res.status === 200 && txt.length > 20) {
        line(`        aperçu: ${txt.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    } catch (err) {
      line(`    ${name.padEnd(38)} → ERREUR ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  hr();
  line('FIN DU DIAGNOSTIC');
  hr();
}

main().catch((e) => { console.error('Erreur fatale:', e); process.exit(1); });
