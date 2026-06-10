#!/usr/bin/env node
/**
 * Connecteur Centris — ImmoRadar Québec
 *
 * Utilise les appels AJAX internes du site Centris (les mêmes que le navigateur).
 * Usage personnel uniquement, volume limité, pause entre requêtes.
 *
 *   node immoradar/tools/connectors/centris.mjs
 *   node immoradar/tools/connectors/centris.mjs --debug
 *   node immoradar/tools/connectors/centris.mjs --max-per-city 3
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const OUT = join(DATA_DIR, 'listings.json');

// ------------------------------------------------------------------ Arguments
const args = process.argv.slice(2);
const DEBUG = args.includes('--debug');
const MAX_PAGES = parseInt(args.find((a) => a.startsWith('--max-per-city='))?.split('=')[1] ?? '10');
const log = (...a) => console.log(...a);
const dbg = (...a) => { if (DEBUG) console.log('[debug]', ...a); };

// ------------------------------------------------------------------ Config
const BASE = 'https://www.centris.ca';
const MEDIA = 'https://mspublic.centris.ca/media.ashx';
const PAGE_SIZE = 20;
const PAUSE_MS = 1200;   // délai minimal entre appels — respectueux du serveur
const JITTER_MS = 600;

/** Villes cibles par région (slug Centris → metadata) */
const CITIES = [
  // Grand Montréal
  { slug: 'montreal',        city: 'Montréal',         region: 'Montréal',       lat: 45.5089, lng: -73.5617, r: 0.08 },
  { slug: 'laval',           city: 'Laval',             region: 'Laval',          lat: 45.6066, lng: -73.7124, r: 0.06 },
  { slug: 'longueuil',       city: 'Longueuil',         region: 'Montérégie',     lat: 45.5312, lng: -73.5181, r: 0.05 },
  { slug: 'brossard',        city: 'Brossard',          region: 'Montérégie',     lat: 45.4583, lng: -73.4659, r: 0.04 },
  { slug: 'saint-hubert',    city: 'Saint-Hubert',      region: 'Montérégie',     lat: 45.5110, lng: -73.4227, r: 0.03 },
  { slug: 'boucherville',    city: 'Boucherville',      region: 'Montérégie',     lat: 45.5973, lng: -73.4343, r: 0.03 },
  { slug: 'varennes',        city: 'Varennes',          region: 'Montérégie',     lat: 45.6913, lng: -73.4342, r: 0.03 },
  // Lanaudière
  { slug: 'terrebonne',      city: 'Terrebonne',        region: 'Lanaudière',     lat: 45.7000, lng: -73.6471, r: 0.05 },
  { slug: 'repentigny',      city: 'Repentigny',        region: 'Lanaudière',     lat: 45.7422, lng: -73.4500, r: 0.04 },
  { slug: 'mascouche',       city: 'Mascouche',         region: 'Lanaudière',     lat: 45.7480, lng: -73.6021, r: 0.03 },
  { slug: 'lachenaie',       city: 'Lachenaie',         region: 'Lanaudière',     lat: 45.7580, lng: -73.5210, r: 0.02 },
  { slug: 'joliette',        city: 'Joliette',          region: 'Lanaudière',     lat: 46.0209, lng: -73.4398, r: 0.04 },
  { slug: 'rawdon',          city: 'Rawdon',            region: 'Lanaudière',     lat: 46.0475, lng: -73.7169, r: 0.04 },
  { slug: 'saint-charles-borromee', city: 'Saint-Charles-Borromée', region: 'Lanaudière', lat: 46.0441, lng: -73.4664, r: 0.03 },
  // Laurentides
  { slug: 'blainville',      city: 'Blainville',        region: 'Laurentides',    lat: 45.6714, lng: -73.8750, r: 0.04 },
  { slug: 'mirabel',         city: 'Mirabel',           region: 'Laurentides',    lat: 45.6828, lng: -74.0909, r: 0.06 },
  { slug: 'saint-jerome',    city: 'Saint-Jérôme',      region: 'Laurentides',    lat: 45.7804, lng: -74.0036, r: 0.05 },
  { slug: 'sainte-adele',    city: 'Sainte-Adèle',      region: 'Laurentides',    lat: 45.9495, lng: -74.1278, r: 0.04 },
  { slug: 'sainte-anne-des-plaines', city: 'Sainte-Anne-des-Plaines', region: 'Laurentides', lat: 45.7670, lng: -73.8206, r: 0.03 },
  { slug: 'mont-tremblant',  city: 'Mont-Tremblant',    region: 'Laurentides',    lat: 46.1185, lng: -74.5962, r: 0.06 },
  { slug: 'saint-sauveur',   city: 'Saint-Sauveur',     region: 'Laurentides',    lat: 45.8867, lng: -74.1700, r: 0.04 },
  { slug: 'morin-heights',   city: 'Morin-Heights',     region: 'Laurentides',    lat: 45.9021, lng: -74.2812, r: 0.04 },
  { slug: 'sainte-marguerite-du-lac-masson', city: 'Ste-Marguerite-du-Lac-Masson', region: 'Laurentides', lat: 45.9897, lng: -74.1475, r: 0.03 },
];

