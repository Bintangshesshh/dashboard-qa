module.exports = {
  ci: {
    collect: {
      numberOfRuns: 1,
      url: [
        "https://jaja.id/",
        "https://jaja.id/main/auth/login",
      ],
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.6 }],
        "categories:accessibility": ["warn", { minScore: 0.6 }],
        "categories:best-practices": ["warn", { minScore: 0.6 }],
        "categories:seo": ["warn", { minScore: 0.6 }],
      },
    },
    upload: { target: "filesystem", outputDir: "./lhci-results-jaja" },
  },
};
