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

## Statut

Repoussé. Centris (~2 900 annonces) couvre déjà la majorité du marché.
Beaucoup de pistes défrichées ci-dessus pour reprendre vite.
