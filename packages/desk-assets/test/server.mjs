import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { deskAssetsDirectory } from "../index.js";
const port = Number(process.env.FRAMEKIT_DESK_ASSETS_PORT ?? 4187);
const root = deskAssetsDirectory();
createServer(async (request, response) => {
  const path = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (!path.startsWith("/desk/")) return response.writeHead(404).end();
  if (path === "/desk/framekit-config.js") return response.writeHead(200, { "content-type": "application/javascript" }).end("window.__FRAMEKIT_CONFIG__={version:1,apiUrl:'http://127.0.0.1:45124'};");
  const relative = path.slice(6) || "index.html";
  try {
    const file = join(root, normalize(relative));
    const type = file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
    response.writeHead(200, { "content-type": type }).end(await readFile(file));
  } catch { response.writeHead(404).end(); }
}).listen(port, "127.0.0.1");
