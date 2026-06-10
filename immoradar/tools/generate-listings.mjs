#!/usr/bin/env node
/**
 * Générateur de données de démonstration pour ImmoRadar Québec.
 * Produit data/listings.json : une liste d'annonces "brutes" par source
 * (centris / duproprio / ubee), avec ~15 % de propriétés listées sur
 * plusieurs plateformes afin de tester la déduplication côté client.
 *
 * Usage : node tools/generate-listings.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'listings.json');

// ---------------------------------------------------------------- RNG seedé
let seed = 20260610;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const ri = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// ---------------------------------------------------------------- Géographie
const CITIES = [
  { name: 'Montréal', region: 'Montréal', lat: 45.5089, lng: -73.5617, r: 0.09, mult: 1.45, w: 18,
    hoods: ['Rosemont', 'Villeray', 'Hochelaga-Maisonneuve', 'Le Plateau-Mont-Royal', 'Ahuntsic', 'Verdun', 'LaSalle', 'Mercier', 'Côte-des-Neiges'] },
  { name: 'Laval', region: 'Laval', lat: 45.6066, lng: -73.7124, r: 0.07, mult: 1.15, w: 8,
    hoods: ['Chomedey', 'Sainte-Rose', 'Vimont', 'Duvernay', 'Fabreville'] },
  { name: 'Longueuil', region: 'Montérégie', lat: 45.5312, lng: -73.5181, r: 0.05, mult: 1.05, w: 6,
    hoods: ['Le Vieux-Longueuil', 'Saint-Hubert', 'Greenfield Park'] },
  { name: 'Brossard', region: 'Montérégie', lat: 45.4583, lng: -73.4659, r: 0.04, mult: 1.2, w: 5, hoods: [] },
  { name: 'Terrebonne', region: 'Lanaudière', lat: 45.7, lng: -73.6471, r: 0.05, mult: 1.0, w: 5,
    hoods: ['Lachenaie', 'La Plaine'] },
  { name: 'Repentigny', region: 'Lanaudière', lat: 45.7422, lng: -73.45, r: 0.04, mult: 0.95, w: 4, hoods: [] },
  { name: 'Québec', region: 'Capitale-Nationale', lat: 46.8139, lng: -71.208, r: 0.08, mult: 0.95, w: 12,
    hoods: ['Limoilou', 'Sainte-Foy', 'Beauport', 'Charlesbourg', 'Montcalm'] },
  { name: 'Lévis', region: 'Chaudière-Appalaches', lat: 46.7382, lng: -71.2465, r: 0.06, mult: 0.85, w: 5,
    hoods: ['Saint-Romuald', 'Charny'] },
  { name: 'Gatineau', region: 'Outaouais', lat: 45.4765, lng: -75.7013, r: 0.07, mult: 0.9, w: 7,
    hoods: ['Hull', 'Aylmer', 'Buckingham'] },
  { name: 'Sherbrooke', region: 'Estrie', lat: 45.4042, lng: -71.8929, r: 0.06, mult: 0.75, w: 6,
    hoods: ['Fleurimont', 'Rock Forest', 'Jacques-Cartier'] },
  { name: 'Trois-Rivières', region: 'Mauricie', lat: 46.3432, lng: -72.543, r: 0.05, mult: 0.7, w: 5,
    hoods: ['Cap-de-la-Madeleine', 'Trois-Rivières-Ouest'] },
  { name: 'Saint-Jérôme', region: 'Laurentides', lat: 45.7804, lng: -74.0036, r: 0.04, mult: 0.85, w: 4, hoods: [] },
  { name: 'Drummondville', region: 'Centre-du-Québec', lat: 45.8833, lng: -72.4833, r: 0.04, mult: 0.65, w: 4, hoods: [] },
  { name: 'Granby', region: 'Montérégie', lat: 45.4, lng: -72.7333, r: 0.04, mult: 0.7, w: 3, hoods: [] },
  { name: 'Mont-Tremblant', region: 'Laurentides', lat: 46.1185, lng: -74.5962, r: 0.06, mult: 1.1, w: 3, hoods: [], chalet: true },
  { name: 'Magog', region: 'Estrie', lat: 45.2667, lng: -72.15, r: 0.05, mult: 0.9, w: 3, hoods: [], chalet: true },
  { name: 'Saint-Sauveur', region: 'Laurentides', lat: 45.8867, lng: -74.17, r: 0.04, mult: 1.0, w: 2, hoods: [], chalet: true },
  { name: 'Rimouski', region: 'Bas-Saint-Laurent', lat: 48.4489, lng: -68.5236, r: 0.04, mult: 0.55, w: 2, hoods: [] },
  { name: 'Saguenay', region: 'Saguenay–Lac-Saint-Jean', lat: 48.4279, lng: -71.0686, r: 0.06, mult: 0.55, w: 3,
    hoods: ['Chicoutimi', 'Jonquière', 'La Baie'] },
];

const STREETS = [
  'rue des Érables', 'rue Principale', 'avenue du Parc', 'boulevard des Pins',
  'rue Saint-Charles', 'rue de la Falaise', 'avenue Cartier', 'rue des Bouleaux',
  'rue Notre-Dame', 'chemin du Lac', 'rue des Cèdres', 'avenue Royale',
  'rue de l’Église', 'rue des Pivoines', 'boulevard de la Rive',
  'rue du Domaine', 'rue des Mésanges', 'avenue des Tilleuls', 'rue Bellevue',
  'rue du Coteau', 'croissant des Sources', 'rue de la Montagne',
  'rue des Lilas', 'rue Papineau', 'avenue Laurier', 'rue Sainte-Famille',
  'rue du Verger', 'chemin des Patriotes', 'rue de la Sucrerie', 'rue Hochelaga',
];

// type, poids, prix de base, plages
const TYPES = [
  { id: 'unifamiliale', label: 'Maison unifamiliale', w: 38, base: 475000, bedMin: 2, bedMax: 5, bathMax: 3, areaMin: 950, areaMax: 2800, lotMin: 300, lotMax: 1200 },
  { id: 'condo', label: 'Condo / Appartement', w: 24, base: 365000, bedMin: 1, bedMax: 3, bathMax: 2, areaMin: 550, areaMax: 1400, lotMin: 0, lotMax: 0 },
  { id: 'plex', label: 'Plex (2 à 5 logements)', w: 13, base: 720000, bedMin: 4, bedMax: 9, bathMax: 4, areaMin: 1600, areaMax: 4200, lotMin: 250, lotMax: 700 },
  { id: 'maison-ville', label: 'Maison de ville', w: 8, base: 430000, bedMin: 2, bedMax: 4, bathMax: 3, areaMin: 1100, areaMax: 1900, lotMin: 120, lotMax: 350 },
  { id: 'chalet', label: 'Chalet / Maison de villégiature', w: 8, base: 420000, bedMin: 1, bedMax: 4, bathMax: 2, areaMin: 650, areaMax: 1800, lotMin: 800, lotMax: 8000 },
  { id: 'fermette', label: 'Fermette', w: 3, base: 590000, bedMin: 2, bedMax: 5, bathMax: 3, areaMin: 1200, areaMax: 2600, lotMin: 10000, lotMax: 200000 },
  { id: 'terrain', label: 'Terrain', w: 4, base: 145000, bedMin: 0, bedMax: 0, bathMax: 0, areaMin: 0, areaMax: 0, lotMin: 500, lotMax: 50000 },
  { id: 'intergeneration', label: 'Maison intergénération', w: 2, base: 610000, bedMin: 3, bedMax: 6, bathMax: 4, areaMin: 1800, areaMax: 3200, lotMin: 400, lotMax: 1500 },
];

const DESC_INTRO = [
  'Magnifique propriété lumineuse située dans un secteur recherché.',
  'Coup de cœur assuré ! Propriété impeccable et clé en main.',
  'Rare sur le marché : emplacement de choix à proximité de tous les services.',
  'Belle opportunité pour premier acheteur ou investisseur.',
  'Propriété chaleureuse rénovée avec goût au fil des années.',
  'Vaste propriété offrant de beaux volumes et une fenestration abondante.',
];
const DESC_DETAIL = [
  'Cuisine rénovée avec îlot et comptoirs de quartz.',
  'Planchers de bois franc, plafonds de 9 pieds.',
  'Sous-sol entièrement aménagé avec salle familiale.',
  'Cour intime sans voisin arrière, grande terrasse.',
  'À distance de marche des écoles, parcs et transports en commun.',
  'Toiture refaite récemment, fenêtres remplacées.',
  'Grand garage isolé et stationnement pour plusieurs véhicules.',
  'Salle de bain principale avec douche en céramique et bain autoportant.',
];

function weighted(items) {
  const total = items.reduce((s, it) => s + it.w, 0);
  let n = rand() * total;
  for (const it of items) { n -= it.w; if (n <= 0) return it; }
  return items[items.length - 1];
}

const TODAY = new Date('2026-06-10T12:00:00-04:00');

function makeProperty(i) {
  const city = weighted(CITIES);
  let type = weighted(TYPES);
  if (city.chalet && chance(0.6)) type = TYPES.find((t) => t.id === 'chalet');

  const angle = rand() * Math.PI * 2;
  const dist = Math.sqrt(rand()) * city.r;
  const lat = +(city.lat + Math.sin(angle) * dist).toFixed(5);
  const lng = +(city.lng + Math.cos(angle) * dist * 1.4).toFixed(5);

  const bedrooms = type.bedMax ? ri(type.bedMin, type.bedMax) : 0;
  const bathrooms = type.bathMax ? ri(1, type.bathMax) : 0;
  const powderRooms = type.bathMax ? (chance(0.4) ? 1 : 0) : 0;
  const livingAreaSqft = type.areaMax ? ri(type.areaMin, type.areaMax) : 0;
  const lotAreaSqm = type.lotMax ? ri(type.lotMin, type.lotMax) : 0;
  const yearBuilt = type.id === 'terrain' ? 0 : ri(1900, 2026);

  let price = type.base * city.mult;
  price *= 0.75 + rand() * 0.7;
  if (livingAreaSqft) price *= 0.7 + (livingAreaSqft / type.areaMax) * 0.6;
  const waterfront = (type.id === 'chalet' && chance(0.45)) || chance(0.04);
  if (waterfront) price *= 1.35;
  price = Math.round(price / 1000) * 1000;

  const units = type.id === 'plex' ? ri(2, 5) : 0;
  const revenue = units ? units * ri(9500, 16500) : 0;

  const daysOnMarket = ri(0, 90);
  const publishedAt = new Date(TODAY.getTime() - daysOnMarket * 86400000)
    .toISOString().slice(0, 10);

  const hood = city.hoods.length && chance(0.8) ? pick(city.hoods) : '';

  return {
    propertyId: `P${String(i).padStart(4, '0')}`,
    address: `${ri(10, 9850)}, ${pick(STREETS)}`,
    city: city.name,
    district: hood,
    region: city.region,
    lat, lng,
    price,
    type: type.id,
    typeLabel: type.label,
    bedrooms, bathrooms, powderRooms,
    rooms: bedrooms ? bedrooms + bathrooms + ri(2, 5) : 0,
    levels: type.id === 'condo' || type.id === 'terrain' ? 1 : ri(1, 3),
    livingAreaSqft, lotAreaSqm, yearBuilt,
    units, revenue,
    features: {
      garage: type.id !== 'terrain' && chance(0.38),
      parkingSpots: type.id === 'terrain' ? 0 : ri(0, 4),
      pool: type.id !== 'terrain' && type.id !== 'condo' && chance(0.18),
      waterfront,
      waterAccess: waterfront || chance(0.06),
      fireplace: type.id !== 'terrain' && chance(0.3),
      elevator: type.id === 'condo' && chance(0.4),
      accessible: chance(0.06),
      centralAir: type.id !== 'terrain' && chance(0.35),
    },
    openHouse: chance(0.12),
    repossession: chance(0.025),
    newConstruction: yearBuilt >= 2025,
    publishedAt,
    description: `${pick(DESC_INTRO)} ${pick(DESC_DETAIL)} ${pick(DESC_DETAIL)}`,
    photoCount: ri(8, 40),
  };
}

function sourceListing(prop, source, n) {
  const id = `${source.toUpperCase().slice(0, 2)}${ri(10000000, 99999999)}`;
  const slugCity = prop.city.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
  const urls = {
    centris: `https://www.centris.ca/fr/propriete~a-vendre~${slugCity}/${id}`,
    duproprio: `https://duproprio.com/fr/${slugCity}/propriete-${id}`,
    ubee: `https://ubee.ca/fr/propriete/${slugCity}/${id}`,
  };
  // léger écart de prix entre plateformes pour rendre la fusion intéressante
  const price = n === 0 ? prop.price : prop.price + pick([-5000, 0, 0, 5000]);
  return { ...prop, source, sourceId: id, url: urls[source], price };
}

const SOURCES = ['centris', 'duproprio', 'ubee'];
const listings = [];
const N = 360;
for (let i = 1; i <= N; i++) {
  const prop = makeProperty(i);
  // DuProprio = sans courtier ; Centris = courtiers ; Ubee = mixte
  const primary = pick(['centris', 'centris', 'centris', 'duproprio', 'duproprio', 'ubee']);
  listings.push(sourceListing(prop, primary, 0));
  if (chance(0.16)) {
    const second = pick(SOURCES.filter((s) => s !== primary));
    listings.push(sourceListing(prop, second, 1));
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedAt: TODAY.toISOString(), listings }, null, 1));
console.log(`OK — ${listings.length} annonces (sources) pour ${N} propriétés → ${OUT}`);
