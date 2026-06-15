/* =====================================================================
 * ImmoRadar Québec -- moteur de recherche immobilier multi-sources
 * Données de démonstration ; architecture prête pour de vrais connecteurs.
 * ===================================================================== */
'use strict';

// ------------------------------------------------------------------ Constantes
const SOURCE_LABELS = { centris: 'Centris', duproprio: 'DuProprio', ubee: 'Ubee' };
const TYPE_EMOJI = {
  unifamiliale: '🏠', condo: '🏢', plex: '🏘️', 'maison-ville': '🏡',
  chalet: '🌲', fermette: '🚜', terrain: '🌳', intergeneration: '👨‍👩‍👧',
};
const NEW_DAYS = 7; // une annonce est « nouvelle » pendant 7 jours
const LS_KEYS = { fav: 'immoradar.favorites', searches: 'immoradar.savedSearches' };

// ------------------------------------------------------------------ État global
const state = {
  merged: [],          // annonces fusionnées (1 par propriété)
  shapes: [],          // couches Leaflet tracées par l'utilisateur
  favorites: new Set(JSON.parse(localStorage.getItem(LS_KEYS.fav) || '[]')),
  savedSearches: JSON.parse(localStorage.getItem(LS_KEYS.searches) || '[]'),
  favoritesOnly: false,
  sort: 'recent',
  today: new Date(),
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ------------------------------------------------------------------ Utilitaires
const fmtPrice = (n) => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const fmtNum = (n) => n.toLocaleString('fr-CA');

// La date de mise en vente n'est pas fournie sur les fiches de résultats
// Centris. daysOnMarket renvoie null quand on ne la connaît pas.
function daysOnMarket(l) {
  if (!l.publishedAt) return null;
  const d = Math.floor((state.today - new Date(l.publishedAt + 'T12:00:00')) / 86400000);
  return d < 0 ? 0 : d;
}
function isNew(l) {
  const d = daysOnMarket(l);
  return d !== null && d <= NEW_DAYS;
}

// Couleur de pseudo-photo déterministe à partir de l'identifiant
function heroStyle(l) {
  let h = 0;
  for (const c of l.id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `background: linear-gradient(135deg, hsl(${h},45%,45%), hsl(${(h + 50) % 360},50%,32%))`;
}

// ------------------------------------------------------------------ Déduplication
// Fusionne les annonces provenant de plusieurs plateformes pour une même
// propriété (clé = adresse normalisée + ville). C'est le même pipeline qui
// servira quand de vrais connecteurs Centris/DuProprio/Ubee seront branchés.
function normalizeAddress(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function dedupe(rawListings) {
  const byKey = new Map();
  for (const raw of rawListings) {
    const key = `${normalizeAddress(raw.address)}|${normalizeAddress(raw.city)}`;
    const src = { source: raw.source, sourceId: raw.sourceId, url: raw.url, price: raw.price };
    if (byKey.has(key)) {
      const m = byKey.get(key);
      m.sources.push(src);
      m.price = Math.min(m.price, raw.price); // on affiche le meilleur prix
      if (raw.publishedAt < m.publishedAt) m.publishedAt = raw.publishedAt;
    } else {
      const { source, sourceId, url, ...prop } = raw;
      // Le JSON est minifié et n'inclut plus le tableau `photos` ni
      // `description` : on les reconstruit pour le reste de l'interface.
      if (!prop.photos) prop.photos = prop.photoUrl ? [prop.photoUrl] : [];
      if (prop.description == null) prop.description = '';
      byKey.set(key, { ...prop, id: key, sources: [src] });
    }
  }
  return Array.from(byKey.values());
}

// ------------------------------------------------------------------ Carte
let map, cluster, drawnGroup;
const markerById = new Map();

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([46.3, -72.6], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);

  cluster = L.markerClusterGroup({ maxClusterRadius: 46, showCoverageOnHover: false });
  map.addLayer(cluster);

  drawnGroup = new L.FeatureGroup();
  map.addLayer(drawnGroup);

  localizeDraw();
  const drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: { color: '#e8552f', weight: 3, fillOpacity: 0.08 },
      },
      rectangle: { shapeOptions: { color: '#e8552f', weight: 3, fillOpacity: 0.08 } },
      circle: { shapeOptions: { color: '#e8552f', weight: 3, fillOpacity: 0.08 } },
      polyline: false, marker: false, circlemarker: false,
    },
    edit: { featureGroup: drawnGroup },
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    drawnGroup.addLayer(e.layer);
    state.shapes.push(e.layer);
    refresh();
  });
  map.on(L.Draw.Event.EDITED, refresh);
  map.on(L.Draw.Event.DELETED, (e) => {
    e.layers.eachLayer((layer) => {
      state.shapes = state.shapes.filter((s) => s !== layer);
    });
    refresh();
  });
}

