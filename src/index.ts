import 'dotenv/config';
import cron from 'node-cron';
import { app } from './api.js';
import { runMonitorCycle } from './monitor.js';

const PORT = Number(process.env.PORT) || 3000;

// ── Cron: verificar a cada 4 horas ───────────────────────────────────────────
// '0 */4 * * *' = às 00:00, 04:00, 08:00, 12:00, 16:00, 20:00
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 */4 * * *';

cron.schedule(CRON_SCHEDULE, () => {
  runMonitorCycle().catch(console.error);
}, { timezone: 'America/Sao_Paulo' });

console.log(`[CRON] Agendado: "${CRON_SCHEDULE}" (America/Sao_Paulo)`);

// ── HTTP Server ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SERVER] JusConsulta Monitor rodando na porta ${PORT}`);
  console.log(`[SERVER] Health: http://localhost:${PORT}/health`);
});

// Rodar um ciclo na inicialização (aguarda 10s para o servidor estabilizar)
setTimeout(() => {
  console.log('[SERVER] Rodando ciclo inicial de monitoramento...');
  runMonitorCycle().catch(console.error);
}, 10_000);
