import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
await mkdir(join(here, "public"), { recursive: true });
await copyFile(join(here, "..", "latest.json"), join(here, "public", "latest.json"));
console.log("latest.json -> web/public/latest.json");
