import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    port: 5174,
    // Fail loudly instead of drifting to another port: the port is part of the
    // origin, so a silent move changes which storage and which Privy allowlist
    // entry the app is running against.
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
