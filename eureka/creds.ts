import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  const text = readFileSync(join(__dirname, "..", ".env"), "utf8");
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) process.env[m[1]] ??= m[2];
  }
} catch {}

export function creds(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `${key} belum di-set. Salin .env.example jadi .env lalu isi nilainya.`,
    );
  }
  return v;
}
