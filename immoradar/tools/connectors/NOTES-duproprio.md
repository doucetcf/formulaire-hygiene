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

## Statut

Repoussé. Centris (~2 800 annonces) couvre déjà la majorité du marché.
