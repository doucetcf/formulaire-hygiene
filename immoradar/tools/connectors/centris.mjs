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
import { gunzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const OUT = join(DATA_DIR, 'listings.json');

const args = process.argv.slice(2);
const DEBUG = args.includes('--debug');
const dbg = (...a) => { if (DEBUG) console.log('[debug]', ...a); };
// Pages max par ville (10 × 20 = 200 annonces/ville). Override : --max-pages=N
const MAX_PAGES = Number(args.find((a) => a.startsWith('--max-pages='))?.split('=')[1]) || 10;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://www.centris.ca';
const PAUSE_MS = 1100;
const JITTER_MS = 700;

/**
 * Villes cibles : Grand Montréal, Laurentides, Lanaudière.
 * Chaque municipalité = une recherche Centris (20 annonces les plus récentes).
 * Les slugs invalides retournent 404 et sont ignorés sans casser le run.
 */
const CITIES = [
  // ── Île de Montréal + villes liées ──
  { slug: 'montreal',        region: 'Montréal' },
  { slug: 'westmount',       region: 'Montréal' },
  { slug: 'mont-royal',      region: 'Montréal' },
  { slug: 'cote-saint-luc',  region: 'Montréal' },
  { slug: 'hampstead',       region: 'Montréal' },
  { slug: 'montreal-ouest',  region: 'Montréal' },
  { slug: 'dorval',          region: 'Montréal' },
  { slug: 'pointe-claire',   region: 'Montréal' },
  { slug: 'dollard-des-ormeaux', region: 'Montréal' },
  { slug: 'kirkland',        region: 'Montréal' },
  { slug: 'beaconsfield',    region: 'Montréal' },
  { slug: 'sainte-anne-de-bellevue', region: 'Montréal' },
  // ── Laval ──
  { slug: 'laval',           region: 'Laval' },
  // ── Montérégie (Rive-Sud) ──
  { slug: 'longueuil',       region: 'Montérégie' },
  { slug: 'brossard',        region: 'Montérégie' },
  { slug: 'boucherville',    region: 'Montérégie' },
  { slug: 'saint-bruno-de-montarville', region: 'Montérégie' },
  { slug: 'saint-lambert',   region: 'Montérégie' },
  { slug: 'sainte-julie',    region: 'Montérégie' },
  { slug: 'varennes',        region: 'Montérégie' },
  { slug: 'chambly',         region: 'Montérégie' },
  { slug: 'carignan',        region: 'Montérégie' },
  { slug: 'beloeil',         region: 'Montérégie' },
  { slug: 'mont-saint-hilaire', region: 'Montérégie' },
  { slug: 'saint-basile-le-grand', region: 'Montérégie' },
  { slug: 'la-prairie',      region: 'Montérégie' },
  { slug: 'candiac',         region: 'Montérégie' },
  { slug: 'saint-constant',  region: 'Montérégie' },
  { slug: 'sainte-catherine', region: 'Montérégie' },
  { slug: 'delson',          region: 'Montérégie' },
  { slug: 'chateauguay',     region: 'Montérégie' },
  { slug: 'mercier',         region: 'Montérégie' },
  { slug: 'vaudreuil-dorion', region: 'Montérégie' },
  { slug: 'saint-jean-sur-richelieu', region: 'Montérégie' },
  { slug: 'saint-hyacinthe', region: 'Montérégie' },
  // ── Lanaudière ──
  { slug: 'terrebonne',      region: 'Lanaudière' },
  { slug: 'repentigny',      region: 'Lanaudière' },
  { slug: 'mascouche',       region: 'Lanaudière' },
  { slug: 'l-assomption',    region: 'Lanaudière' },
  { slug: 'charlemagne',     region: 'Lanaudière' },
  { slug: 'lavaltrie',       region: 'Lanaudière' },
  { slug: 'saint-sulpice',   region: 'Lanaudière' },
  { slug: 'joliette',        region: 'Lanaudière' },
  { slug: 'notre-dame-des-prairies', region: 'Lanaudière' },
  { slug: 'saint-charles-borromee', region: 'Lanaudière' },
  { slug: 'rawdon',          region: 'Lanaudière' },
  { slug: 'saint-lin-laurentides', region: 'Lanaudière' },
  { slug: 'sainte-julienne', region: 'Lanaudière' },
  { slug: 'saint-felix-de-valois', region: 'Lanaudière' },
  { slug: 'chertsey',        region: 'Lanaudière' },
  { slug: 'saint-donat',     region: 'Lanaudière' },
  { slug: 'berthierville',   region: 'Lanaudière' },
  // ── Laurentides ──
  { slug: 'saint-jerome',    region: 'Laurentides' },
  { slug: 'blainville',      region: 'Laurentides' },
  { slug: 'mirabel',         region: 'Laurentides' },
  { slug: 'boisbriand',      region: 'Laurentides' },
  { slug: 'sainte-therese',  region: 'Laurentides' },
  { slug: 'rosemere',        region: 'Laurentides' },
  { slug: 'lorraine',        region: 'Laurentides' },
  { slug: 'saint-eustache',  region: 'Laurentides' },
  { slug: 'deux-montagnes',  region: 'Laurentides' },
  { slug: 'sainte-marthe-sur-le-lac', region: 'Laurentides' },
  { slug: 'saint-colomban',  region: 'Laurentides' },
  { slug: 'prevost',         region: 'Laurentides' },
  { slug: 'sainte-sophie',   region: 'Laurentides' },
  { slug: 'sainte-adele',    region: 'Laurentides' },
  { slug: 'saint-sauveur',   region: 'Laurentides' },
  { slug: 'morin-heights',   region: 'Laurentides' },
  { slug: 'sainte-agathe-des-monts', region: 'Laurentides' },
  { slug: 'val-david',       region: 'Laurentides' },
  { slug: 'mont-tremblant',  region: 'Laurentides' },
  { slug: 'lachute',         region: 'Laurentides' },
  // ── Laurentides — ajouts (couvre les secteurs Saint-Jérôme/Pays-d'en-Haut) ──
  { slug: 'saint-hippolyte', region: 'Laurentides' },
  { slug: 'sainte-anne-des-lacs', region: 'Laurentides' },
  { slug: 'piedmont',        region: 'Laurentides' },
  { slug: 'val-morin',       region: 'Laurentides' },
  { slug: 'sainte-marguerite-du-lac-masson', region: 'Laurentides' },
  { slug: 'esterel',         region: 'Laurentides' },
  { slug: 'saint-adolphe-d-howard', region: 'Laurentides' },
  { slug: 'wentworth-nord',  region: 'Laurentides' },
  { slug: 'la-conception',   region: 'Laurentides' },
  { slug: 'labelle',         region: 'Laurentides' },
  { slug: 'riviere-rouge',   region: 'Laurentides' },
  { slug: 'oka',             region: 'Laurentides' },
  { slug: 'pointe-calumet',  region: 'Laurentides' },
  { slug: 'saint-joseph-du-lac', region: 'Laurentides' },
  // ── Lanaudière — ajouts ──
  { slug: 'sainte-marie-salome', region: 'Lanaudière' },
  { slug: 'saint-roch-de-l-achigan', region: 'Lanaudière' },
  { slug: 'crabtree',        region: 'Lanaudière' },
  { slug: 'saint-jean-de-matha', region: 'Lanaudière' },
  { slug: 'saint-ambroise-de-kildare', region: 'Lanaudière' },
  // ── Montérégie / couronne sud — ajouts ──
  { slug: 'saint-amable',    region: 'Montérégie' },
  { slug: 'contrecoeur',     region: 'Montérégie' },
  { slug: 'vercheres',       region: 'Montérégie' },
  { slug: 'otterburn-park',  region: 'Montérégie' },
  { slug: 'mcmasterville',   region: 'Montérégie' },
  { slug: 'saint-mathieu-de-beloeil', region: 'Montérégie' },
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
    publishedAt: null,   // non disponible sur la fiche de résultats Centris
    description: '',
  };
}