// Interface Leaflet.draw en français
function localizeDraw() {
  const d = L.drawLocal;
  d.draw.toolbar.buttons.polygon = 'Tracer un secteur (polygone)';
  d.draw.toolbar.buttons.rectangle = 'Tracer un secteur (rectangle)';
  d.draw.toolbar.buttons.circle = 'Tracer un secteur (cercle)';
  d.draw.toolbar.actions = { title: 'Annuler le tracé', text: 'Annuler' };
  d.draw.toolbar.finish = { title: 'Terminer le tracé', text: 'Terminer' };
  d.draw.toolbar.undo = { title: 'Supprimer le dernier point', text: 'Supprimer le dernier point' };
  d.draw.handlers.polygon.tooltip = {
    start: 'Cliquez pour commencer à tracer votre secteur.',
    cont: 'Cliquez pour continuer le tracé.',
    end: 'Cliquez sur le premier point pour fermer le secteur.',
  };
  d.draw.handlers.rectangle.tooltip = { start: 'Cliquez-glissez pour tracer un rectangle.' };
  d.draw.handlers.circle.tooltip = { start: 'Cliquez-glissez pour tracer un cercle.' };
  d.draw.handlers.simpleshape.tooltip = { end: 'Relâchez pour terminer.' };
  d.edit.toolbar.buttons = {
    edit: 'Modifier les secteurs', editDisabled: 'Aucun secteur à modifier',
    remove: 'Supprimer des secteurs', removeDisabled: 'Aucun secteur à supprimer',
  };
  d.edit.toolbar.actions = {
    save: { title: 'Enregistrer', text: 'Enregistrer' },
    cancel: { title: 'Annuler', text: 'Annuler' },
    clearAll: { title: 'Tout effacer', text: 'Tout effacer' },
  };
  d.edit.handlers.edit.tooltip = { text: 'Déplacez les poignées pour modifier le secteur.', subtext: null };
  d.edit.handlers.remove.tooltip = { text: 'Cliquez sur un secteur pour le supprimer.' };
}

// Une annonce est-elle dans au moins un des secteurs tracés ?
function inShapes(l, shapes) {
  if (!shapes.length) return true;
  const pt = turf.point([l.lng, l.lat]);
  return shapes.some((layer) => {
    if (layer instanceof L.Circle) {
      return map.distance(layer.getLatLng(), [l.lat, l.lng]) <= layer.getRadius();
    }
    return turf.booleanPointInPolygon(pt, layer.toGeoJSON());
  });
}

// ------------------------------------------------------------------ Filtres
function readFilters() {
  const checked = (sel) => $$(sel + ' input:checked').map((i) => i.value);
  return {
    keyword: $('#f-keyword').value.trim().toLowerCase(),
    sources: checked('#f-sources'),
    types: checked('#f-types'),
    priceMin: +$('#f-price-min').value || 0,
    priceMax: +$('#f-price-max').value || Infinity,
    bedsMin: +$('#f-beds .on').dataset.v,
    bathsMin: +$('#f-baths .on').dataset.v,
    areaMin: +$('#f-area-min').value || 0,
    lotMin: +$('#f-lot-min').value || 0,
    yearMin: +$('#f-year-min').value || 0,
    yearMax: +$('#f-year-max').value || Infinity,
    features: checked('#f-features'),
    extras: checked('#f-extras'),
    revenueMin: +$('#f-revenue-min').value || 0,
    domMax: +$('#f-dom').value || Infinity,
  };
}

