import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Dashboard",
  description: "QA workbench for Playwright, Lighthouse CI and test reports",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Browser extensions may add style/attributes to <html> before hydration.
  // Suppress that extension-only mismatch; app state itself is not affected.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
