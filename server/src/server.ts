import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { analyzeProcess } from './analysisService.js';
import { buildChildren, getProcess, listProcesses } from './processService.js';
import { listNetwork } from './networkService.js';
import { getSystemHistory, getSystemSnapshot } from './systemService.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const pidSchema = z.coerce.number().int().nonnegative();
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/system', async (_req, res, next) => { try { res.json(await getSystemSnapshot()); } catch (error) { next(error); } });
app.get('/api/system/history', (_req, res) => res.json(getSystemHistory()));
app.get('/api/processes', async (_req, res, next) => { try { res.json(await listProcesses()); } catch (error) { next(error); } });
app.get('/api/processes/:pid', async (req, res, next) => { try { const pid = pidSchema.parse(req.params.pid); const processes = await listProcesses(); const process = getProcess(pid, processes); if (!process) return res.status(404).json({ message: 'Process is no longer running or is unavailable.' }); res.json(process); } catch (error) { next(error); } });
app.get('/api/processes/:pid/children', async (req, res, next) => { try { const pid = pidSchema.parse(req.params.pid); res.json(buildChildren(pid, await listProcesses())); } catch (error) { next(error); } });
app.get('/api/analysis/:pid', async (req, res, next) => { try { const pid = pidSchema.parse(req.params.pid); const processes = await listProcesses(); const process = getProcess(pid, processes); if (!process) return res.status(404).json({ message: 'Process is no longer running.' }); res.json(analyzeProcess(process, buildChildren(pid, processes).length)); } catch (error) { next(error); } });
app.get('/api/network', async (_req, res, next) => { try { res.json(await listNetwork()); } catch (error) { next(error); } });
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { const message = error instanceof Error ? error.message : 'Unexpected server error'; res.status(400).json({ message }); });
app.listen(port, () => console.log(`PSA server listening on http://localhost:${port}`));
