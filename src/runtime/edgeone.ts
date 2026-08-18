import { createRuntimeApp } from "./create-runtime-app.ts";
import { createHostedDatabase } from "./hosted-database.ts";

const { database } = createHostedDatabase(process.env);
const handler = createRuntimeApp(database, process.env);

export interface EdgeOneContext {
  request: Request;
}

export async function onRequest(context: EdgeOneContext): Promise<Response> {
  return handler(context.request);
}

export default onRequest;
