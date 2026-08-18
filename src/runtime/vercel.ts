import { createRuntimeApp } from "./create-runtime-app.ts";
import { createNodeDatabase } from "./node-database.ts";

const handler = createNodeDatabase(process.env).then(({ database }) =>
  createRuntimeApp(database, process.env),
);

export default async function vercelHandler(request: Request): Promise<Response> {
  return (await handler)(request);
}

