import { createRuntimeApp } from "./create-runtime-app.ts";
import { createNodeDatabase } from "./node-database.ts";

const handler = createNodeDatabase(process.env).then(({ database }) =>
  createRuntimeApp(database, process.env),
);

export interface EdgeOneContext {
  request: Request;
}

export async function onRequest(context: EdgeOneContext): Promise<Response> {
  return (await handler)(context.request);
}

export default onRequest;

