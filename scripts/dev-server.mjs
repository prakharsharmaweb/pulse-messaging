import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { options } from "./build-server.mjs";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const outfile = path.join(root, ".server/server.cjs");

let child = null;
function restart() {
  if (child) child.kill();
  child = spawn(process.execPath, [outfile], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
}

const ctx = await esbuild.context({
  ...options,
  plugins: [
    {
      name: "restart",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) restart();
        });
      },
    },
  ],
});

await ctx.watch();
console.log("▸ watching server sources…");

process.on("SIGINT", async () => {
  child?.kill();
  await ctx.dispose();
  process.exit(0);
});
