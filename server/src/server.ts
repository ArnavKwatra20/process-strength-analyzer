import express from 'express';
import cors from 'cors';
import { timingSafeEqual } from 'node:crypto';
import { config as loadEnvironment } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { analyzeProcess } from './analysisService.js';
import { getServiceMeta } from './metaService.js';
import { buildChildren, getProcess, listProcesses, resolveProcessOwner } from './processService.js';
import { listNetwork } from './networkService.js';
import { getSystemHistory, getSystemSnapshot } from './systemService.js';

// The server runs with `server/` as its working directory, so the repository-root `.env` that the
// README documents and the Vite proxy reads is loaded by path. `server/.env` is optional and is
// loaded first, because the first file to define a variable is the one that wins.
loadEnvironment({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
loadEnvironment({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const app = express();
const port = Number(process.env.PORT ?? 4000);
const pidSchema = z.coerce.number().int().nonnegative();
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
	.split(',').map((origin) => origin.trim()).filter(Boolean);
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const rateWindowMs = 60_000;
// The interface polls four read-only routes per refresh, so the ceiling must stay above the
// fastest supported cadence (4 requests per second at the 1 second interval).
const rateLimit = 600;

app.disable('x-powered-by');
app.use((_, res, next) => {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	res.setHeader('Cache-Control', 'no-store');
	next();
});
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); const error = new Error('Origin not allowed') as Error & { status?: number }; error.status = 403; return callback(error); } }));
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
	const key = req.ip ?? 'unknown';
	const now = Date.now();
	const current = requestCounts.get(key);
	const entry = !current || current.resetAt <= now ? { count: 1, resetAt: now + rateWindowMs } : { count: current.count + 1, resetAt: current.resetAt };
	requestCounts.set(key, entry);
	if (entry.count > rateLimit) return res.status(429).json({ message: 'Too many requests.' });
	return next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
	const expected = process.env.API_AUTH_TOKEN;
	if (!expected) return res.status(503).json({ message: 'API authentication is not configured.' });
	const authorization = req.header('authorization') ?? '';
	const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
	const expectedBuffer = Buffer.from(expected);
	const providedBuffer = Buffer.from(provided);
	if (!provided || expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) return res.status(401).json({ message: 'Unauthorized.' });
	return next();
}

app.use('/api', authenticate);
app.get('/api/meta', (_req, res) => res.json(getServiceMeta()));
app.get('/api/system', async (_req, res, next) => { try { res.json(await getSystemSnapshot()); } catch (error) { next(error); } });
app.get('/api/system/history', (_req, res) => res.json(getSystemHistory()));
app.get('/api/processes', async (_req, res, next) => { try { res.json(await listProcesses()); } catch (error) { next(error); } });
app.get('/api/processes/:pid', async (req, res, next) => { try { const pid = pidSchema.parse(req.params.pid); const processes = await listProcesses(); const process = getProcess(pid, processes); if (!process) return res.status(404).json({ message: 'Process is no longer running or is unavailable.' }); const user = process.user ?? await resolveProcessOwner(pid); res.json({ ...process, user }); } catch (error) { next(error); } });
app.get('/api/processes/:pid/children', async (req, res, next) => { try { const pid = pidSchema.parse(req.params.pid); res.json(buildChildren(pid, await listProcesses())); } catch (error) { next(error); } });
app.get('/api/analysis/:pid', async (req, res, next) => { try { const pid = pidSchema.parse(req.params.pid); const processes = await listProcesses(); const process = getProcess(pid, processes); if (!process) return res.status(404).json({ message: 'Process is no longer running.' }); res.json(analyzeProcess(process, buildChildren(pid, processes).length)); } catch (error) { next(error); } });
app.get('/api/network', async (_req, res, next) => { try { res.json(await listNetwork()); } catch (error) { next(error); } });
app.use((_req, res) => res.status(404).json({ message: 'Not found.' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (res.headersSent) return; const status = error instanceof z.ZodError ? 400 : typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500; if (status >= 500) console.error('[psa] request failed:', error instanceof Error ? error.message : String(error)); res.status(status).json({ message: status === 400 ? 'Invalid request.' : status === 403 ? 'Origin not allowed.' : 'Request could not be completed.' }); });
app.listen(port, () => console.log(`PSA server listening on http://localhost:${port}`));
