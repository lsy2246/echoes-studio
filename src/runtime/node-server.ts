import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import { extname, resolve, sep } from "node:path";
import { createRuntimeApp } from "./create-runtime-app.ts";
import { readInteger, type RuntimeEnv } from "./env.ts";
import { createNodeDatabase } from "./node-database.ts";
import { createLocalFilesystemRepository } from "./local-filesystem-repository.ts";

for (const filename of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(resolve(filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const env = process.env as RuntimeEnv;
const port = readInteger(env, "CMS_PORT", 8788);
const host = env.CMS_HOST?.trim() || "127.0.0.1";
const publicDirectory = resolve(
  env.CMS_PUBLIC_DIRECTORY?.trim() || ".output/public",
);
const database = await createNodeDatabase(env);
const repository =
  env.CMS_REPOSITORY_DRIVER?.trim().toLowerCase() === "filesystem"
    ? await createLocalFilesystemRepository({
        rootPath: env.CMS_REPOSITORY_PATH?.trim() || "../blog",
        contentRoot: env.CMS_CONTENT_ROOT,
        maxArticleBytes: readInteger(env, "CMS_MAX_ARTICLE_BYTES", 1024 * 1024),
      })
    : undefined;
const app = createRuntimeApp(database.database, env, {
  repository,
  createFilesystemRepository: async (rootPath, contentRoot) =>
    createLocalFilesystemRepository({
      rootPath,
      contentRoot,
      maxArticleBytes: readInteger(env, "CMS_MAX_ARTICLE_BYTES", 1024 * 1024),
    }),
  allowUnauthenticatedByDefault:
    process.env.NODE_ENV !== "production" &&
    ["127.0.0.1", "::1", "localhost"].includes(host),
});

async function runScheduledReconciliation(): Promise<void> {
  const headers = new Headers();
  const storedToken = (await database.database.getSystemSettings())
    .internalToken;
  const internalToken = env.CMS_INTERNAL_TOKEN?.trim() || storedToken;
  if (!internalToken) return;
  headers.set("authorization", `Bearer ${internalToken}`);
  const response = await app(
    new Request(
      `http://${host}:${port}/api/internal/reconcile?scheduled=true`,
      {
        method: "POST",
        headers,
      },
    ),
  );
  if (!response.ok) {
    console.error(
      "[echoes-studio] automatic repository sync failed",
      response.status,
      await response.text(),
    );
  }
}

const scheduler = setInterval(() => void runScheduledReconciliation(), 60_000);
scheduler.unref();
const initialScheduler = setTimeout(
  () => void runScheduledReconciliation(),
  3_000,
);
initialScheduler.unref();

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function requestUrl(request: IncomingMessage): URL {
  const authority = request.headers.host || `${host}:${port}`;
  return new URL(request.url || "/", `http://${authority}`);
}

function toFetchRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value))
      for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }
  return new Request(requestUrl(request), init);
}

async function sendFetchResponse(
  response: Response,
  target: ServerResponse,
): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (!response.body) {
    target.end();
    return;
  }
  await new Promise<void>((resolvePromise, reject) => {
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream)
      .on("error", reject)
      .on("end", resolvePromise)
      .pipe(target);
  });
}

async function staticFile(url: URL): Promise<string | null> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const requested =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(publicDirectory, requested);
  if (
    candidate !== publicDirectory &&
    !candidate.startsWith(`${publicDirectory}${sep}`)
  )
    return null;
  try {
    await access(candidate);
    return candidate;
  } catch {
    if (extname(requested)) return null;
    const fallback = resolve(publicDirectory, "index.html");
    try {
      await access(fallback);
      return fallback;
    } catch {
      return null;
    }
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = requestUrl(request);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await sendFetchResponse(await app(toFetchRequest(request)), response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const filename = await staticFile(url);
    if (!filename) {
      response
        .writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        .end("Not found");
      return;
    }
    response.setHeader(
      "content-type",
      contentTypes[extname(filename)] ?? "application/octet-stream",
    );
    response.setHeader("x-content-type-options", "nosniff");
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filename)
      .on("error", (error) => response.destroy(error))
      .pipe(response);
  } catch (error) {
    console.error("[echoes-studio] server error", error);
    if (!response.headersSent) response.writeHead(500);
    response.end("Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`Echoes Studio listening on http://${host}:${port}`);
});

async function shutdown(): Promise<void> {
  clearInterval(scheduler);
  clearTimeout(initialScheduler);
  server.close();
  await database.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
