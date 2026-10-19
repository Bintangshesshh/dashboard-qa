/** @type {import('next').NextConfig} */
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default {
  basePath: base,
  trailingSlash: true,
  images: { unoptimized: true },
  outputFileTracingRoot: import.meta.dirname,
};
