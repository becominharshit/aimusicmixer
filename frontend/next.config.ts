import type { NextConfig } from "next";

const isManagedControlPlaneRuntime =
  Boolean(process.env.CONTROL_PLANE_API_DIR) ||
  process.env.CONTROL_PLANE_PORT === "8000";

const isLocalControlPlaneApiUrl = (value: string | undefined) =>
  typeof value === "string" &&
  /^https?:\/\/(localhost|127\.0\.0\.1):8000\/?$/i.test(value.trim());

const overrideControlPlaneApiUrl =
  isManagedControlPlaneRuntime &&
  (isLocalControlPlaneApiUrl(process.env.NEXT_PUBLIC_API_URL) ||
    isLocalControlPlaneApiUrl(process.env.NEXT_PUBLIC_API_BASE_URL));

if (overrideControlPlaneApiUrl) {
  process.env.NEXT_PUBLIC_API_URL = "";
  process.env.NEXT_PUBLIC_API_BASE_URL = "";
}

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.supabase.co",
      "media-src 'self' blob: data: https://*.supabase.co https://*.onrender.com http://localhost:* http://127.0.0.1:*",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.onrender.com https://fonts.googleapis.com https://fonts.gstatic.com http://localhost:* http://127.0.0.1:*",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  ...(overrideControlPlaneApiUrl
    ? {
        env: {
          NEXT_PUBLIC_API_URL: "",
          NEXT_PUBLIC_API_BASE_URL: "",
        },
      }
    : {}),
};

export default nextConfig;
