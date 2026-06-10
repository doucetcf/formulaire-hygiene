#!/usr/bin/env node
/**
 * Diagnostic Centris v2 (jetable).
 * Objectif : extraire la structure HTML exacte d'une carte `property-thumbnail`
 * pour écrire le parseur. Lecture via les logs du workflow.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://www.centris.ca';
const SLUG = 'montreal';

const line = (s = '') => console.log(s);
const hr = () => line('═'.repeat(72));

async function main() {
  hr();
  line('DIAGNOSTIC CENTRIS v2 — extraction structure carte');
  hr();

  const searchUrl = `${BASE}/fr/propriete~a-vendre~${SLUG}`;
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr-CA,fr;q=0.9' },
    redirect: 'follow',
  });
  line(`GET ${searchUrl} → ${res.status}`);
  const html = await res.text();
  line(`HTML : ${html.length} caractères\n`);

  // ---- 1. Isoler une carte property-thumbnail complète ------------------
  // On cherche l'ouverture du div, puis on équilibre les <div> pour trouver sa fin.
  const startIdx = html.indexOf('property-thumbnail');
  if (startIdx < 0) { line('Aucune property-thumbnail.'); return; }
  // recule jusqu'au < du div ouvrant
  const divOpen = html.lastIndexOf('<div', startIdx);

  // équilibrage simple des div à partir de divOpen
  let depth = 0, i = divOpen, end = -1;
  const tagRe = /<\/?div\b/gi;
  tagRe.lastIndex = divOpen;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[0].toLowerCase().startsWith('</')) depth--; else depth++;
    if (depth === 0) { end = tagRe.lastIndex; break; }
    if (tagRe.lastIndex - divOpen > 8000) break; // garde-fou
  }
  const card = html.slice(divOpen, end > 0 ? end : divOpen + 4000);

  line('── CARTE BRUTE (jusqu\'à 4500 car.) ─────────────────────────────');
  line(card.slice(0, 4500));
  line('── FIN CARTE ────────────────────────────────────────────────────\n');

  // ---- 2. Champs candidats dans cette carte -----------------------------
  line('── CHAMPS DÉTECTÉS DANS LA CARTE ────────────────────────────────');
  const grab = (label, re) => {
    const mm = card.match(re);
    line(`  ${label.padEnd(22)} : ${mm ? JSON.stringify((mm[1] ?? mm[0]).slice(0, 90)) : '∅'}`);
  };
  grab('data-id', /data-id="([^"]+)"/);
  grab('lien (a href)', /<a[^>]+href="([^"]+)"/);
  grab('photo (src)', /(https:\/\/mspublic\.centris\.ca\/media\.ashx[^"'\s]+)/);
  grab('prix', /([\d\s  ]+\$)/);
  grab('catégorie', /category[^>]*>([^<]+)</i);
  grab('adresse', /address[^>]*>([^<]+)</i);
  grab('chambres (cac)', /(\d+)\s*(?:cac|chambre)/i);
  grab('sdb', /(\d+)\s*(?:sdb|salle)/i);

  // classes utilisées dans la carte (pour comprendre la structure)
  const classes = [...new Set((card.match(/class="([^"]+)"/g) || [])
    .map((c) => c.replace(/class="|"/g, '')))].slice(0, 40);
  line('\n  Classes CSS présentes :');
  classes.forEach((c) => line('    .' + c));

  hr();
  line('FIN');
  hr();
}

main().catch((e) => { console.error('Erreur:', e); process.exit(1); });
