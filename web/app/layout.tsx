import type { Metadata } from "next";
import "./pb.css";

export const metadata: Metadata = {
  title: "Playbook",
  description: "QA dashboard — Playwright, Lighthouse CI, laporan sesi",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