// Décode le cookie property-search-query (base64 + gzip) et le transforme dans
// le format PascalCase attendu par GetInscriptions. Le cookie stocke la requête
// en minuscules (fieldsValues…) ; on la convertit. Fonctionne pour TOUTES les
// villes, peu importe le type de filtre géographique (CityDistrict, GeographicArea…).
function decodeSearchQuery(cookies) {
  const m = cookies.match(/property-search-query=([^;]+)/);
  if (!m) return null;
  try {
    const raw = gunzipSync(Buffer.from(decodeURIComponent(m[1]), 'base64')).toString('utf-8');
    const c = JSON.parse(raw);
    const num = (v) => (/^\d+$/.test(String(v)) ? Number(v) : v);
    const fields = (c.fieldsValues || c.FieldsValues || []).map((f) => ({
      fieldId: f.fieldId, value: num(f.value), fieldConditionId: '', valueConditionId: '',
    }));
    if (!fields.length) return null;
    const geo = fields.find((f) => /City|Geographic|Region|Borough/i.test(f.fieldId));
    return {
      SearchName: '',
      UseGeographyShapes: c.useGeographyShapes || c.UseGeographyShapes || 0,
      Filters: geo ? [{ MatchType: geo.fieldId, Text: '', Id: geo.value }] : [],
      FieldsValues: fields,
    };
  } catch (e) { dbg('decode cookie: ' + e.message); return null; }
}

// Récupère une page de résultats via l'API interne GetInscriptions.
async function getInscriptionsPage(meta, query, pageNum, cookies) {
  const body = {
    mode: 'Result', searchView: 'Thumbnail', sortSeed: 0, sort: 'None',
    pageSize: 20, page: pageNum, query,
  };
  const res = await fetch(`${BASE}/Property/GetInscriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest', 'Accept': '*/*',
      'Cookie': cookies, 'Referer': `${BASE}/fr/propriete~a-vendre~${meta.slug}`,
      'Origin': BASE, 'User-Agent': UA,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`page ${pageNum} HTTP ${res.status}`);
  const j = await res.json();
  return j?.d?.Result?.html || j?.d?.Result?.Html || '';
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
    const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const html = await res.text();

    const listings = [];
    const seen = new Set();
    const addCards = (rawHtml) => {
      let n = 0;
      for (const card of splitCards(rawHtml)) {
        const l = parseCard(card, meta.region);
        if (l && !seen.has(l.sourceId)) { seen.add(l.sourceId); listings.push(l); n++; }
      }
      return n;
    };

    addCards(html);                         // page 1 (embarquée dans le HTML)
    const query = decodeSearchQuery(cookies);

    // Pages suivantes via l'API GetInscriptions (s'arrête quand une page
    // ramène moins de 20 annonces, ou à la limite MAX_PAGES).
    if (query) {
      for (let page = 2; page <= MAX_PAGES; page++) {
        await sleep(550 + Math.random() * 450);
        let added;
        try {
          const pageHtml = await getInscriptionsPage(meta, query, page, cookies);
          added = addCards(pageHtml);
        } catch (e) { dbg(`${meta.slug} ${e.message}`); break; }
        if (added < 20) break;              // dernière page atteinte
      }
    } else dbg(`${meta.slug} : requête introuvable, page 1 seulement`);

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
