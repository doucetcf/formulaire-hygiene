#!/usr/bin/env node
/** Diagnostic DuProprio v3 — état initial React + API plausibles. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const BASE = 'https://duproprio.com';
const H = { 'User-Agent': UA, 'Accept-Language': 'fr-CA', 'Accept': 'text/html' };

// 1. Charger la page de recherche, garder les cookies
const r1 = await fetch(`${BASE}/fr/rechercher/liste?search=true`, { headers: H });
const setC = r1.headers.getSetCookie?.() ?? [];
const cookies = setC.map(c => c.split(';')[0]).join('; ');
const xsrf = setC.find(c => c.startsWith('XSRF-TOKEN='))?.split('=')[1]?.split(';')[0];
const html = await r1.text();
console.log('page:', r1.status, '| HTML:', html.length, '| cookies:', setC.length);
console.log('XSRF-TOKEN brut:', xsrf?.slice(0, 30));

// 2. État initial React dans le HTML
console.log('\n── état initial dans le HTML ──');
for (const [n, re] of [
  ['<script type="application/json">', /<script[^>]+type="application\/json"[^>]*>([\s\S]{0,300})/],
  ['<script id="initial-state">', /<script[^>]+id="[^"]*(?:initial|state|data|props)[^"]*"[^>]*>([\s\S]{0,300})/i],
  ['window.__INITIAL', /window\.__\w+\s*=\s*([\s\S]{0,300})/],
  ['React props data-state', /data-(?:state|props|react-props)="([\s\S]{0,300})/i],
  ['var initial / let initial', /(?:var|let|const)\s+(?:initial|listings|properties)\s*=\s*([\s\S]{0,200})/i],
]) {
  const m = html.match(re);
  console.log(' ', n.padEnd(36), ':', m ? '✔ ' + m[1].replace(/\s+/g, ' ').slice(0, 120) : '∅');
}

// 3. Tous les <script type="application/json"> (compte + 1er ID)
const scripts = [...html.matchAll(/<script([^>]+)>([\s\S]*?)<\/script>/g)]
  .filter(m => /type="application\/json"/.test(m[1]) || /type="application\/ld\+json"/.test(m[1]));
console.log('\nScripts JSON trouvés:', scripts.length);
scripts.slice(0, 3).forEach((s, i) => {
  console.log(`  [${i}] attrs=${s[1].slice(0, 80)} | content (200c)=${s[2].slice(0, 200).replace(/\s+/g, ' ')}`);
});

// 4. Tester 3 URL d'API plausibles (Laravel)
console.log('\n── API plausibles ──');
const apis = [
  ['/fr/api/properties/search', { regions: [10] }],
  ['/fr/api/search/properties', { regions: [10] }],
  ['/api/search', { regions: [10] }],
];
for (const [path, body] of apis) {
  try {
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': decodeURIComponent(xsrf || ''), 'Cookie': cookies, 'Referer': `${BASE}/fr/rechercher/liste` },
      body: JSON.stringify(body),
    });
    const t = (await r.text()).slice(0, 150).replace(/\s+/g, ' ');
    console.log(`  ${path.padEnd(32)} → ${r.status} (${t.length}c) ${t}`);
  } catch (e) { console.log(`  ${path} → erreur ${e.message}`); }
}
