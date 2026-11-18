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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
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
