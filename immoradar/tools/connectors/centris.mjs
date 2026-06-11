#!/usr/bin/env node
/**
 * Connecteur Centris — ImmoRadar Québec
 *
 * Approche : on récupère le HTML de la page de recherche de chaque ville
 * (HTTP 200, ~20 annonces embarquées par page) et on parse les cartes
 * `property-thumbnail-item`. Structure stable, coordonnées GPS réelles.
 *
 * Usage personnel, faible volume, pause entre les requêtes.
 *
 *   node immoradar/tools/connectors/centris.mjs
 *   node immoradar/tools/connectors/centris.mjs --debug
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const OUT = join(DATA_DIR, 'listings.json');

const args = process.argv.slice(2);
const DEBUG = args.includes('--debug');
const dbg = (...a) => { if (DEBUG) console.log('[debug]', ...a); };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://www.centris.ca';
const PAUSE_MS = 1500;
const JITTER_MS = 800;

/** Villes cibles : Grand Montréal, Laurentides, Lanaudière */
const CITIES = [
  // Grand Montréal
  { slug: 'montreal',        region: 'Montréal' },
  { slug: 'laval',           region: 'Laval' },
  { slug: 'longueuil',       region: 'Montérégie' },
  { slug: 'brossard',        region: 'Montérégie' },
  { slug: 'boucherville',    region: 'Montérégie' },
  { slug: 'varennes',        region: 'Montérégie' },
  { slug: 'saint-bruno-de-montarville', region: 'Montérégie' },
  // Lanaudière
  { slug: 'terrebonne',      region: 'Lanaudière' },
  { slug: 'repentigny',      region: 'Lanaudière' },
  { slug: 'mascouche',       region: 'Lanaudière' },
  { slug: 'joliette',        region: 'Lanaudière' },
  { slug: 'rawdon',          region: 'Lanaudière' },
  { slug: 'saint-charles-borromee', region: 'Lanaudière' },
  { slug: 'l-assomption',    region: 'Lanaudière' },
  // Laurentides
  { slug: 'blainville',      region: 'Laurentides' },
  { slug: 'mirabel',         region: 'Laurentides' },
  { slug: 'saint-jerome',    region: 'Laurentides' },
  { slug: 'sainte-adele',    region: 'Laurentides' },
  { slug: 'sainte-therese',  region: 'Laurentides' },
  { slug: 'mont-tremblant',  region: 'Laurentides' },
  { slug: 'saint-sauveur',   region: 'Laurentides' },
  { slug: 'morin-heights',   region: 'Laurentides' },
];

// Catégorie Centris (texte) → type interne ImmoRadar
function detectType(label) {
  const l = (label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/terrain|lot\b/.test(l)) return 'terrain';
  if (/duplex|triplex|quadruplex|quintuplex|plex/.test(l)) return 'plex';
  if (/condo|appartement|loft|copropri/.test(l)) return 'condo';
  if (/chalet|villegiature/.test(l)) return 'chalet';
  if (/fermette|ferme|hobby/.test(l)) return 'fermette';
  if (/intergeneration/.test(l)) return 'intergeneration';
  if (/maison de ville|ville/.test(l)) return 'maison-ville';
  if (/maison|jumel|paliers|etage|plain-pied|bungalow|cottage/.test(l)) return 'unifamiliale';
  return 'unifamiliale';
}
const TYPE_LABELS = {
  unifamiliale: 'Maison unifamiliale', condo: 'Condo / Appartement',
  plex: 'Plex', 'maison-ville': 'Maison de ville', chalet: 'Chalet / Villégiature',
  fermette: 'Fermette', terrain: 'Terrain', intergeneration: 'Intergénération',
};

// ------------------------------------------------------------------ Utilitaires
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => sleep(PAUSE_MS + Math.random() * JITTER_MS);

