// Sinkron dua arah terkendali antara test_files.code (DB) dan file spec di disk.
// Guard: kalau file di disk berubah sejak sinkron terakhir, simpan ditolak (409)
// sampai user memilih timpa atau muat ulang. Tanpa guard, edit di git bisa hilang.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, sep } from 'node:path';

export const sha = text => createHash('sha256').update(text).digest('hex');

// Path spec selalu relatif ke root repo. Tolak absolut dan traversal.
export function specPath(root, relPath) {
  if (typeof relPath !== 'string' || !relPath || isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) {
    throw Object.assign(new Error('Path spec tidak valid'), { status: 400 });
  }
  const base = resolve(root);
  const abs = resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw Object.assign(new Error('Path spec keluar dari repo'), { status: 400 });
  }
  return abs;
}

// null = file tidak ada di disk (mis. baru dibuat lewat dashboard).
export async function readSpec(abs) {
  const text = await readFile(abs, 'utf8').catch(() => null);
  return text == null ? null : { text, hash: sha(text) };
}

export async function writeSpec(abs, code) {
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, code);
  return sha(code);
}
