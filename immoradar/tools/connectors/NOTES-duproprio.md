# Notes pour le connecteur DuProprio (à reprendre)

## Ce qu'on sait

- HTTP **200** sur `/fr/rechercher/liste?search=true` (pas de Cloudflare/captcha).
- **SPA React** : le HTML statique ne contient pas les annonces sous forme structurée
  (0 `data-listing-id`, 0 `itemprop="price"`, 0 URL d'annonce visible).
- Le HTML contient en revanche **2 scripts JSON-LD** :
  - `Organization` (peu utile)
  - `SearchResultsPage` avec :
    - `mainEntity` = **tableau** `[{ "@type": "ItemList", "itemListElement": [...] }]`
    - chaque `itemListElement[i].item` = `{ "@type": "Place", "url": "...", "geo": { lat, lng } }`
    - `offers` = `AggregateOffer` (juste lowPrice/highPrice, pas les prix unitaires)
- `meta csrf-token` présent dans la page.
- Cookies Laravel : `dp_shared_session`, `XSRF-TOKEN`, `laravel_session`.
- Endpoints `/fr/api/properties/search`, `/fr/api/search/properties`, `/api/search` :
  tous **HTTP 419** (CSRF Laravel manquant) → existent mais auth manquante.

## Pièges connus

- `?pageNumber=N` casse le JSON-LD (mainEntity disparaît).
- `?regions[0]=N` ne filtre pas côté serveur (le HTML retourné est identique).
- `/sitemap.xml` → 404.

## Voies à explorer

1. **Playwright** (le plus sûr) : charger la page dans un navigateur réel, attendre
   le rendu React, intercepter les requêtes XHR vers leur vraie API JSON.
2. **Token CSRF Laravel** : utiliser `meta csrf-token` (déjà déchiffré) en header
   `X-CSRF-TOKEN` au lieu de `X-XSRF-TOKEN` (qui lui est chiffré).
3. **Page individuelle** : si le JSON-LD `SearchResultsPage` (sans pageNumber)
   donne assez d'URL d'annonces, scraper la fiche de chacune une par une et
   récupérer leur JSON-LD `Product`. Plus simple mais N requêtes.

## URL d'annonce capturée pour test

```
https://duproprio.com/fr/quebec-rive-sud/pintendre/bungalow-a-vendre/hab-386-rue-pamphile-le-may-1134318
```

## DÉCOUVERTE CLÉ (2026-06-13) — passerelle api-proxy

DuProprio a une passerelle JSON **`https://duproprio.com/fr/api-proxy/{resource}`**.

Endpoint confirmé qui marche :
```
GET /fr/api-proxy/featured-homes?province=qc&page[size]=N
```
Retourne `{ "listings": [ { ... } ] }`. Schéma d'une annonce :
```json
{
  "address": { "street": "...", "city": "Mirabel", "city_id": 702, "region": "Laurentides", "province": "QC" },
  "photos": [{ "is_primary": true, "formats": { "320": "...", "1024": "..." } }],
  "price": { "raw": 0, "display": "Prix sur demande", "term": "" },
  "type": "Bungalow",
  "id": "1126603",
  "url": "/fr/laurentides/mirabel/bungalow-a-vendre/hab-...-1126603",
  "photo": "https://photos.duproprio.com/photos/public/for_sale/.../...-320-....jpg"
}
```
→ a TOUT sauf lat/lng. Mais `featured-homes` = annonces vedettes seulement.

Endpoints recherche testés et **404** : `search`, `listings`, `properties`,
`for-sale`, `homes`, `search-results`, `listings/search`.

### Prochaine étape (la plus prometteuse)
Trouver le vrai nom de l'endpoint de recherche sous `/fr/api-proxy/`.
Méthode : Playwright sur `/fr/rechercher/liste`, **forcer le chargement des
résultats** (scroll de la liste, ou clic sur vue Liste, ou attendre +10s) et
intercepter la requête `api-proxy/...` qui ramène les ~40 annonces.
Tester aussi `featured-homes` avec un filtre ville (`city_id`, `cities[]`) et
un grand `page[size]` — il retourne peut-être plus que les vedettes.

### Alternative sans API
Le JSON-LD `SearchResultsPage` de la page HTML contient
`mainEntity[0].itemListElement[].item = { url, geo:{latitude,longitude} }`
(~40 annonces/page avec coordonnées). Le prix/détails sont sur la fiche
individuelle (`url`) via son propre JSON-LD. Piège : `?pageNumber=N` casse
le JSON-LD (pagination à régler autrement).

## SESSION 2 (2026-06-14) — featured-homes décortiqué

`GET /fr/api-proxy/featured-homes?parent=1&sort=-published_at&province=qc&page[size]=N&page[number]=P`

Schéma d'une annonce (COMPLET) :
```json
{ "address": {"street","city","city_id","region","province"},
  "photos": [...], "price": {"raw": 341873, "display": "341 873 $"},
  "type": "Condo", "is_rental": false, "id": "1130021",
  "url": "/fr/monteregie-rive-sud-montreal/brossard/condo-a-vendre/hab-...-1130021",
  "photo": "https://photos.duproprio.com/.../...-320-....jpg" }
```
**Manque : lat/lng (coordonnées) et bedrooms/bathrooms.** ← bloquant pour la carte.

**LIMITE MAJEURE** : `featured-homes` = pool de ~60 annonces VEDETTES seulement.
`page[number]=2/3` renvoie les MÊMES 60 (en fetch sans session). Ce n'est donc
PAS l'endpoint de recherche complet.

IDs de régions DuProprio (param `regions[0]=` ) :
6=Montréal/Île, 13=Laval, 14=Lanaudière, 15=Laurentides,
16=Montérégie (Rive-Sud), + autres 1-18.

## Où chercher l'endpoint de recherche complet (prochaine session)
- Le navigateur (avec session/cookies complets) A capturé `page[number]=2`
  renvoyant des annonces DIFFÉRENTES → la pagination marche AVEC session.
  Donc refaire la capture Playwright mais EN CONSERVANT le contexte/session,
  et scroller la VRAIE liste de résultats (181 items) pour voir quel endpoint
  alimente ces 181 (différent de featured-homes).
- Pour les coordonnées : soit la fiche individuelle (JSON-LD de chaque `url`),
  soit le JSON-LD `SearchResultsPage` de la page (a `geo:{lat,lng}` par annonce).
  Idée : joindre featured-homes (prix/type) ↔ JSON-LD (geo) par `url`.

## Verdict honnête
DuProprio protège bien ses données de recherche complètes (SPA + API de
recherche non triviale + pas de coords dans l'API simple). Faisable mais
demande encore 2-3 itérations Playwright avec session. À reprendre quand le
budget le permet — les pistes ci-dessus évitent de repartir de zéro.

## SESSION 3 (2026-06-15) — verdict via Playwright (DOM rendu)

- Page `rechercher/liste?search=true` SANS filtre = affiche les **vedettes**
  (~12 cartes province-wide), pas de vrais résultats de recherche.
- Capture réseau : SEULE `featured-homes` apparaît (pool ~80). Pas d'API de
  recherche séparée déclenchée au chargement/scroll.
- **DOM rendu scrapable** : chaque carte a prix + ville + adresse + type + url
  dans son texte/href. Ex : href `/fr/monteregie-rive-sud-montreal/brossard/
  condo-a-vendre/...`, texte « 420 000 $ Brossard 8-8095 rue de Londres … ».
  → MAIS **pas de coordonnées GPS** dans la carte.

## Chemin viable (mais lourd) pour une vraie intégration
1. Playwright : soumettre une recherche par RÉGION (regions[0]=15 etc.) via
   l'UI, attendre le rendu, scroller/paginer pour charger toutes les cartes.
2. Scraper chaque carte (prix/ville/adresse/type/url depuis le DOM rendu).
3. Coordonnées : joindre au JSON-LD `SearchResultsPage` (a geo par url) OU
   visiter chaque fiche. Étape supplémentaire obligatoire.
→ Implique Playwright DANS le cron (navigateur + scroll + scrape par région,
   toutes les 2 h) = lourd, plus lent, plus fragile.

## VERDICT
Faisable mais c'est un vrai projet (Playwright en production + jointure
coordonnées + maintenance). Pour un outil perso où **Centris couvre déjà
~85 % du marché (11 600 annonces)**, le gain marginal de DuProprio (~15-20 %,
les sans-courtier) ne justifie pas la complexité/coût pour l'instant.
À reprendre dans une session dédiée si le besoin se confirme.

## Statut
Repoussé (verdict ci-dessus). Centris couvre la majorité du marché.
