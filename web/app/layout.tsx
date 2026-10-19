import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Dashboard",
  description: "Playwright + Lighthouse — Eureka Group",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
