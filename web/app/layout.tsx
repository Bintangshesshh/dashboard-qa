import type { Metadata } from "next";
import "./globals.css";
import "./shell.css";
import "./qa-dashboard.css";
import "./theme.css";
import "./shell-skin.css";

export const metadata: Metadata = {
  title: "QA Dashboard",
  description: "QA workbench for Playwright, Lighthouse CI and test reports",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
