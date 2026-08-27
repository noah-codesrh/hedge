/**
 * Runs a TypeScript file from `app/` in Node.
 *
 * Node cannot resolve the app's extensionless imports, and adding a bundler
 * just to run a check script means a new dependency and a pnpm build-script
 * approval for everyone who installs. Vite is already here and already knows
 * how to resolve and transform these files, so borrow its loader.
 *
 * `configFile: false` skips the app's Vite config on purpose: the router
 * plugin expects a real dev server, and a check script needs neither it nor
 * any of the aliases.
 *
 *   node scripts/run.mjs scripts/check-sponsor-policy.ts
 */
import { createServer } from "vite";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/run.mjs <file.ts>");
  process.exit(1);
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});

try {
  await server.ssrLoadModule(`/${target.replace(/^\.?\//, "")}`);
} finally {
  await server.close();
}