// Correspondance types Centris → IDs internes ImmoRadar
const TYPE_MAP = {
  'unifamiliale': 'unifamiliale', 'maison': 'unifamiliale',
  'condo': 'condo', 'appartement': 'condo', 'loft': 'condo',
  'plex': 'plex', 'duplex': 'plex', 'triplex': 'plex', 'quadruplex': 'plex', 'quintuplex': 'plex',
  'jumelée': 'maison-ville', 'jumelee': 'maison-ville',
  'de ville': 'maison-ville', 'ville': 'maison-ville',
  'terrain': 'terrain',
  'chalet': 'chalet', 'villégiature': 'chalet', 'villegiature': 'chalet',
  'fermette': 'fermette', 'ferme': 'fermette',
  'intergénération': 'intergeneration', 'intergénérationnel': 'intergeneration',
};
const TYPE_LABELS = {
  unifamiliale: 'Maison unifamiliale', condo: 'Condo / Appartement',
  plex: 'Plex', 'maison-ville': 'Maison de ville', chalet: 'Chalet / Villégiature',
  fermette: 'Fermette', terrain: 'Terrain', intergeneration: 'Intergénération',
};

// ------------------------------------------------------------------ Utilitaires
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function pause() { return sleep(PAUSE_MS + Math.random() * JITTER_MS); }

function jitter(coord, r) {
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * r;
  return +(coord + d * Math.sin(a)).toFixed(5);
}

function cleanText(s) {
  return (s || '').replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePrice(s) {
  const m = (s || '').match(/[\d\s]+/);
  return m ? parseInt(m[0].replace(/\s/g, ''), 10) : 0;
}

function detectType(label) {
  const l = (label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (l.includes(k)) return v;
  }
  return 'unifamiliale';
}

// ------------------------------------------------------------------ Session
/**
 * Visite la page de résultats pour une ville, récupère cookies + token CSRF.
 */
async function getSession(slug) {
  const url = `${BASE}/fr/propriete~a-vendre~${slug}`;
  dbg('GET', url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-CA,fr;q=0.9,en-CA;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`Session HTTP ${res.status} pour /${slug}`);

  const html = await res.text();
  const rawCookies = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') || '').split(/,(?=[^;]+?=)/);
  const cookies = rawCookies.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');

  // Le token CSRF se trouve dans un <input hidden> ou dans une balise meta
  const tokenMatch =
    html.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/) ||
    html.match(/__RequestVerificationToken.*?value="([^"]+)"/);
  const token = tokenMatch?.[1] ?? '';

  // Nombre total d'annonces indiqué sur la page
  const totalMatch = html.match(/(\d[\d\s]*)\s*propriét/i);
  const declaredTotal = totalMatch ? parseInt(totalMatch[1].replace(/\s/g, ''), 10) : null;

  dbg(`Session OK — cookies: ${cookies.length} chars, token: ${token ? '✔' : '✗'}, declared total: ${declaredTotal}`);
  return { cookies, token, declaredTotal };
}

// ------------------------------------------------------------------ Récupération des annonces
/**
 * Appel paginé à l'API interne Centris pour récupérer les cartes HTML.
 */
async function fetchPage(slug, cookies, token, startPosition) {
  const url = `${BASE}/Mvc/Property/GetInscriptions`;
  dbg('POST', url, { startPosition });

  const body = JSON.stringify({
    startPosition,
    maxResults: PAGE_SIZE,
    view: 'Card',
    hasGeoCoding: false,
    property: null,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      '__RequestVerificationToken': token,
      'Cookie': cookies,
      'Referer': `${BASE}/fr/propriete~a-vendre~${slug}`,
      'Origin': BASE,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    body,
  });

  if (!res.ok) throw new Error(`GetInscriptions HTTP ${res.status}`);
  const json = await res.json();
  dbg('GetInscriptions réponse keys:', Object.keys(json));

  // Centris enveloppe le résultat différemment selon la version du site
  const result = json?.d?.Result ?? json?.d ?? json?.Result ?? json;
  return {
    html: result?.html ?? result?.Html ?? '',
    count: result?.count ?? result?.Count ?? 0,
    isLast: result?.isLastPage ?? result?.IsLastPage ?? false,
  };
}