function matches(l, f, shapes) {
  if (!l.sources.some((s) => f.sources.includes(s.source))) return false;
  if (f.types.length && !f.types.includes(l.type)) return false;
  if (l.price < f.priceMin || l.price > f.priceMax) return false;
  if (f.bedsMin && l.bedrooms < f.bedsMin) return false;
  if (f.bathsMin && l.bathrooms < f.bathsMin) return false;
  if (f.areaMin && l.livingAreaSqft < f.areaMin) return false;
  if (f.lotMin && l.lotAreaSqm < f.lotMin) return false;
  if (f.yearMin && (!l.yearBuilt || l.yearBuilt < f.yearMin)) return false;
  if (f.yearMax !== Infinity && l.yearBuilt > f.yearMax) return false;
  if (f.revenueMin && l.revenue < f.revenueMin) return false;
  if (f.domMax !== Infinity) { const d = daysOnMarket(l); if (d === null || d > f.domMax) return false; }

  for (const feat of f.features) {
    if (feat === 'parking') { if (!l.features.parkingSpots) return false; }
    else if (!l.features[feat]) return false;
  }
  for (const ex of f.extras) {
    if (ex === 'multiSource') { if (l.sources.length < 2) return false; }
    else if (!l[ex]) return false;
  }

  if (f.keyword) {
    const hay = `${l.address} ${l.city} ${l.district} ${l.region} ${l.typeLabel} ${l.description}`.toLowerCase();
    if (!hay.includes(f.keyword)) return false;
  }

  if (state.favoritesOnly && !state.favorites.has(l.id)) return false;
  return inShapes(l, shapes);
}

// Proxy de récence : le numéro MLS croît avec le temps (les annonces récentes
// ont un numéro plus élevé). Sert de tri « plus récentes » faute de vraie date.
function mlsRank(l) {
  let max = 0;
  for (const src of l.sources || []) { const n = parseInt(src.sourceId, 10) || 0; if (n > max) max = n; }
  return max;
}
function applySort(list) {
  const s = [...list];
  switch (state.sort) {
    case 'price-asc': s.sort((a, b) => a.price - b.price); break;
    case 'price-desc': s.sort((a, b) => b.price - a.price); break;
    case 'area-desc': s.sort((a, b) => b.livingAreaSqft - a.livingAreaSqft); break;
    case 'lot-desc': s.sort((a, b) => b.lotAreaSqm - a.lotAreaSqm); break;
    default: s.sort((a, b) => {
      // vraie date si dispo, sinon proxy MLS décroissant (mélange les villes)
      if (a.publishedAt && b.publishedAt && a.publishedAt !== b.publishedAt) {
        return b.publishedAt.localeCompare(a.publishedAt);
      }
      return mlsRank(b) - mlsRank(a);
    });
  }
  return s;
}

// ------------------------------------------------------------------ Rendu
function refresh() {
  const f = readFilters();
  const visible = applySort(state.merged.filter((l) => matches(l, f, state.shapes)));
  renderCount(visible.length);
  renderCards(visible);
  renderMarkers(visible);
  renderZoneChip();
}

function renderCount(n) {
  $('#result-count').textContent = n === 1 ? '1 propriété' : `${fmtNum(n)} propriétés`;
}

function renderZoneChip() {
  const chip = $('#zone-indicator');
  chip.hidden = state.shapes.length === 0;
  $('#zone-count').textContent = state.shapes.length;
}

function specLine(l) {
  const parts = [];
  if (l.bedrooms) parts.push(`🛏 ${l.bedrooms} ch.`);
  if (l.bathrooms) parts.push(`🛁 ${l.bathrooms} sdb${l.powderRooms ? ' + ' + l.powderRooms + " s.eau" : ''}`);
  if (l.livingAreaSqft) parts.push(`📐 ${fmtNum(l.livingAreaSqft)} pi²`);
  if (l.lotAreaSqm) parts.push(`🌿 ${fmtNum(l.lotAreaSqm)} m²`);
  if (l.units) parts.push(`🏘 ${l.units} logements`);
  return parts.join('  ');
}

function sourceBadges(l) {
  return l.sources.map((s) => `<span class="src src-${s.source}">${SOURCE_LABELS[s.source]}</span>`).join('');
}

