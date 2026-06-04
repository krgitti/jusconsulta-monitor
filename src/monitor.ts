import { db, queries, Monitored } from './db.js';
import { buscarNumeros, buscarDetalhes, hashMovimentacoes, Movimentacao } from './tjsp.js';
import { sendPush, sendEmail } from './notifications.js';

const DELAY_MS = 2000; // delay entre requisições para não sobrecarregar o TJSP
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function processarMonitorado(m: Monitored): Promise<void> {
  console.log(`[MONITOR] Verificando ${m.tipo}=${m.valor} (${m.email})`);

  let numeros: string[];
  try {
    numeros = await buscarNumeros(m.valor, m.tipo as any);
  } catch (err: any) {
    console.warn(`[MONITOR] Falha ao buscar números para ${m.valor}: ${err.message}`);
    return;
  }

  if (numeros.length === 0) {
    console.log(`[MONITOR] Nenhum processo encontrado para ${m.valor}`);
    return;
  }

  console.log(`[MONITOR] ${numeros.length} processo(s) encontrado(s) para ${m.valor}`);

  for (const numero of numeros) {
    await sleep(DELAY_MS);
    try {
      await verificarProcesso(m, numero);
    } catch (err: any) {
      console.warn(`[MONITOR] Falha ao verificar ${numero}: ${err.message}`);
    }
  }
}

async function verificarProcesso(m: Monitored, numero: string): Promise<void> {
  const info = await buscarDetalhes(numero);
  if (!info) return;

  const hash = hashMovimentacoes(info.movimentacoes);
  const existente = queries.getProcesso.get(m.id, numero);

  // Primeira vez vendo esse processo — salvar sem alertar
  if (!existente) {
    queries.upsertProcesso.run({
      monitored_id: m.id,
      numero,
      ultima_mov_data: info.movimentacoes[0]?.data || null,
      ultima_mov_titulo: info.movimentacoes[0]?.titulo || null,
      hash_movs: hash,
      dados_json: JSON.stringify(info),
    });
    console.log(`[MONITOR] Processo ${numero} cadastrado pela primeira vez`);
    return;
  }

  // Sem mudança
  if (existente.hash_movs === hash) {
    console.log(`[MONITOR] ${numero} sem novidades`);
    return;
  }

  // Detectar movimentações novas
  const movsAntigas: Movimentacao[] = existente.dados_json
    ? JSON.parse(existente.dados_json).movimentacoes || []
    : [];

  const datasAntigas = new Set(movsAntigas.map((m: Movimentacao) => `${m.data}|${m.titulo}`));
  const novas = info.movimentacoes.filter(
    mv => !datasAntigas.has(`${mv.data}|${mv.titulo}`)
  );

  console.log(`[MONITOR] ${numero} — ${novas.length} nova(s) movimentação(ões)!`);

  // Atualizar DB
  queries.upsertProcesso.run({
    monitored_id: m.id,
    numero,
    ultima_mov_data: info.movimentacoes[0]?.data || null,
    ultima_mov_titulo: info.movimentacoes[0]?.titulo || null,
    hash_movs: hash,
    dados_json: JSON.stringify(info),
  });

  const processoRow = queries.getProcesso.get(m.id, numero)!;
  const titulo = `Nova movimentação — ${numero}`;
  const corpo = novas[0]?.titulo || 'Processo atualizado';

  // Registrar alerta no DB
  queries.insertAlerta.run(processoRow.id, 'movimentacao', corpo);

  // Disparar push se houver token
  if (m.fcm_token) {
    try {
      await sendPush(m.fcm_token, titulo, corpo, {
        numero,
        data: novas[0]?.data || '',
      });
    } catch (err: any) {
      console.error(`[PUSH] Falha: ${err.message}`);
    }
  }

  // Disparar e-mail
  try {
    await sendEmail(m.email, numero, novas.slice(0, 10));
  } catch (err: any) {
    console.error(`[EMAIL] Falha: ${err.message}`);
  }
}

export async function runMonitorCycle(): Promise<void> {
  const ativos = queries.getAllActive.all();
  console.log(`\n[MONITOR] Iniciando ciclo — ${ativos.length} item(ns) monitorado(s)`);

  for (const m of ativos) {
    await processarMonitorado(m);
    await sleep(DELAY_MS);
  }

  console.log(`[MONITOR] Ciclo concluído\n`);
}
