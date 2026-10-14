import base from "../playwright.config";

export default {
  ...base,
  testDir: ".",
  reporter: [["html", { open: "never" }]],
};
