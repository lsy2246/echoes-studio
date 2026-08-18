import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const output = ".vercel/output";
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/static`, { recursive: true });
await mkdir(`${output}/functions/api.func`, { recursive: true });
await cp(".output/public", `${output}/static`, { recursive: true });
await cp(".output/server/vercel.mjs", `${output}/functions/api.func/index.mjs`);
await mkdir(`${output}/functions/api.func/node_modules`, { recursive: true });
await cp("node_modules/postgres", `${output}/functions/api.func/node_modules/postgres`, {
  recursive: true,
  dereference: true,
});
await writeFile(`${output}/functions/api.func/.vc-config.json`, JSON.stringify({
  runtime: "nodejs22.x",
  handler: "index.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: true,
  supportsResponseStreaming: true,
}, null, 2));
await writeFile(`${output}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: "^/api(?:/.*)?$", dest: "/api" },
    { handle: "filesystem" },
    { src: "/.*", dest: "/index.html" },
  ],
}, null, 2));
