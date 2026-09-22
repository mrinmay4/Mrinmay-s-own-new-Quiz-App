import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // Lets you open the dev server from another device on your LAN (e.g.
  // testing on your phone at http://<your-ip>:3000) without the
  // cross-origin warning. Dev-only - has no effect on `next build`/`next start`.
  allowedDevOrigins: ["192.168.29.205"],
};

export default nextConfig;