function cardPhoto(l) {
  var cnt = l.photosAvailable || l.photoCount;
  var thumb = cnt > 1 ? ["<span class=\"photo-count\">", cnt, "</span>"].join("") : "";
  if (l.photoUrl) {
    return ["<div class=\"card-photo card-photo--real\">",
      "<img src=\"", l.photoUrl, "\" alt=\"photo\" loading=\"lazy\"",
      " onerror=\"this.closest('.card-photo').classList.add('card-photo--fallback');this.remove();\" />",
      thumb, "</div>"].join("");
  }
  return ["<div class=\"card-photo\" style=\"", heroStyle(l), "\">",
    TYPE_EMOJI[l.type] || "\u{1F3E0}", cnt ? thumb : "", "</div>"].join("");
}
const CARD_LIMIT = 300;   // la liste ne rend que les N premières (perf) ; la carte garde tout
function renderCards(list) {
  const wrap = $('#cards');
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">Aucune propriété ne correspond à vos critères.<br>
      Élargissez vos filtres ou modifiez votre secteur tracé. 🗺️</div>`;
    return;
  }
  const shown = list.slice(0, CARD_LIMIT);
  const more = list.length - shown.length;
  wrap.innerHTML = (more > 0
      ? `<div class="more-note">Affichage des ${CARD_LIMIT} premières sur ${fmtNum(list.length)}. Affinez vos filtres ou tracez un secteur plus précis pour les voir toutes. La carte, elle, affiche tout.</div>`
      : '')
    + shown.map((l) => `
    <article class="card" data-id="${l.id}">
      ${cardPhoto(l)}
      <div class="card-body">
        <div class="card-price">${fmtPrice(l.price)}${l.revenue ? ` <span class="card-sub">· revenus ${fmtPrice(l.revenue)}/an</span>` : ''}</div>
        <div class="card-title">${l.typeLabel}</div>
        <div class="card-sub">${l.address}, ${l.district ? l.district + ', ' : ''}${l.city}</div>
        <div class="card-specs">${specLine(l)}</div>
        <div class="card-badges">
          ${sourceBadges(l)}
          ${l.sources.length > 1 ? '<span class="badge-multi">2 plateformes</span>' : ''}
          ${isNew(l) ? '<span class="badge-new">NOUVEAU</span>' : ''}
          ${l.openHouse ? '<span class="badge-soft">Visite libre</span>' : ''}
          ${l.repossession ? '<span class="badge-soft">Reprise</span>' : ''}
          ${l.features.waterfront ? '<span class="badge-soft">Bord de l\'eau</span>' : ''}
          ${daysOnMarket(l) > 0 ? `<span class="badge-soft">sur le radar depuis ${daysOnMarket(l)} j</span>` : ''}
        </div>
      </div>
      <button class="fav-btn ${state.favorites.has(l.id) ? 'on' : ''}" data-fav="${l.id}" title="Ajouter aux favoris">
        ${state.favorites.has(l.id) ? '❤️' : '🤍'}
      </button>
    </article>`).join('');
}

function renderMarkers(list) {
  cluster.clearLayers();
  markerById.clear();
  for (const l of list) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="price-marker ${state.favorites.has(l.id) ? 'fav' : ''}">${Math.round(l.price / 1000)} k$</div>`,
      iconSize: null,
    });
    const m = L.marker([l.lat, l.lng], { icon });
    m.bindPopup(`
      <b>${fmtPrice(l.price)}</b> -- ${l.typeLabel}<br>
      ${l.address}, ${l.city}<br>
      ${specLine(l)}<br>
      <span class="popup-link" data-open="${l.id}">Voir la fiche complète →</span>`);
    markerById.set(l.id, m);
    cluster.addLayer(m);
  }
}

