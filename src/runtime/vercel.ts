import { createRuntimeApp } from "./create-runtime-app.ts";
import { createHostedDatabase } from "./hosted-database.ts";

const { database } = createHostedDatabase(process.env);
const handler = createRuntimeApp(database, process.env);

export default async function vercelHandler(request: Request): Promise<Response> {
  return handler(request);
}