// Décode les entités HTML courantes
function decode(s) {
  return (s || '')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function stripTags(s) { return decode((s || '').replace(/<[^>]+>/g, ' ')); }
function intFrom(s) { const m = (s || '').replace(/\s| |&#xA0;/g, '').match(/\d+/); return m ? +m[0] : 0; }

// ------------------------------------------------------------------ Découpe en cartes
// Sépare le HTML en blocs `property-thumbnail-item`.
function splitCards(html) {
  const parts = html.split(/<div class="property-thumbnail-item\b/);
  return parts.slice(1).map((p) => '<div class="property-thumbnail-item ' + p);
}

// ------------------------------------------------------------------ Parsing d'une carte
function parseCard(card, region) {
  // ID (numéro MLS)
  const id = card.match(/data-mlsnumber='(\d+)'/)?.[1]
    || card.match(/data-id="(\d+)"/)?.[1]
    || card.match(/id="MlsNumberNoStealth"[^>]*>\s*<p[^>]*>(\d+)/)?.[1];
  if (!id) { dbg('Carte sans ID'); return null; }

  // Lien vers l'annonce
  const href = card.match(/class="a-more-detail"\s+href="([^"]+)"/)?.[1]
    || card.match(/href="(\/fr\/[^"]+\/\d+)"/)?.[1];
  const url = href ? BASE + href : `${BASE}/fr/propriete/${id}`;

  // Prix (meta = entier propre)
  const price = intFrom(card.match(/itemprop="price"\s+content="(\d+)"/)?.[1]);
  if (!price) { dbg(`Carte ${id} sans prix`); return null; }

  // Catégorie / type
  const catRaw = stripTags(card.match(/class="category"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/)?.[1]
    || card.match(/class="category"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '');
  const type = detectType(catRaw);

  // Adresse : 2 <div> de texte dans .address (rue, puis "Ville (Quartier)")
  const addrPos = card.indexOf('class="address"');
  const addrZone = addrPos >= 0 ? card.slice(addrPos, addrPos + 600) : '';
  const addrLines = [...addrZone.matchAll(/<div>([^<]+)<\/div>/g)]
    .map((m) => stripTags(m[1])).filter(Boolean);
  const address = addrLines[0] || `Propriété ${id}`;
  const cityRaw = addrLines[1] || '';
  const cityMatch = cityRaw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const city = cityMatch ? cityMatch[1].trim() : cityRaw.trim();
  const district = cityMatch ? cityMatch[2].trim() : '';

  // Chambres / salles de bain
  const bedrooms = intFrom(card.match(/class='cac'>(\d+)</)?.[1] || card.match(/class="cac">(\d+)</)?.[1]);
  const bathrooms = intFrom(card.match(/class='sdb'>(\d+)</)?.[1] || card.match(/class="sdb">(\d+)</)?.[1]);

  // Revenus de plex
  const revenue = intFrom(card.match(/plex-revenue[\s\S]*?Rev[^:]*:\s*([\d\s &#xA;]+)\$/)?.[1]);

  // Coordonnées GPS réelles
  const lat = parseFloat(card.match(/data-lat="([-\d.]+)"/)?.[1]) || 0;
  const lng = parseFloat(card.match(/data-lng="([-\d.]+)"/)?.[1]) || 0;
  if (!lat || !lng) { dbg(`Carte ${id} sans coordonnées`); return null; }

  // Photo de couverture (on agrandit la largeur)
  let photoUrl = card.match(/(https:\/\/mspublic\.centris\.ca\/media\.ashx\?[^"'\s&]*(?:&amp;[^"'\s]*)?)/)?.[1] || null;
  if (photoUrl) photoUrl = decode(photoUrl).replace(/([?&]w=)\d+/, '$1640').replace(/([?&]h=)\d+/, '$1480');

  // Nombre total de photos (bouton appareil photo)
  const photoCount = intFrom(card.match(/photo-btn[\s\S]*?>\s*(\d+)\s*<i/)?.[1]) || (photoUrl ? 1 : 0);

  return {
    source: 'centris',
    sourceId: id,
    url,
    address, city, district, region,
    lat, lng,
    price,
    type,
    typeLabel: catRaw.replace(/\s*à vendre\s*$/i, '').trim() || TYPE_LABELS[type],
    bedrooms, bathrooms,
    powderRooms: 0,
    rooms: 0,
    levels: 1,
    livingAreaSqft: 0,   // non dispo sur la carte (page détail requise)
    lotAreaSqm: 0,
    yearBuilt: 0,
    units: type === 'plex' ? (catRaw.match(/(\d+)\s*logement/i)?.[1] | 0) : 0,
    revenue,
    features: {
      garage: /garage/i.test(card),
      parkingSpots: 0,
      pool: /piscine/i.test(card),
      waterfront: /bord de l['’]eau|navigable|bord de l eau/i.test(card),
      waterAccess: /acc[èe]s.{0,10}(?:eau|lac|plan d)/i.test(card),
      fireplace: /foyer|po[êe]le/i.test(card),
      elevator: /ascenseur/i.test(card),
      accessible: /adapt[ée]/i.test(card),
      centralAir: false,
    },
    photoUrl,
    photos: photoUrl ? [photoUrl] : [],
    photoCount: photoUrl ? 1 : 0,
    photosAvailable: photoCount,        // total réel sur Centris
    openHouse: /visite libre/i.test(card),
    repossession: /reprise|saisie/i.test(card),
    newConstruction: /construction neuve|neuf|nouveau projet/i.test(catRaw),
    publishedAt: new Date().toISOString().slice(0, 10),
    description: '',
  };
}

// ------------------------------------------------------------------ Une ville
async function fetchCity(meta) {
  const url = `${BASE}/fr/propriete~a-vendre~${meta.slug}`;
  console.log(`\n📍 ${meta.slug} (${meta.region})`);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr-CA,fr;q=0.9', 'Accept': 'text/html' },
      redirect: 'follow',
    });
    if (!res.ok) { console.log(`   ✗ HTTP ${res.status}`); return []; }
    const html = await res.text();
    const cards = splitCards(html);
    dbg(`${cards.length} cartes brutes`);

    const listings = [];
    for (const card of cards) {
      const l = parseCard(card, meta.region);
      if (l) listings.push(l);
    }
    console.log(`   ✔ ${listings.length} annonces`);
    return listings;
  } catch (err) {
    console.log(`   ✗ ${err.message}`);
    if (DEBUG) console.error(err);
    return [];
  }
}

// ------------------------------------------------------------------ Main
// IMPORTANT : on écrit des annonces au format BRUT (une entrée par source,
// champs `source`/`sourceId`/`url` à plat). C'est le frontend qui fusionne
// les doublons multi-plateformes — exactement comme avec les données démo.
async function main() {
  console.log('🏠 ImmoRadar — Connecteur Centris');
  console.log(`   ${CITIES.length} villes (Grand Montréal, Lanaudière, Laurentides)`);

  const allRaw = [];
  for (const city of CITIES) {
    allRaw.push(...await fetchCity(city));
    if (CITIES.indexOf(city) < CITIES.length - 1) await pause();
  }

  // Déduplication par sourceId (une même annonce peut apparaître dans 2 villes)
  const byId = new Map();
  for (const l of allRaw) if (!byId.has(l.sourceId)) byId.set(l.sourceId, l);
  const centris = [...byId.values()];
  console.log(`\n📊 ${centris.length} annonces Centris uniques (sur ${allRaw.length} brutes)`);

  if (!centris.length) {
    console.error('\n⚠️  Aucune annonce Centris récupérée — fichier NON écrasé.');
    process.exit(1);
  }

  // Conserve les annonces BRUTES d'autres sources (DuProprio/Ubee à venir)
  let preserved = [];
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, 'utf-8'));
      preserved = (prev.listings || []).filter((l) => l.source && l.source !== 'centris');
      if (preserved.length) console.log(`📦 Annonces d'autres sources conservées : ${preserved.length}`);
    } catch { /* ignore */ }
  }

  const final = [...centris, ...preserved];
  const output = {
    generatedAt: new Date().toISOString(),
    sourceStats: { centris: centris.length, other: preserved.length, total: final.length },
    listings: final,
  };

  writeFileSync(OUT, JSON.stringify(output, null, 1));
  console.log(`\n✅ ${OUT}`);
  console.log(`   ${final.length} annonces au total`);
}

main().catch((err) => { console.error('Erreur fatale:', err); process.exit(1); });