// ------------------------------------------------------------------ Parsing HTML
/**
 * Extrait les données d'une carte HTML de propriété Centris.
 * La structure HTML des cartes est stable depuis plusieurs années.
 */
function parseCard(html, cityMeta) {
  // ---- Identifiant + URL ----
  const linkMatch = html.match(/href="(\/fr\/[^"?]+\?[^"]*udi=([A-Z0-9]+)[^"]*)"/) ||
                    html.match(/href="(\/fr\/[^"?]+\/([\d]+))"/);
  if (!linkMatch) { dbg('Carte sans lien valide'); return null; }
  const sourceId = linkMatch[2] || linkMatch[1].split('/').pop().split('?')[0];
  const url = BASE + linkMatch[1];

  // ---- Prix ----
  const priceMatch = html.match(/class="[^"]*price[^"]*"[^>]*>[\s\S]*?([\d\s]{6,})\s*\$/i) ||
                     html.match(/([\d]{3}[\d\s]*)\s*\$/);
  const price = parsePrice(priceMatch?.[1]);

  // ---- Adresse / ville ----
  const addrMatch = html.match(/class="[^"]*address[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i);
  const address = cleanText(addrMatch?.[1]?.replace(/<[^>]+>/g, ' ') || '');

  const cityMatch = html.match(/class="[^"]*city[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i);
  const city = cleanText(cityMatch?.[1]?.replace(/<[^>]+>/g, ' ') || cityMeta.city);

  // ---- Type ----
  const catMatch = html.match(/class="[^"]*category[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i);
  const typeRaw = cleanText(catMatch?.[1]?.replace(/<[^>]+>/g, '') || '');
  const type = detectType(typeRaw);

  // ---- Chambres / salles de bain ----
  const bedsMatch = html.match(/(\d+)\s*(?:ch(?:ambre)?s?|bd|bedroom)/i);
  const bathsMatch = html.match(/(\d+)\s*(?:s(?:alle)?\.?\s*(?:de\s*bain|bain|eau)|ba(?:th)?)/i);
  const bedrooms = bedsMatch ? +bedsMatch[1] : 0;
  const bathrooms = bathsMatch ? +bathsMatch[1] : 0;

  // ---- Superficie ----
  const areaMatch = html.match(/([\d\s]+)\s*pi²/i) || html.match(/([\d\s]+)\s*sq\s*ft/i);
  const livingAreaSqft = areaMatch ? parseInt(areaMatch[1].replace(/\s/g, ''), 10) : 0;

  // ---- Photos ----
  const photoMatches = [...html.matchAll(/src="(https:\/\/mspublic\.centris\.ca\/media\.ashx[^"]+)"/g)];
  // Première photo en haute résolution
  const photoUrl = photoMatches.length
    ? photoMatches[0][1].replace(/&w=\d+/, '&w=750').replace(/&h=\d+/, '&h=500')
    : null;
  // Toutes les URLs pour la galerie
  const photos = photoMatches.map((m) =>
    m[1].replace(/&w=\d+/, '&w=750').replace(/&h=\d+/, '&h=500'));

  // ---- Coordonnées (approximatives, centrées sur la ville) ----
  const lat = jitter(cityMeta.lat, cityMeta.r);
  const lng = jitter(cityMeta.lng, cityMeta.r * 1.4);

  // ---- Date ----
  const dateMatch = html.match(/(\d{4}-\d{2}-\d{2})/);
  const publishedAt = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10);

  // ---- Caractéristiques ----
  const lower = html.toLowerCase();
  const features = {
    garage: /garage/.test(lower),
    parkingSpots: +(html.match(/(\d+)\s*stationn/i)?.[1] ?? 0),
    pool: /piscine/.test(lower),
    waterfront: /bord.{0,5}(?:eau|lac|fleuve|rivière)/.test(lower),
    waterAccess: /acc[eè]s.{0,10}(?:eau|lac)/.test(lower),
    fireplace: /foyer|po[eê]le/.test(lower),
    elevator: /ascenseur/.test(lower),
    accessible: /adapt[eé]/.test(lower),
    centralAir: /climatisation centrale|trane|carrier/.test(lower),
  };

  if (!price || price < 10000) { dbg(`Carte ignorée (prix invalide: ${price})`); return null; }

  return {
    source: 'centris',
    sourceId,
    url,
    address: address || `Propriété ${sourceId}`,
    city,
    district: '',
    region: cityMeta.region,
    lat, lng,
    price, type,
    typeLabel: typeRaw || TYPE_LABELS[type] || 'Propriété',
    bedrooms, bathrooms,
    powderRooms: 0, rooms: 0, levels: 1,
    livingAreaSqft, lotAreaSqm: 0,
    yearBuilt: 0, units: 0, revenue: 0,
    features,
    photoUrl,
    photos,
    photoCount: photos.length || (photoUrl ? 1 : 0),
    openHouse: /visite libre/i.test(html),
    repossession: /reprise|saisi/i.test(html),
    newConstruction: /neuf|construction neuve|nouveau projet/i.test(html),
    publishedAt,
    description: '',
  };
}

