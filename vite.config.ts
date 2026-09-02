import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  optimizeDeps: {
    // Privy lazy-loads its login screens. If the dep optimizer rebuilds mid-session
    // those chunk URLs 504 and the wallet overlay mounts with no content.
    include: [
      "@privy-io/react-auth",
      "@privy-io/react-auth/hooks",
      "@stripe/crypto",
    ],
  },
  server: {
    port: 5173,
    // Fail loudly instead of drifting to another port: the port is part of the
    // origin, so a silent move changes which storage and which Privy allowlist
    // entry the app is running against.
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