// ------------------------------------------------------------------ Fiche détaillée
function openListing(id) {
  const l = state.merged.find((x) => x.id === id);
  if (!l) return;
  state._openListing = l;
  galleryPhotos = l.photos ?? [];
  galleryIndex = 0;
  const F = l.features;
  const tags = [
    F.garage && 'Garage', F.parkingSpots && `${F.parkingSpots} stationnement(s)`,
    F.pool && 'Piscine', F.waterfront && "Bord de l\'eau", F.waterAccess && "Accès à l\'eau",
    F.fireplace && 'Foyer / poêle', F.elevator && 'Ascenseur',
    F.accessible && 'Adapté mobilité réduite', F.centralAir && 'Climatisation centrale',
    l.openHouse && 'Visite libre', l.repossession && 'Reprise bancaire',
    l.newConstruction && 'Construction neuve',
  ].filter(Boolean);

  // Galerie de photos
  const photos = l.photos?.length ? l.photos : (l.photoUrl ? [l.photoUrl] : []);
  const galleryHtml = photos.length
    ? `<div class="gallery">
        <div class="gallery-main">
          <img id="gallery-img" src="${photos[0]}" alt="${l.typeLabel} à ${l.city}" />
          ${photos.length > 1 ? `<button class="gallery-prev" onclick="galleryNav(-1)">‹</button><button class="gallery-next" onclick="galleryNav(1)">›</button>` : ''}
        </div>
        ${photos.length > 1 ? `<div class="gallery-thumbs">${photos.slice(0, 8).map((p, i) => `<img src="${p}" class="${i === 0 ? 'active' : ''}" onclick="gallerySet(${i})" />`).join('')}</div>` : ''}
        <p class="muted" style="margin:4px 0 0;font-size:11px">${l.photosAvailable && l.photosAvailable > photos.length ? `Photo de couverture — voir les ${l.photosAvailable} photos sur l'annonce d'origine ↓` : `${photos.length} photo${photos.length > 1 ? 's' : ''}`}</p>
      </div>`
    : `<div class="detail-hero" style="${heroStyle(l)}">${TYPE_EMOJI[l.type] || '🏠'}</div>`;

  const isDemo = l.sources.every((s) => s.url?.includes('fictif') ||
    !s.url?.startsWith('https://www.centris') && !s.url?.startsWith('https://duproprio') && !s.url?.startsWith('https://ubee'));

  $('#modal-listing-body').innerHTML = `
    ${galleryHtml}
    <div class="detail-price">${fmtPrice(l.price)}</div>
    <h2 style="margin:4px 0 2px">${l.typeLabel}</h2>
    <p class="muted" style="margin:0">${l.address}, ${l.district ? l.district + ', ' : ''}${l.city} -- ${l.region}</p>
    <div class="card-badges" style="margin-top:8px">${sourceBadges(l)} ${isNew(l) ? '<span class="badge-new">NOUVEAU</span>' : ''}</div>

    <div class="detail-grid">
      ${l.bedrooms ? `<div><b>Chambres</b>${l.bedrooms}</div>` : ''}
      ${l.bathrooms ? `<div><b>Salles de bain</b>${l.bathrooms}${l.powderRooms ? ` (+${l.powderRooms} s. d\'eau)` : ''}</div>` : ''}
      ${l.rooms ? `<div><b>Pièces</b>${l.rooms}</div>` : ''}
      ${l.levels > 1 ? `<div><b>Étages</b>${l.levels}</div>` : ''}
      ${l.livingAreaSqft ? `<div><b>Aire habitable</b>${fmtNum(l.livingAreaSqft)} pi²</div>` : ''}
      ${l.lotAreaSqm ? `<div><b>Terrain</b>${fmtNum(l.lotAreaSqm)} m²</div>` : ''}
      ${l.yearBuilt ? `<div><b>Année</b>${l.yearBuilt}</div>` : ''}
      ${l.units ? `<div><b>Logements</b>${l.units}</div>` : ''}
      ${l.revenue ? `<div><b>Revenus annuels</b>${fmtPrice(l.revenue)}</div>` : ''}
      ${daysOnMarket(l) > 0 ? `<div><b>Sur le radar depuis</b>${daysOnMarket(l)} jour(s)</div>` : ''}
      ${l.publishedAt ? `<div><b>Publication</b>${l.publishedAt}</div>` : ''}
    </div>

    ${tags.length ? `<div class="feature-tags">${tags.map((t) => `<span class="badge-soft">${t}</span>`).join('')}</div>` : ''}
    ${l.description ? `<p style="font-size:14px;line-height:1.55">${l.description}</p>` : ''}

    <h3 style="margin-bottom:6px">Voir l'annonce d'origine</h3>
    ${l.sources.length > 1 ? '<p class="muted" style="margin-top:0">Cette propriété est listée sur plusieurs plateformes.</p>' : ''}
    <div class="source-links">
      ${l.sources.map((s) => `
        <a class="src-${s.source}" href="${s.url}" target="_blank" rel="noopener noreferrer">
           ${SOURCE_LABELS[s.source] ?? s.source} · ${fmtPrice(s.price)} ↗</a>`).join('')}
    </div>
    ${isDemo ? '<p class="muted" style="margin-top:14px">⚠️ Mode démo : annonce fictive.</p>' : ''}`;
  $('#modal-listing').hidden = false;
}

// ------------------------------------------------------------------ Galerie photos
let galleryPhotos = [];
let galleryIndex = 0;

function gallerySet(i) {
  galleryPhotos = state._openListing?.photos ?? [];
  galleryIndex = Math.max(0, Math.min(i, galleryPhotos.length - 1));
  const img = document.getElementById('gallery-img');
  if (!img) return;
  img.src = galleryPhotos[galleryIndex];
  document.querySelectorAll('.gallery-thumbs img').forEach((t, j) => t.classList.toggle('active', j === galleryIndex));
}
function galleryNav(dir) { gallerySet(galleryIndex + dir); }

