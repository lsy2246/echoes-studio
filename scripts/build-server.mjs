import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(".output/server", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/runtime/node-server.ts"],
    outfile: ".output/server/node-server.mjs",
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    external: ["postgres", "node:sqlite"],
  }),
  build({
    entryPoints: ["src/runtime/vercel.ts"],
    outfile: ".output/server/vercel.mjs",
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    external: ["postgres", "node:sqlite"],
  }),
  build({
    entryPoints: ["src/runtime/edgeone.ts"],
    outfile: ".output/server/edgeone.mjs",
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    external: ["postgres", "node:sqlite"],
  }),
  build({
    entryPoints: ["src/runtime/cloudflare-worker.ts"],
    outfile: ".output/server/cloudflare-worker.mjs",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2023",
    sourcemap: true,
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:sockets", "node:*"],
  }),
]);

const { readFile } = await import("node:fs/promises");
for (const artifact of ["vercel.mjs", "edgeone.mjs"]) {
  const source = await readFile(`.output/server/${artifact}`, "utf8");
  if (source.includes('import("node:sqlite")')) {
    throw new Error(`${artifact} must not include the local SQLite runtime`);
  }
}
