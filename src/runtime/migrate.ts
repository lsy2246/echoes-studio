import { createNodeDatabase } from "./node-database.ts";

process.env.CMS_DATABASE_MIGRATE = "true";
const handle = await createNodeDatabase(process.env);
const health = await handle.database.health();
await handle.close();
if (!health.ok) throw new Error("Database migration did not produce a healthy schema");
console.log(`Echoes Studio ${health.adapter} schema is at version ${health.schemaVersion}.`);