// ------------------------------------------------------------------ Favoris
function toggleFav(id) {
  state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
  localStorage.setItem(LS_KEYS.fav, JSON.stringify([...state.favorites]));
  updateFavCount();
  refresh();
}
function updateFavCount() {
  const el = $('#fav-count');
  el.hidden = state.favorites.size === 0;
  el.textContent = state.favorites.size;
}

// ------------------------------------------------------------------ Recherches sauvegardées
function serializeShapes() {
  return state.shapes.map((layer) => {
    if (layer instanceof L.Circle) {
      const c = layer.getLatLng();
      return { kind: 'circle', center: [c.lat, c.lng], radius: layer.getRadius() };
    }
    return { kind: 'polygon', geojson: layer.toGeoJSON() };
  });
}

function restoreShapes(serialized) {
  drawnGroup.clearLayers();
  state.shapes = [];
  const style = { color: '#e8552f', weight: 3, fillOpacity: 0.08 };
  for (const s of serialized) {
    let layer;
    if (s.kind === 'circle') {
      layer = L.circle(s.center, { radius: s.radius, ...style });
    } else {
      const coords = s.geojson.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
      layer = L.polygon(coords, style);
    }
    drawnGroup.addLayer(layer);
    state.shapes.push(layer);
  }
  if (state.shapes.length) map.fitBounds(drawnGroup.getBounds().pad(0.2));
}

function saveCurrentSearch() {
  const name = prompt('Nom de la recherche (ex. « Plex Rosemont < 900 k$ ») :');
  if (!name) return;
  state.savedSearches.push({
    id: 'S' + Date.now(),
    name,
    createdAt: new Date().toISOString(),
    lastViewedAt: new Date().toISOString(),
    filters: snapshotFilterInputs(),
    shapes: serializeShapes(),
  });
  persistSearches();
  alert(`Recherche « ${name} » sauvegardée ✔`);
}

function snapshotFilterInputs() {
  return {
    keyword: $('#f-keyword').value,
    sources: $$('#f-sources input:checked').map((i) => i.value),
    types: $$('#f-types input:checked').map((i) => i.value),
    priceMin: $('#f-price-min').value, priceMax: $('#f-price-max').value,
    beds: $('#f-beds .on').dataset.v, baths: $('#f-baths .on').dataset.v,
    areaMin: $('#f-area-min').value, lotMin: $('#f-lot-min').value,
    yearMin: $('#f-year-min').value, yearMax: $('#f-year-max').value,
    features: $$('#f-features input:checked').map((i) => i.value),
    extras: $$('#f-extras input:checked').map((i) => i.value),
    revenueMin: $('#f-revenue-min').value,
    dom: $('#f-dom').value,
  };
}

function applyFilterSnapshot(s) {
  $('#f-keyword').value = s.keyword || '';
  $$('#f-sources input').forEach((i) => (i.checked = s.sources.includes(i.value)));
  $$('#f-types input').forEach((i) => (i.checked = s.types.includes(i.value)));
  $('#f-price-min').value = s.priceMin; $('#f-price-max').value = s.priceMax;
  setSeg('#f-beds', s.beds); setSeg('#f-baths', s.baths);
  $('#f-area-min').value = s.areaMin; $('#f-lot-min').value = s.lotMin;
  $('#f-year-min').value = s.yearMin; $('#f-year-max').value = s.yearMax;
  $$('#f-features input').forEach((i) => (i.checked = s.features.includes(i.value)));
  $$('#f-extras input').forEach((i) => (i.checked = s.extras.includes(i.value)));
  $('#f-revenue-min').value = s.revenueMin;
  $('#f-dom').value = s.dom;
}

function setSeg(sel, v) {
  $$(sel + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
}

function persistSearches() {
  localStorage.setItem(LS_KEYS.searches, JSON.stringify(state.savedSearches));
  const el = $('#saved-count');
  el.hidden = state.savedSearches.length === 0;
  el.textContent = state.savedSearches.length;
}

// Compte les annonces publiées après la dernière consultation d'une recherche
function countNewFor(search) {
  const f = filtersFromSnapshot(search.filters);
  const since = search.lastViewedAt.slice(0, 10);
  const shapeLayers = search.shapes.map(hydrateShape);
  return state.merged.filter((l) =>
    matches(l, f, shapeLayers) && l.publishedAt > since).length;
}

function hydrateShape(s) {
  const style = { color: '#e8552f' };
  return s.kind === 'circle'
    ? L.circle(s.center, { radius: s.radius, ...style })
    : L.polygon(s.geojson.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]), style);
}

