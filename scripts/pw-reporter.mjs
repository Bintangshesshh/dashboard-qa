// Reporter tambahan: simpan LANGKAH tiap tes ke pw-out/langkah.json.
//
// Reporter JSON bawaan cuma nulis step ber-category 'test.step'
// (node_modules/playwright/lib/runner/index.js:4194), jadi aksi bawaan
// page.goto / locator.click (category 'pw:api') nggak pernah sampai ke dashboard.
// Lewat API reporter, result.steps masih utuh.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const out = {tests: []};

const langkah = (s) => ({
  title: s.title || s.category,
  duration: s.duration,
  error: s.error ?? null,
});

export default class LaporanLangkah {
  onTestEnd(test, result) {
    out.tests.push({
      file: test.location.file.replace(/^.*[\\/]/, ''),
      title: test.title,
      status: result.status,
      ms: result.duration,
      steps: (result.steps ?? []).map(langkah),
    });
  }

  onEnd() {
    mkdirSync('pw-out', {recursive: true});
    writeFileSync(join('pw-out', 'langkah.json'), JSON.stringify(out, null, 2));
  }
}
