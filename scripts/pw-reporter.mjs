import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

const langkah = step => ({
  title: step.title || step.category,
  category: step.category,
  duration: step.duration,
  location: step.location,
  error: step.error ?? null,
  steps: (step.steps ?? []).map(langkah),
});

export default class LaporanLangkah {
  constructor({outputFile = join('pw-out', 'langkah.json')} = {}) {
    this.outputFile = outputFile;
    this.tests = [];
  }

  onTestEnd(test, result) {
    this.tests.push({
      id: test.id,
      file: test.location.file,
      location: test.location,
      title: test.titlePath().join(' / '),
      projectName: test.parent.project()?.name,
      retry: result.retry,
      status: result.status,
      ms: result.duration,
      steps: (result.steps ?? []).map(langkah),
    });
  }

  onEnd() {
    mkdirSync(dirname(this.outputFile), {recursive: true});
    writeFileSync(this.outputFile, JSON.stringify({tests: this.tests}, null, 2));
  }
}