function filtersFromSnapshot(s) {
  return {
    keyword: (s.keyword || '').trim().toLowerCase(),
    sources: s.sources, types: s.types,
    priceMin: +s.priceMin || 0, priceMax: +s.priceMax || Infinity,
    bedsMin: +s.beds, bathsMin: +s.baths,
    areaMin: +s.areaMin || 0, lotMin: +s.lotMin || 0,
    yearMin: +s.yearMin || 0, yearMax: +s.yearMax || Infinity,
    features: s.features, extras: s.extras,
    revenueMin: +s.revenueMin || 0,
    domMax: +s.dom || Infinity,
  };
}

function openSearchesModal() {
  const wrap = $('#saved-list');
  if (!state.savedSearches.length) {
    wrap.innerHTML = '<p class="empty">Aucune recherche sauvegardée pour l\'instant.<br>Réglez vos filtres, tracez vos secteurs, puis cliquez « Sauvegarder cette recherche ».</p>';
  } else {
    wrap.innerHTML = state.savedSearches.map((s) => {
      const news = countNewFor(s);
      return `
      <div class="saved-item">
        <div>
          <strong>${s.name}</strong>
          ${news ? `<span class="badge-newcount">${news} nouveauté${news > 1 ? 's' : ''}</span>` : ''}
          <div class="meta">${s.shapes.length ? `📐 ${s.shapes.length} secteur(s) · ` : ''}créée le ${s.createdAt.slice(0, 10)}</div>
        </div>
        <div class="actions">
          <button class="apply" data-apply="${s.id}">Appliquer</button>
          <button data-del="${s.id}" title="Supprimer">🗑</button>
        </div>
      </div>`;
    }).join('');
  }
  $('#modal-searches').hidden = false;
}

function applySavedSearch(id) {
  const s = state.savedSearches.find((x) => x.id === id);
  if (!s) return;
  applyFilterSnapshot(s.filters);
  restoreShapes(s.shapes);
  s.lastViewedAt = new Date().toISOString();
  persistSearches();
  $('#modal-searches').hidden = true;
  refresh();
}

