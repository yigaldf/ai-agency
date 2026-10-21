import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const COLLECTIONS = ['systems', 'tasks', 'days', 'coach'];

// ---------- tiny JSON document store ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch { /* first run */ }
function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- server-sent events for live updates ----------
const clients = new Set();
function broadcast() { for (const res of clients) res.write('data: change\n\n'); }

const app = express();
app.use(express.json({ limit: '1mb' }));

// optional password (HTTP Basic Auth) so the dashboard is not public
if (PASSWORD) {
  app.use((req, res, next) => {
    const h = req.headers.authorization || '';
    const ok = h.startsWith('Basic ') && Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':') === PASSWORD;
    if (ok) return next();
    res.set('WWW-Authenticate', 'Basic realm="dashboard"').status(401).send('Unauthorized');
  });
}

app.get('/healthz', (_req, res) => res.send('ok'));

const validColl = (req, res, next) => (COLLECTIONS.includes(req.params.coll) ? next() : res.status(404).json({ error: 'unknown collection' }));

app.get('/api/state', (_req, res) => res.json(db));
app.get('/api/doc/:coll/:id', validColl, (req, res) => {
  const d = db[req.params.coll][req.params.id];
  res.json(d ?? null);
});
app.put('/api/doc/:coll/:id', validColl, (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'body must be an object' });
  db[req.params.coll][req.params.id] = req.body;
  persist(); broadcast();
  res.status(204).end();
});
app.delete('/api/doc/:coll/:id', validColl, (req, res) => {
  delete db[req.params.coll][req.params.id];
  persist(); broadcast();
  res.status(204).end();
});
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

// ---------- Claude proxy ----------
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
app.get('/api/sample/status', (_req, res) => res.json({ enabled: !!anthropic, model: MODEL }));
app.post('/api/sample', async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set' });
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!messages || !messages.every((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')) {
    return res.status(400).json({ error: 'messages must be [{role, content}]' });
  }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.flushHeaders();
  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: 'low' },
    messages,
  });
  req.on('close', () => stream.controller.abort());
  try {
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') send({ text: ev.delta.text });
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send({ error: 'refusal', code: 'refusal' });
    send({ done: true });
  } catch (e) {
    if (!req.closed) {
      const code = e instanceof Anthropic.RateLimitError ? 'rate_limited' : e instanceof Anthropic.AuthenticationError ? 'not_granted' : 'api_error';
      send({ error: e.message, code });
    }
  } finally { res.end(); }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`dashboard on http://localhost:${PORT} (model ${MODEL}, data ${DB_FILE})`));
