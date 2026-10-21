/** @type {import('next').NextConfig} */
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const backend = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
export default {
  basePath: base,
  trailingSlash: true,
  images: { unoptimized: true },
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  async rewrites() {
    return ["/api/:path*", "/artifacts/:path*", "/ws"].map(source => ({ source, destination: backend + source }));
  },
};
