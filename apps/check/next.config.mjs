/** Static export: apps/check must run from a plain static host (FRONTEND.md, non-negotiable 1). */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};
export default nextConfig;