// ------------------------------------------------------------------ Connecteur principal
async function fetchCity(cityMeta) {
  log(`\n📍 ${cityMeta.city} (${cityMeta.region})`);
  const listings = [];
  let totalFetched = 0;
  let session;

  try {
    session = await getSession(cityMeta.slug);
    if (session.declaredTotal !== null) log(`   ${session.declaredTotal} annonces déclarées`);
  } catch (err) {
    log(`   ✗ Session échouée : ${err.message}`);
    return listings;
  }

  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    try {
      const { html, count, isLast } = await fetchPage(cityMeta.slug, session.cookies, session.token, start);

      if (!html) { log(`   ✗ Page ${page + 1} vide`); break; }

      // Les cartes sont encapsulées dans des <article> ou <div class="property-thumbnail">
      const cards = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)]
        .concat([...html.matchAll(/<div[^>]+class="[^"]*property-thumbnail[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)]);

      let pageHits = 0;
      for (const card of cards) {
        const listing = parseCard(card[0], cityMeta);
        if (listing) { listings.push(listing); pageHits++; }
      }

      totalFetched += pageHits;
      log(`   Page ${page + 1} : +${pageHits} annonces (total ville: ${totalFetched})`);

      if (isLast || pageHits === 0 || (count > 0 && totalFetched >= count)) break;
      await pause();
    } catch (err) {
      log(`   ✗ Erreur page ${page + 1} : ${err.message}`);
      if (DEBUG) console.error(err);
      break;
    }
  }

  log(`   ✔ ${listings.length} annonces récupérées`);
  return listings;
}

// ------------------------------------------------------------------ Déduplication légère
// Même logique que le frontend : fusionne par (adresse normalisée + ville)
function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function dedupeSources(raw) {
  const map = new Map();
  for (const l of raw) {
    const key = `${normalize(l.address)}|${normalize(l.city)}`;
    if (!map.has(key)) {
      const { source, sourceId, url, photos, photoUrl, ...rest } = l;
      map.set(key, { ...rest, sources: [{ source, sourceId, url, price: l.price }], photos: photos || [], photoUrl });
    } else {
      const m = map.get(key);
      m.sources.push({ source: l.source, sourceId: l.sourceId, url: l.url, price: l.price });
      m.price = Math.min(m.price, l.price);
      if (l.photos?.length && !m.photos.length) m.photos = l.photos;
      if (l.photoUrl && !m.photoUrl) m.photoUrl = l.photoUrl;
    }
  }
  return [...map.values()];
}

// ------------------------------------------------------------------ Main
async function main() {
  log('🏠 ImmoRadar — Connecteur Centris');
  log(`   Villes : ${CITIES.length} | Max pages par ville : ${MAX_PAGES}`);

  const allRaw = [];
  for (const city of CITIES) {
    const results = await fetchCity(city);
    allRaw.push(...results);
    if (CITIES.indexOf(city) < CITIES.length - 1) await pause();
  }

  log(`\n📊 Total brut : ${allRaw.length} annonces`);
  const merged = dedupeSources(allRaw);
  log(`📊 Après fusion : ${merged.length} propriétés`);

  // Conserver les annonces non-Centris d'un fetch précédent (DuProprio, Ubee, démo)
  let previous = [];
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, 'utf-8'));
      previous = (prev.listings || []).filter((l) => l.source !== 'centris' && !l.sources?.every?.((s) => s.source === 'centris'));
      log(`📦 Annonces conservées d'autres sources : ${previous.length}`);
    } catch { /* ignore */ }
  }

  const final = [...merged, ...previous];
  const output = {
    generatedAt: new Date().toISOString(),
    sourceStats: {
      centris: merged.length,
      other: previous.length,
      total: final.length,
    },
    listings: final,
  };

  writeFileSync(OUT, JSON.stringify(output, null, 1));
  log(`\n✅ Fichier mis à jour : ${OUT}`);
  log(`   ${final.length} propriétés au total`);
}

main().catch((err) => { console.error('Erreur fatale:', err); process.exit(1); });
