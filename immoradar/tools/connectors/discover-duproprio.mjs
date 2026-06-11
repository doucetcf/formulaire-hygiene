#!/usr/bin/env node
/** Diagnostic DuProprio v2 — sitemap + fiche individuelle. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'fr-CA' };

// 1. Sitemap : où sont listées les URL d'annonces ?
console.log('── sitemap principal ──');
const sm = await fetch('https://duproprio.com/sitemap.xml', { headers: H });
console.log('Statut:', sm.status);
const smTxt = await sm.text();
console.log('Taille:', smTxt.length);
console.log('Sous-sitemaps (.xml):');
for (const m of smTxt.matchAll(/<loc>(https:\/\/[^<]+\.xml[^<]*)<\/loc>/g)) console.log('  ' + m[1]);

// 2. Un sous-sitemap d'annonces (heuristique sur le nom)
const child = [...smTxt.matchAll(/<loc>(https:\/\/[^<]+\.xml[^<]*)<\/loc>/g)]
  .map(m => m[1]).find(u => /listing|propert|fiche|annonce/i.test(u));
if (child) {
  console.log('\n── sous-sitemap annonces ──');
  const r = await fetch(child, { headers: H });
  const t = await r.text();
  const urls = [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  console.log('Statut:', r.status, '| URL annonces:', urls.length);
  console.log('3 premières URL :');
  urls.slice(0, 3).forEach(u => console.log('  ' + u));

  // 3. Une fiche individuelle : quelles données on récupère ?
  if (urls.length) {
    console.log('\n── fiche échantillon ──');
    const f = await fetch(urls[0], { headers: H });
    console.log('Statut:', f.status);
    const html = await f.text();
    console.log('Taille HTML:', html.length);
    for (const [n, re] of [
      ['itemprop="price"', /itemprop="price"[^>]*content="([^"]+)"/],
      ['<meta latitude>', /name="ICBM"\s+content="([^"]+)"/i],
      ['JSON-LD', /<script[^>]+application\/ld\+json[^>]*>([\s\S]{0,800}?)<\/script>/],
      ['adresse (h1)', /<h1[^>]*>([\s\S]{0,200}?)<\/h1>/],
      ['ville (breadcrumb)', /breadcrumb[\s\S]{0,500}/],
      ['prix visible', /\$\s*\d|\d[\s ]{0,3}\d{3}[\s ]\$/],
      ['chambres', /chambres?\b[^<]{0,30}/i],
    ]) {
      const m = html.match(re);
      console.log(`  ${n.padEnd(22)} : ${m ? JSON.stringify(((m[1] ?? m[0]).slice(0, 200))) : '∅'}`);
    }
  }
}
