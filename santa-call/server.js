// Call Santa server: serves the web app and relays each call between the
// browser and Gemini Live, so API credentials and Santa's instructions never
// reach the browser.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';
import { GeminiSantaSession } from './lib/gemini-session.js';
import { MockSantaSession } from './lib/mock-session.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  // No .env file; rely on the real environment.
}

export function resolveConfig(env = process.env) {
  let backend = env.SANTA_BACKEND;
  if (!backend) {
    if (env.GOOGLE_CLOUD_PROJECT) backend = 'vertex';
    else if (env.GEMINI_API_KEY) backend = 'gemini-api';
    else backend = 'mock';
  }
  if (!['vertex', 'gemini-api', 'mock'].includes(backend)) {
    throw new Error(`SANTA_BACKEND must be vertex, gemini-api, or mock (got "${backend}")`);
  }
  return {
    port: Number(env.PORT) || 8787,
    host: env.HOST || '127.0.0.1',
    backend,
    model: env.SANTA_MODEL || 'gemini-3.8-live',
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    apiKey: env.GEMINI_API_KEY,
    accessCode: env.SANTA_ACCESS_CODE || '',
    maxSessions: Number(env.MAX_SESSIONS) || 5,
    maxCallMinutes: Number(env.MAX_CALL_MINUTES) || 30,
    textMode: env.SANTA_TEXT_INPUT === 'realtime' ? 'realtime' : 'client-content',
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

function createAi(config) {
  if (config.backend === 'vertex') {
    if (!config.project) throw new Error('GOOGLE_CLOUD_PROJECT is required for the vertex backend');
    return new GoogleGenAI({ vertexai: true, project: config.project, location: config.location });
  }
  if (config.backend === 'gemini-api') {
    if (!config.apiKey) throw new Error('GEMINI_API_KEY is required for the gemini-api backend');
    return new GoogleGenAI({ apiKey: config.apiKey });
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const STATIC_ROOTS = {
  '/shared/': resolve(ROOT, 'shared'),
  '/': resolve(ROOT, 'public'),
};

async function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  const prefix = Object.keys(STATIC_ROOTS).find((p) => pathname.startsWith(p));
  const base = STATIC_ROOTS[prefix];
  const file = resolve(base, `.${pathname.slice(prefix.length - 1)}`);
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

function codesMatch(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function originAllowed(req, config) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (config.allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createSantaServer(config = resolveConfig(), { log = console } = {}) {
  const ai = createAi(config);
  const live = new Set();

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        backend: config.backend,
        model: config.backend === 'mock' ? null : config.model,
        needsAccessCode: Boolean(config.accessCode),
      }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    await serveStatic(req, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://local');
    if (pathname !== '/ws/call' || !originAllowed(req, config)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    let session = null;
    let starting = false;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const emit = {
      audio: (buf) => {
        if (ws.readyState === ws.OPEN) ws.send(buf, { binary: true });
      },
      json: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
        if (msg.type === 'ended') {
          live.delete(session);
          ws.close(1000, 'call ended');
        }
      },
    };
    const fail = (message) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message }));
      ws.close(1000, 'error');
    };

    ws.on('message', async (data, isBinary) => {
      if (isBinary) {
        if (data.length % 2 === 0) session?.pushAudio(data);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'start': {
          if (session || starting) return;
          if (config.accessCode && !codesMatch(msg.accessCode, config.accessCode)) {
            fail('That access code is not right. Check with whoever set up this Santa line.');
            return;
          }
          if (live.size >= config.maxSessions) {
            fail("Santa is on too many calls right now. Please try again in a few minutes.");
            return;
          }
          starting = true;
          const args = {
            ai,
            model: config.model,
            profile: msg.profile,
            options: { pushToTalk: Boolean(msg.options?.pushToTalk), allowInterrupt: Boolean(msg.options?.allowInterrupt) },
            emit,
            textMode: config.textMode,
            maxMinutes: config.maxCallMinutes,
            log,
          };
          session = config.backend === 'mock' ? new MockSantaSession(args) : new GeminiSantaSession(args);
          live.add(session);
          try {
            await session.start();
            if (ws.readyState !== ws.OPEN) session.close('client-left');
          } catch (err) {
            log.error('[santa] could not start call:', err?.message ?? err);
            live.delete(session);
            session.close('start-failed');
            fail("Couldn't reach the North Pole. Check the server logs for details.");
          }
          return;
        }
        case 'hint':
          session?.sendHint(String(msg.text ?? '').slice(0, 400));
          return;
        case 'activityStart':
          session?.activityStart();
          return;
        case 'activityEnd':
          session?.activityEnd();
          return;
        case 'end':
          session?.close('hung-up');
          return;
        default:
      }
    });

    ws.on('close', () => {
      if (session) {
        session.close('client-left');
        live.delete(session);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));

  return server;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = resolveConfig();
  const server = createSantaServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`🎅 Call Santa is running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    if (config.backend === 'mock') {
      console.log('   Demo mode: no AI connected. Santa will hum canned lines. See README to connect Gemini.');
    } else {
      console.log(`   Backend: ${config.backend} · model: ${config.model}`);
    }
    if (config.backend === 'gemini-api') {
      console.warn('   ⚠  The Gemini Developer API terms do not allow apps used by people under 18.');
      console.warn('      Use this backend only for adult testing. Use SANTA_BACKEND=vertex for real calls with kids.');
    }
  });
}
