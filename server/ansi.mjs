// Kode warna ANSI dari Playwright/lhci bocor ke teks polos sebagai `[2m`/`[22m`.
// Dipakai untuk log, pesan error, dan hasil yang dibaca dari DB.
// eslint-disable-next-line no-control-regex
export const stripAnsi = text => String(text).replace(/\u001b?\[[0-9;]*m/g, '');
