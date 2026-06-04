import express, { Request, Response } from 'express';
import { z } from 'zod';
import { queries } from './db.js';
import { runMonitorCycle } from './monitor.js';

export const app = express();
app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Cadastrar monitoramento ───────────────────────────────────────────────────
const CadastroSchema = z.object({
  tipo: z.enum(['cpf', 'cnpj', 'numero', 'nome']),
  valor: z.string().min(3),
  label: z.string().optional(),
  email: z.string().email(),
  fcm_token: z.string().optional(),
});

app.post('/api/monitor', (req: Request, res: Response) => {
  const parsed = CadastroSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors });
    return;
  }
  const { tipo, valor, label, email, fcm_token } = parsed.data;

  // Normalizar CPF/CNPJ
  const valorNorm = (tipo === 'cpf' || tipo === 'cnpj')
    ? valor.replace(/\D/g, '')
    : valor.trim();

  queries.insert.run({ tipo, valor: valorNorm, label: label || null, email, fcm_token: fcm_token || null });
  const todos = queries.listMonitored.all(email);
  res.json({ ok: true, monitorados: todos });
});

// ── Listar monitoramentos por e-mail ──────────────────────────────────────────
app.get('/api/monitor', (req: Request, res: Response) => {
  const email = req.query.email as string;
  if (!email) { res.status(400).json({ error: 'email obrigatório' }); return; }
  res.json(queries.listMonitored.all(email));
});

// ── Remover monitoramento ─────────────────────────────────────────────────────
app.delete('/api/monitor/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  queries.deactivate.run(id);
  res.json({ ok: true });
});

// ── Atualizar FCM token ───────────────────────────────────────────────────────
app.patch('/api/monitor/:id/fcm', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { fcm_token } = req.body;
  if (!fcm_token) { res.status(400).json({ error: 'fcm_token obrigatório' }); return; }
  queries.updateFcmToken.run(fcm_token, id);
  res.json({ ok: true });
});

// ── Trigger manual (protegido por chave) ──────────────────────────────────────
app.post('/api/monitor/run', async (req: Request, res: Response) => {
  const key = req.headers['x-api-key'];
  if (key !== process.env.ADMIN_KEY) {
    res.status(401).json({ error: 'não autorizado' }); return;
  }
  res.json({ ok: true, message: 'Ciclo de monitoramento iniciado' });
  runMonitorCycle().catch(console.error);
});
