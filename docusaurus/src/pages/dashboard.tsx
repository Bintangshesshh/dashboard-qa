import React, {useEffect, useState} from 'react';
import Layout from '@theme/Layout';
import useBaseUrl from '@docusaurus/useBaseUrl';

type Url = {path: string; scores: Record<string, number>};
type Data = {
  generatedAt: string;
  lighthouse: {runs: number; errors: number; warnings: number; urls: Url[]};
};

const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];

const warna = (n: number) =>
  n >= 0.9
    ? 'var(--ifm-color-success)'
    : n >= 0.5
      ? 'var(--ifm-color-warning)'
      : 'var(--ifm-color-danger)';

export default function Dashboard(): React.JSX.Element {
  const [data, setData] = useState<Data | null>(null);
  const dataUrl = useBaseUrl('/data/latest.json');

  useEffect(() => {
    fetch(dataUrl)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [dataUrl]);

  return (
    <Layout title="Dashboard" description="Status E2E + Lighthouse">
      <main className="container margin-vert--lg" style={{minHeight: '60vh'}}>
        <h1>Dashboard</h1>
        {!data ? (
          <p>Belum ada data. Jalanin <code>node scripts/gabung.mjs</code> dulu.</p>
        ) : (
          <>
            <p style={{color: 'var(--ifm-color-emphasis-600)'}}>
              {data.lighthouse.runs} halaman &middot;{' '}
              {data.lighthouse.errors} error &middot; {data.lighthouse.warnings} warning
              &middot; run {new Date(data.generatedAt).toLocaleString('id-ID')}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Halaman</th>
                  {CATS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.lighthouse.urls.map((u) => (
                  <tr key={u.path}>
                    <td>
                      <code>{u.path}</code>
                    </td>
                    {CATS.map((c) => (
                      <td key={c} style={{color: warna(u.scores[c]), fontWeight: 600}}>
                        {Math.round((u.scores[c] ?? 0) * 100)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </main>
    </Layout>
  );
}
