import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { encodeEscPosReceipt, encodeTestSlip } from './escpos.mjs';
import { defaultTransportDispatch, discoverPrinters } from './transports.mjs';

export const BRIDGE_VERSION = '1.0.0';
const DEFAULT_PORT = 19800;

const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)?autodine\.in$/i,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/[a-z0-9-]+\.e2b\.app$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^http:\/\/localhost(?::\d+)?$/i,
];

export function isAllowedOrigin(origin, extraOrigins = []) {
  if (!origin) return true; // Local CLI / curl without browser Origin header
  if (extraOrigins.includes(origin)) return true;
  return DEFAULT_ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

function getDefaultConfigDir() {
  if (process.env.AUTODINE_BRIDGE_CONFIG_DIR) return process.env.AUTODINE_BRIDGE_CONFIG_DIR;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'AutoDinePrintBridge');
  }
  return path.join(process.env.HOME || '.', '.autodine-print-bridge');
}

export function loadOrCreateConfig(configDir = getDefaultConfigDir()) {
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      config = {};
    }
  }
  if (!config.pairingToken) {
    config.pairingToken = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }
  return { configDir, configPath, config };
}

function readJsonBody(req, limitBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function setCorsHeaders(res, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  // Chrome Private Network Access (PNA): required for https:// web apps calling http://127.0.0.1
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AutoDine-Bridge-Token, Idempotency-Key');
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function createPrintBridgeServer(options = {}) {
  const { configDir, config } = options.config
    ? { configDir: options.configDir || getDefaultConfigDir(), config: options.config }
    : loadOrCreateConfig(options.configDir);

  const extraOrigins = String(process.env.AUTODINE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .concat(Array.isArray(config.allowedOrigins) ? config.allowedOrigins : []);

  const queuePath = path.join(configDir, 'queue.json');
  const jobs = new Map();
  const idempotencyIndex = new Map();
  const dispatchTransport = options.dispatchTransport || ((target, bytes) => defaultTransportDispatch(target, bytes, config));
  const listPrinters = options.discoverPrinters || (() => discoverPrinters(config));

  if (fs.existsSync(queuePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
      for (const j of Array.isArray(saved) ? saved : []) {
        jobs.set(j.id, j);
        if (j.idempotencyKey) idempotencyIndex.set(j.idempotencyKey, j.id);
      }
    } catch {
      // Ignore corrupt queue cache and rebuild cleanly.
    }
  }

  function persistQueue() {
    try {
      const recent = Array.from(jobs.values()).slice(-200);
      fs.writeFileSync(queuePath, JSON.stringify(recent, null, 2), 'utf8');
    } catch {
      // Ignore disk write errors in ephemeral test mode.
    }
  }

  async function processJob(jobRecord, payloadBytes) {
    jobRecord.status = 'printing';
    jobRecord.attempts += 1;
    jobRecord.updatedAt = new Date().toISOString();
    persistQueue();

    const maxRetries = 2;
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        await dispatchTransport(jobRecord.printerTarget, payloadBytes);
        jobRecord.status = 'completed';
        jobRecord.error = null;
        jobRecord.completedAt = new Date().toISOString();
        jobRecord.updatedAt = jobRecord.completedAt;
        persistQueue();
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        }
      }
    }

    jobRecord.status = 'failed';
    jobRecord.error = lastError || 'Unknown printer transport failure';
    jobRecord.updatedAt = new Date().toISOString();
    persistQueue();
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin, extraOrigins)) {
      sendJson(res, 403, { ok: false, error: 'Origin is not allowlisted by AutoDine Print Bridge.' });
      return;
    }
    setCorsHeaders(res, origin);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        version: BRIDGE_VERSION,
        platform: process.platform,
        pairingRequired: true,
        queuedJobs: Array.from(jobs.values()).filter((j) => j.status === 'queued' || j.status === 'printing').length,
      });
      return;
    }

    const suppliedToken = String(req.headers['x-autodine-bridge-token'] || '').trim();
    const expectedToken = String(config.pairingToken || '');
    const tokenOk =
      suppliedToken.length === expectedToken.length &&
      expectedToken.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(expectedToken));
    if (!tokenOk) {
      sendJson(res, 401, { ok: false, error: 'Invalid or missing X-AutoDine-Bridge-Token.' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/printers') {
      const printers = await listPrinters();
      sendJson(res, 200, { ok: true, printers });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/test-print') {
      const body = await readJsonBody(req).catch((e) => ({ __error: e.message }));
      if (body.__error) {
        sendJson(res, 400, { ok: false, error: body.__error });
        return;
      }
      const bytes = encodeTestSlip(body.paperWidth || '80mm', body.restaurantName || 'AutoDine');
      try {
        await dispatchTransport(body.printerTarget || {}, bytes);
        sendJson(res, 200, { ok: true, message: 'Test slip printed.' });
      } catch (err) {
        sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/print') {
      const body = await readJsonBody(req).catch((e) => ({ __error: e.message }));
      if (body.__error) {
        sendJson(res, 400, { ok: false, error: body.__error });
        return;
      }
      if (!body.invoiceId || !body.invoiceNumber) {
        sendJson(res, 400, { ok: false, error: 'invoiceId and invoiceNumber are required.' });
        return;
      }
      const idempotencyKey = String(
        req.headers['idempotency-key'] || body.idempotencyKey || `${body.invoiceId}:copy-${Math.max(1, Number(body.copyNumber ?? 1))}`,
      );
      const existingId = idempotencyIndex.get(idempotencyKey);
      if (existingId && jobs.has(existingId)) {
        const existing = jobs.get(existingId);
        sendJson(res, 202, { ok: true, jobId: existing.id, status: existing.status, deduplicated: true });
        return;
      }

      const bytes = encodeEscPosReceipt(body);
      const jobRecord = {
        id: crypto.randomUUID(),
        idempotencyKey,
        invoiceId: body.invoiceId,
        invoiceNumber: body.invoiceNumber,
        copyNumber: Number(body.copyNumber ?? 1),
        printerTarget: body.printerTarget || {},
        status: 'queued',
        attempts: 0,
        error: null,
        payloadBase64: bytes.toString('base64'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobs.set(jobRecord.id, jobRecord);
      idempotencyIndex.set(idempotencyKey, jobRecord.id);
      persistQueue();

      void processJob(jobRecord, bytes);
      sendJson(res, 202, { ok: true, jobId: jobRecord.id, status: 'queued' });
      return;
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]));
      if (!job) {
        sendJson(res, 404, { ok: false, error: 'Print job not found.' });
        return;
      }
      sendJson(res, 200, {
        id: job.id,
        status: job.status,
        attempts: job.attempts,
        error: job.error,
        invoiceNumber: job.invoiceNumber,
        copyNumber: job.copyNumber,
      });
      return;
    }

    const retryMatch = url.pathname.match(/^\/jobs\/([^/]+)\/retry$/);
    if (req.method === 'POST' && retryMatch) {
      const job = jobs.get(decodeURIComponent(retryMatch[1]));
      if (!job) {
        sendJson(res, 404, { ok: false, error: 'Print job not found.' });
        return;
      }
      const bytes = Buffer.from(job.payloadBase64, 'base64');
      job.status = 'queued';
      job.error = null;
      void processJob(job, bytes);
      sendJson(res, 202, { ok: true, jobId: job.id, status: 'queued' });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  });

  return { server, pairingToken: config.pairingToken, configDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.AUTODINE_BRIDGE_PORT || DEFAULT_PORT);
  const { server, pairingToken, configDir } = createPrintBridgeServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`[AutoDine Print Bridge v${BRIDGE_VERSION}] listening on http://127.0.0.1:${port}`);
    console.log(`[AutoDine Print Bridge] config dir: ${configDir}`);
    console.log(`[AutoDine Print Bridge] Pairing Token: ${pairingToken}`);
  });
}
