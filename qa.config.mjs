// Peta target: satu tempat buat nama situs, host, status akun, dan URL Lighthouse.
export const RUNS = 3; // numberOfRuns Lighthouse per URL - median dari 3, biar nggak goyang

export const SITES = {
  jaja: {
    site: "Jaja.id",
    host: "jaja.id",
    akun: true,
  },
  ebh: {
    site: "Eureka Book House",
    host: "eurekabookhouse.com",
    akun: true,
  },
  masdis: {
    site: "Masterdiskon",
    host: "masterdiskon.com",
    akun: true,
  },
};

export const SPEC = {
  "cart-masdis.spec.ts": "masdis",
  "cart-jaja.spec.ts": "jaja",
  "cart-ebh.spec.ts": "ebh",
};

export const LIGHTHOUSE_TARGETS = {
  ebh: {
    site: "Eureka Book House",
    host: "eurekabookhouse.com",
    dist: "live (https://eurekabookhouse.com)",
    runs: RUNS,
    paths: ["/", "/auth/login"],
  },
  jaja: {
    site: "Jaja.id",
    host: "jaja.id",
    dist: "live (https://jaja.id)",
    runs: RUNS,
    paths: ["/", "/main/auth/login"],
  },
  masdis: {
    site: "Masterdiskon",
    host: "masterdiskon.com",
    dist: "live (https://masterdiskon.com)",
    runs: RUNS,
    paths: ["/id-id", "/id-id/login"],
  },
};
