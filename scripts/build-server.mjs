import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");

/** @type {import('esbuild').BuildOptions} */
export const options = {
  entryPoints: [path.join(root, "server.ts")],
  outfile: path.join(root, ".server/server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // keep every npm dependency external; only our own src is bundled
  packages: "external",
  alias: { "@": path.join(root, "src") },
  sourcemap: "inline",
  logLevel: "info",
};

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-server.mjs")) {
  await esbuild.build(options);
}
