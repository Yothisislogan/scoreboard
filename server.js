#!/usr/bin/env node
// Local server for the scoreboard: serves the static site and relays
// /espn/* to ESPN's public API, which the app falls back to if a browser
// or network blocks the direct request. No dependencies required.

import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const ESPN_ORIGIN = 'https://site.api.espn.com';
const ESPN_PATH = /^\/apis\/(?:site\/)?v2\/sports\/football\/[\w\-/]+$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/plain; charset=utf-8',
};

function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

async function relayToEspn(res, url) {
  const path = url.pathname.slice('/espn'.length);
  if (!ESPN_PATH.test(path)) return send(res, 404, 'Not found');
  try {
    const upstream = await fetch(`${ESPN_ORIGIN}${path}${url.search}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    send(res, 502, JSON.stringify({ error: 'ESPN is unreachable' }), { 'content-type': 'application/json' });
  }
}

async function serveFile(req, res, url, root) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  // No dotfiles (.git, .github) and no parent-directory segments.
  if (pathname.split('/').some((part) => part.startsWith('.'))) return send(res, 404, 'Not found');
  if (pathname.endsWith('/')) pathname += 'index.html';
  const base = root.endsWith(sep) ? root : root + sep;
  const file = resolve(base, `.${pathname}`);
  if (!file.startsWith(base)) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      res.writeHead(301, { location: `${url.pathname}/` });
      return res.end();
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, 'Not found');
  }
}

export function createServer({ root = ROOT } = {}) {
  return createHttpServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/espn/')) return relayToEspn(res, url);
    return serveFile(req, res, url, root);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Gridiron Scoreboard is running at http://${shown}:${server.address().port}`);
  });
}
