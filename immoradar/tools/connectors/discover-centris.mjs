#!/usr/bin/env node
/**
 * Diagnostic Centris v3 (jetable) — PAGINATION.
 * Objectif : faire fonctionner l'appel GetInscriptions (page 2+) pour pouvoir
 * récupérer plus de 20 annonces par ville. Lecture via les logs du workflow.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://www.centris.ca';
const SLUG = 'montreal';

const line = (s = '') => console.log(s);
const hr = () => line('═'.repeat(72));

async function main() {
  hr(); line('DIAGNOSTIC CENTRIS v3 — PAGINATION'); hr();

  // ---- 1. GET page de recherche : cookies + token éventuel ---------------
  const searchUrl = `${BASE}/fr/propriete~a-vendre~${SLUG}`;
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr-CA,fr;q=0.9', 'Accept': 'text/html' },
    redirect: 'follow',
  });
  line(`GET ${searchUrl} → ${res.status}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
  line(`Cookies (${setCookie.length}) : ${setCookie.map((c) => c.split('=')[0]).join(', ')}`);
  const html = await res.text();

  // Cherche un jeton anti-forgery partout (input, meta, JS, cookie)
  const tokenCandidates = {
    'input __RequestVerificationToken': html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1],
    'meta token': html.match(/<meta[^>]+(?:csrf|verification)[^>]+content="([^"]+)"/i)?.[1],
    'JS verificationToken': html.match(/verificationToken['"]?\s*[:=]\s*['"]([^'"]+)/i)?.[1],
    'JS __RequestVerificationToken': html.match(/__RequestVerificationToken['"]?\s*[:=]\s*['"]([^'"]+)/)?.[1],
    'cookie token': setCookie.find((c) => /verif|forgery|csrf/i.test(c))?.split('=').slice(1).join('=').split(';')[0],
  };
  line('\nJetons candidats :');
  for (const [k, v] of Object.entries(tokenCandidates)) line(`  ${k.padEnd(34)} : ${v ? '✔ ' + v.slice(0, 24) + '…' : '∅'}`);
  const token = Object.values(tokenCandidates).find(Boolean) || '';

  // ---- 2. Essais de GetInscriptions (page 2 = startPosition 20) ----------
  const url = `${BASE}/Property/GetInscriptions`;
  const baseHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cookies,
    'Referer': searchUrl,
    'Origin': BASE,
    'User-Agent': UA,
  };

  const attempts = [
    ['startPosition:20, sans token', baseHeaders, { startPosition: 20 }],
    ['startPosition:20, token header', { ...baseHeaders, '__RequestVerificationToken': token }, { startPosition: 20 }],
    ['startPosition:20, RequestVerificationToken header', { ...baseHeaders, 'RequestVerificationToken': token }, { startPosition: 20 }],
    ['startPosition:"20" (string)', { ...baseHeaders, '__RequestVerificationToken': token }, { startPosition: '20' }],
  ];

  for (const [name, headers, body] of attempts) {
    try {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await r.text();
      let count = null, hasHtml = false;
      try { const j = JSON.parse(txt); count = j?.d?.Result?.Count ?? j?.d?.Count ?? null; hasHtml = /property-thumbnail-item/.test(j?.d?.Result?.Html || j?.d?.Html || JSON.stringify(j)); } catch {}
      const nbCards = (txt.match(/property-thumbnail-item/g) || []).length;
      line(`\n[${name}] → ${r.status} (${txt.length} car.)`);
      line(`   count=${count} | cartes dans réponse=${nbCards} | htmlDétecté=${hasHtml}`);
      if (r.status === 200) line(`   aperçu: ${txt.replace(/\s+/g, ' ').slice(0, 220)}`);
    } catch (e) { line(`\n[${name}] → ERREUR ${e.message}`); }
    await new Promise((r) => setTimeout(r, 700));
  }

  // ---- 3. Y a-t-il un total d'annonces dispo dans le HTML ? --------------
  const total = html.match(/(\d[\d\s ]*)\s*(?:propriétés|résultats|inscriptions)/i)?.[1];
  line(`\nTotal annoncé dans le HTML : ${total ? total.replace(/\s/g, '') : '∅'}`);

  hr(); line('FIN'); hr();
}
main().catch((e) => { console.error('Erreur:', e); process.exit(1); });
