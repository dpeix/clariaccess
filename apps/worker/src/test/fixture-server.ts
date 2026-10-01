import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";

const fixturesDir = new URL("./fixtures/", import.meta.url);

export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
) => boolean | Promise<boolean>;

export interface FixtureServer {
  origin: string;
  // Paths requested, so tests can prove a request never reached the server.
  hits: string[];
  close: () => Promise<void>;
}

// Serves test/fixtures/<name>.html at /<name>.html. `custom` handles a request
// first and returns true when it answered it.
export async function startFixtureServer(
  custom?: Handler,
): Promise<FixtureServer> {
  const hits: string[] = [];
  let origin = "";
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://fixture").pathname;
      hits.push(path);
      if (custom !== undefined && (await custom(req, res, origin))) return;
      const name = path.slice(1);
      if (!/^[a-z-]+\.html$/.test(name)) {
        res.writeHead(404).end();
        return;
      }
      try {
        const body = await readFile(new URL(name, fixturesDir));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
