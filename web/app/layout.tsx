import type { Metadata } from "next";
import "./pb.css";

export const metadata: Metadata = {
  title: "Playbook",
  description: "QA dashboard - Playwright, Lighthouse CI, laporan sesi",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Browser extensions may add style/attributes to <html> before hydration.
  // Suppress that extension-only mismatch; app state itself is not affected.
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* Set tema sebelum paint: cegah kedip putih di dark mode. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var p='system';try{p=localStorage.getItem('pb-theme')||'system'}catch(e){}" +
              "if(p!=='light'&&p!=='dark')p='system';" +
              "var d=p==='dark'||(p==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);" +
              "if(d)document.documentElement.dataset.theme='dark';" +
              "document.documentElement.dataset.themePref=p;})();",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
