# 📡 ImmoRadar Québec

Moteur de recherche immobilier personnalisé qui combine les annonces de
**Centris**, **DuProprio** et **Ubee** dans une seule interface — un
« Centris 2.0 » avec en prime la fusion automatique des propriétés listées
sur plusieurs plateformes.

> ✅ **Données réelles Centris** : un robot (GitHub Actions) récupère toutes
> les 2 heures les annonces réelles de Centris pour le Grand Montréal, les
> Laurentides et Lanaudière (prix, photos, coordonnées GPS, liens d'origine).
> Voir `tools/connectors/centris.mjs`. DuProprio et Ubee viendront s'ajouter.

## ✨ Fonctionnalités

- 🗺️ **Tracé de secteurs personnalisés** sur la carte : polygone, rectangle
  ou cercle (plusieurs secteurs simultanés, modifiables et supprimables).
  Seules les propriétés à l'intérieur des secteurs sont affichées.
- 🎛️ **Filtres à la Centris** : mot-clé, prix, catégorie de propriété,
  chambres, salles de bain, superficie habitable et de terrain, année de
  construction, garage / stationnement / piscine / bord de l'eau / foyer /
  ascenseur / accessibilité / climatisation, visite libre, reprise bancaire,
  construction neuve, revenus de plex, jours sur le marché.
- 🔀 **Multi-sources + déduplication** : chaque fiche affiche ses plateformes
  d'origine; une propriété publiée sur Centris **et** DuProprio est fusionnée
  en une seule fiche (meilleur prix affiché, liens vers chaque annonce).
- ❤️ **Favoris** (stockés localement dans le navigateur).
- 🔖 **Recherches sauvegardées** : filtres **et** secteurs tracés, réutilisables
  en un clic, avec compteur de nouveautés depuis la dernière consultation.
- 📊 Tri par date, prix, superficie; regroupement des marqueurs sur la carte;
  étiquettes de prix cliquables.

## 🚀 Démarrage

Aucune compilation, aucune dépendance externe (bibliothèques auto-hébergées
dans `vendor/`). Il suffit d'un serveur de fichiers statiques :

```bash
npx serve immoradar        # puis ouvrir http://localhost:3000
# ou
python3 -m http.server -d immoradar 8000
```

> N'ouvrez pas `index.html` directement en `file://` — le navigateur bloque
> le chargement de `data/listings.json`.

### Déploiement GitHub Pages

Activez Pages sur le dépôt (Settings → Pages → branche `main`) : l'app sera
servie à `https://<utilisateur>.github.io/<repo>/immoradar/`.

## 🔄 Régénérer les données de démo

```bash
node immoradar/tools/generate-listings.mjs
```

## 🗂️ Structure

```
immoradar/
├── index.html              Interface (filtres, liste, carte, modales)
├── css/styles.css
├── js/app.js               Logique : déduplication, filtres, carte, secteurs,
│                           favoris, recherches sauvegardées
├── data/listings.json      Annonces (démo) — format « brut par source »
├── tools/generate-listings.mjs
└── vendor/                 Leaflet, Leaflet.draw, MarkerCluster, Turf.js
```

### Format d'une annonce (brute, par source)

Chaque entrée de `listings.json` représente **une annonce sur une plateforme**.
Le client fusionne les annonces d'une même propriété (clé : adresse + ville
normalisées) — exactement le pipeline qu'utiliseront les futurs connecteurs.

```json
{
  "source": "centris",
  "sourceId": "CE12345678",
  "url": "https://www.centris.ca/fr/propriete~a-vendre~montreal/CE12345678",
  "address": "1907, croissant des Sources",
  "city": "Montréal", "district": "Rosemont", "region": "Montréal",
  "lat": 45.53, "lng": -73.58,
  "price": 545000, "type": "unifamiliale",
  "bedrooms": 3, "bathrooms": 2, "livingAreaSqft": 1450, "lotAreaSqm": 420,
  "yearBuilt": 1987, "publishedAt": "2026-06-02",
  "features": { "garage": true, "pool": false, "waterfront": false }
}
```

## 🧭 Feuille de route (brancher de vraies données)

1. **Connecteurs** : un script par source (`tools/connectors/centris.mjs`, etc.)
   qui produit des annonces au format ci-dessus et les écrit dans
   `data/listings.json`. Exécution planifiée (cron local ou GitHub Actions)
   puis commit automatique du JSON.
2. **Géocodage** : pour les sources sans coordonnées, utiliser
   [Adresses Québec](https://www.donneesquebec.ca/) ou Nominatim.
3. **Alertes** : une GitHub Action qui compare le nouveau JSON à l'ancien et
   envoie un courriel quand une annonce correspond à une recherche sauvegardée.
4. **Photos réelles** : conserver les URL d'images des annonces d'origine.

### ⚖️ Note importante sur les données

Centris, DuProprio et Ubee n'offrent pas d'API publique, et leurs conditions
d'utilisation encadrent strictement l'extraction automatisée. Cet outil est
conçu pour un **usage personnel** à faible volume. Pour tout usage public ou
commercial, il faut passer par des ententes de données ou des fournisseurs
autorisés (ex. accès courtier aux données MLS).
