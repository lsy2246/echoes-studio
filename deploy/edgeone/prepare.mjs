import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const output = ".output/edgeone-bundle";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(".output/public", output, { recursive: true });
await mkdir(`${output}/cloud-functions/api`, { recursive: true });
await cp(".output/server/edgeone.mjs", `${output}/cloud-functions/api/[[default]].js`);
await writeFile(`${output}/package.json`, JSON.stringify({
  private: true,
  type: "module",
  engines: { node: ">=20" },
  dependencies: { postgres: "3.4.7" },
}, null, 2));
await writeFile(`${output}/edgeone.json`, JSON.stringify({
  overseasRegions: ["ap-singapore"],
}, null, 2));