// ------------------------------------------------------------------ Événements
function bindEvents() {
  // filtres : tout changement relance la recherche
  $('#filters-panel').addEventListener('input', debounce(refresh, 250));
  $$('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    refresh();
  }));

  $('#btn-reset').addEventListener('click', () => {
    applyFilterSnapshot({
      keyword: '', sources: ['centris', 'duproprio', 'ubee'], types: [],
      priceMin: '', priceMax: '', beds: '0', baths: '0', areaMin: '', lotMin: '',
      yearMin: '', yearMax: '', features: [], extras: [], revenueMin: '', dom: '',
    });
    state.favoritesOnly = false;
    refresh();
  });

  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; refresh(); });

  $('#btn-clear-zones').addEventListener('click', () => {
    drawnGroup.clearLayers();
    state.shapes = [];
    refresh();
  });

  // cartes de résultats : clic = fiche ; cœur = favori
  $('#cards').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFav(fav.dataset.fav); e.stopPropagation(); return; }
    const card = e.target.closest('.card');
    if (card) {
      const m = markerById.get(card.dataset.id);
      if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 13)); m.openPopup(); }
      openListing(card.dataset.id);
    }
  });

  // lien « fiche complète » dans les popups de la carte
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-open]');
    if (link) openListing(link.dataset.open);
  });

  $('#btn-favorites').addEventListener('click', () => {
    state.favoritesOnly = !state.favoritesOnly;
    $('#btn-favorites').style.outline = state.favoritesOnly ? '2px solid #ffce3d' : '';
    refresh();
  });

  $('#btn-save-search').addEventListener('click', saveCurrentSearch);
  $('#btn-saved-searches').addEventListener('click', openSearchesModal);

  $('#saved-list').addEventListener('click', (e) => {
    const apply = e.target.closest('[data-apply]');
    if (apply) { applySavedSearch(apply.dataset.apply); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      state.savedSearches = state.savedSearches.filter((s) => s.id !== del.dataset.del);
      persistSearches();
      openSearchesModal();
    }
  });

  // fermeture des modales
  $$('.modal-backdrop').forEach((b) => {
    b.addEventListener('click', (e) => {
      if (e.target === b || e.target.closest('[data-close]')) b.hidden = true;
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal-backdrop').forEach((b) => (b.hidden = true));
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ------------------------------------------------------------------ Démarrage
const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
let lastGeneratedAt = null;            // timestamp du dernier JSON chargé
let knownIds = new Set();              // ids déjà vus (pour détecter les nouveautés)

// Charge data/listings.json. silent = rechargement de fond (ne pas écraser l'UI).
async function loadData(silent = false) {
  try {
    // cache-bust pour toujours obtenir la dernière version sur GitHub Pages
    const res = await fetch('data/listings.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    // Rien de neuf ? on ne touche pas à l'affichage en cours.
    if (silent && data.generatedAt && data.generatedAt === lastGeneratedAt) {
      updateFreshness(data.generatedAt);
      return;
    }

    const merged = dedupe(data.listings);

    // Détection des nouvelles annonces depuis le dernier chargement
    if (silent && knownIds.size) {
      const fresh = merged.filter((l) => !knownIds.has(l.id));
      if (fresh.length) showNewBadge(fresh.length);
    }

    state.merged = merged;
    knownIds = new Set(merged.map((l) => l.id));
    lastGeneratedAt = data.generatedAt || null;
    updateFreshness(lastGeneratedAt);
    updateDataBadge(data);
    refresh();
  } catch (err) {
    if (!silent) {
      $('#cards').innerHTML = `<div class="empty">Impossible de charger les annonces (${err.message}).<br>
        Si vous ouvrez le fichier localement, servez le dossier via un petit serveur web
        (ex. <code>npx serve immoradar</code>) -- le navigateur bloque <code>fetch</code> en file://.</div>`;
    }
  }
}

// Affiche l'âge des données (« il y a 12 min »)
function updateFreshness(iso) {
  const el = $('#freshness');
  if (!el) return;
  if (!iso) { el.textContent = ''; return; }
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  let txt;
  if (mins < 1) txt = "à l'instant";
  else if (mins < 60) txt = `il y a ${mins} min`;
  else if (mins < 1440) txt = `il y a ${Math.round(mins / 60)} h`;
  else txt = `il y a ${Math.round(mins / 1440)} j`;
  el.textContent = '🟢 ' + txt;
}

// Étiquette d'origine des données : DÉMO si pas de vraies sources Centris
function updateDataBadge(data) {
  const el = $('#data-badge');
  if (!el) return;
  const stats = data.sourceStats;
  const hasReal = stats && stats.centris > 0;
  if (hasReal) {
    el.textContent = `${stats.total} ANNONCES`;
    el.style.background = '#1d8a4e';
    el.style.color = '#fff';
    el.title = `Centris : ${stats.centris} · autres : ${stats.other ?? 0}`;
  } else {
    el.textContent = 'MODE DÉMO';
    el.style.background = '';
    el.style.color = '';
    el.title = 'Données fictives de démonstration';
  }
}

function showNewBadge(n) {
  const el = $('#new-badge');
  if (!el) return;
  el.hidden = false;
  el.textContent = '+' + n;
  $('#btn-refresh').classList.add('has-new');
}
function clearNewBadge() {
  const el = $('#new-badge');
  if (el) { el.hidden = true; el.textContent = '0'; }
  $('#btn-refresh').classList.remove('has-new');
}

async function boot() {
  initMap();
  bindEvents();
  updateFavCount();
  persistSearches();

  await loadData(false);

  // Bouton « Rafraîchir » : recharge tout de suite
  $('#btn-refresh').addEventListener('click', async () => {
    clearNewBadge();
    $('#btn-refresh').classList.add('spinning');
    await loadData(false);
    setTimeout(() => $('#btn-refresh').classList.remove('spinning'), 600);
  });

  // Auto-rafraîchissement de fond toutes les 5 min (seulement si l'onglet est visible)
  setInterval(() => {
    if (document.visibilityState === 'visible') loadData(true);
  }, AUTO_REFRESH_MS);

  // Met à jour l'indicateur d'âge chaque minute, et recharge au retour sur l'onglet
  setInterval(() => updateFreshness(lastGeneratedAt), 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadData(true);
  });
}

boot();
