/**
 * Static server that Brotli-compresses js/css/csv/json/html on the fly, with
 * `Content-Encoding: br`, to approximate what Cloudflare Pages actually serves.
 *
 * Why this matters for verification: `vite preview` serves everything identity.
 * Every wall-clock and byte figure measured against it is pessimistic in a way
 * real deployments are not — the CSV (226 KB) and the JS bundle (333 KB) both
 * drop by roughly 4-5x on the wire. Any "is the boot fast enough" judgement made
 * against identity encoding is measuring the wrong network.
 *
 * Part of the committed E2E harness: case c and d timings are only meaningful
 * against compressed responses, because production is compressed.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { brotliCompress, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);

const ROOT = resolve(process.argv[2] || 'dist');
const PORT = Number(process.argv[3] || 4197);

// Cloudflare compresses these; images/parquet/wasm are already compressed.
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.csv', '.json', '.html', '.svg', '.txt', '.map']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.parquet': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
};

const stats = { compressed: 0, raw: 0, bytesOut: 0, bytesIn: 0, notModified: 0 };

async function resolveFile(urlPath) {
  // Strip query/hash, decode, and confine to ROOT (no traversal).
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = normalize(clean).replace(/^([/\\])+/, '');
  let full = join(ROOT, rel);

  if (!full.startsWith(ROOT)) return null;

  let st;
  try {
    st = await stat(full);
  } catch {
    return null;
  }

  if (st.isDirectory()) {
    full = join(full, 'index.html');
    try {
      st = await stat(full);
    } catch {
      return null;
    }
  }

  return { full, st };
}

/** Content-addressed ETag, like Cloudflare's. */
async function etagFor(full, st) {
  // Cheap and stable: size + mtime is enough for a static build.
  return `"${createHash('sha1').update(`${st.size}-${st.mtimeMs}`).digest('base64url').slice(0, 20)}"`;
}

const server = createServer(async (req, res) => {
  const found = await resolveFile(req.url || '/');

  // SPA fallback, matching public/_redirects.
  const target = found ?? (await resolveFile('/index.html'));
  if (!target) {
    res.writeHead(404).end('not found');
    return;
  }

  const { full, st } = target;
  const ext = extname(full).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const acceptsBr = /\bbr\b/.test(req.headers['accept-encoding'] || '');

  res.setHeader('Content-Type', type);

  // Cloudflare Pages sends immutable caching for hashed assets and ETags with
  // 304 support for everything else. The previous version sent `no-cache` with
  // NO ETag, which forced a full re-download on every conditional request — that
  // made the per-host worker measurement meaningless (the browser had no way to
  // revalidate, so it refetched).
  const immutable =
    ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.wasm' || /\/assets\//.test(req.url || '');
  const etag = await etagFor(full, st);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');

  // Honour a conditional request exactly as Pages does.
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    stats.notModified += 1;
    return;
  }

  if (acceptsBr && COMPRESSIBLE.has(ext)) {
    const buf = await readFile(full);
    // Quality 11 is Cloudflare-like; 5 is close enough and far faster. Use 11 to
    // match real Pages output sizes as closely as possible.
    const out = await brotli(buf, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    });

    res.setHeader('Content-Encoding', 'br');
    res.setHeader('Vary', 'Accept-Encoding');
    // Content-Length is the ENCODED length, as Cloudflare reports it.
    res.setHeader('Content-Length', String(out.length));
    res.writeHead(200);
    res.end(out);

    stats.compressed += 1;
    stats.bytesIn += buf.length;
    stats.bytesOut += out.length;
    return;
  }

  res.setHeader('Content-Length', String(st.size));
  res.writeHead(200);
  createReadStream(full).pipe(res);

  stats.raw += 1;
  stats.bytesIn += st.size;
  stats.bytesOut += st.size;
});

server.listen(PORT, () => {
  console.log(`[brotli-server] serving ${ROOT} on http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(
      `[brotli-server] br=${stats.compressed} raw=${stats.raw} 304=${stats.notModified} in=${(stats.bytesIn / 1024).toFixed(0)}KB out=${(stats.bytesOut / 1024).toFixed(0)}KB`,
    );
    server.close(() => process.exit(0));
  });
}
