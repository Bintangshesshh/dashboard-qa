// Peta target QA — satu-satunya tempat yang nyebut "sumber X ngecek situs Y".
// Dipakai scripts/gabung.mjs biar tiap hasil ada label targetnya.

export const SITES = {
  jaja: {site: 'Jaja.id', host: 'jaja.id', akun: true},
  ebh: {site: 'Eureka Book House', host: 'eurekabookhouse.com', akun: true},
  masdis: {site: 'Masterdiskon', host: 'masterdiskon.com', akun: true},
  'masdis-demo': {site: 'Masterdiskon (tanpa akun)', host: 'masterdiskon.com', akun: false},
};

export const SPEC = {
  'co-jaja.spec.ts': 'jaja',
  'co-ebh.spec.ts': 'ebh',
  'co-masdis.spec.ts': 'masdis',
  'galogin-masdis.spec.ts': 'masdis',
  'demo-masdis.spec.ts': 'masdis-demo',
};

// Lighthouse nggak ngecek situs luar: dia ngecek build Docusaurus lokal.
export const LIGHTHOUSE_TARGET = {site: 'Docusaurus (docs)', host: 'localhost', dist: 'docusaurus/build'};
