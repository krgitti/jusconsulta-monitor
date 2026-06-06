/**
 * JusConsulta Monitor — GitHub Actions + Gmail + Gist
 *
 * Sem banco, sem servidor, sem cadastro externo.
 * Estado persistido num GitHub Gist privado (JSON).
 * E-mail via Gmail SMTP com nodemailer.
 *
 * Variáveis de ambiente (GitHub Secrets):
 *   MONITOR_CPF       — CPF ou CNPJ a monitorar (só números)
 *   MONITOR_EMAIL     — e-mail que receberá os alertas
 *   GMAIL_USER        — seu Gmail (ex: kleber@gmail.com)
 *   GMAIL_APP_PASS    — senha de app do Gmail (16 chars, sem espaços)
 *   GIST_TOKEN        — GitHub token com escopo gist (pode ser o mesmo PAT)
 *   GIST_ID           — ID do gist criado automaticamente na 1ª execução
 *                       (deixar vazio na 1ª vez; o script cria e exibe o ID)
 */

import { createTransport } from 'nodemailer';
import { parse } from 'node-html-parser';

// ── Config ────────────────────────────────────────────────────────────────────

const CPF          = (process.env.MONITOR_CPF  || '').replace(/\D/g, '');
const NOME         = process.env.MONITOR_NOME  || '';   // alternativa ao CPF
const EMAIL_TO     = process.env.MONITOR_EMAIL || '';
const GMAIL_USER   = process.env.GMAIL_USER    || '';
const GMAIL_PASS   = process.env.GMAIL_APP_PASS|| '';
const GIST_TOKEN   = process.env.GIST_TOKEN    || '';
let   GIST_ID      = process.env.GIST_ID       || '';

if (!EMAIL_TO || !GMAIL_USER || !GMAIL_PASS || !GIST_TOKEN) {
  console.error('❌ Variáveis obrigatórias ausentes: MONITOR_EMAIL, GMAIL_USER, GMAIL_APP_PASS, GIST_TOKEN');
  process.exit(1);
}
if (!CPF && !NOME) {
  console.error('❌ Defina MONITOR_CPF ou MONITOR_NOME');
  process.exit(1);
}

const TIMEOUT = 15_000;
const PROXIES = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

// ── Fetch com fallback de proxies ─────────────────────────────────────────────

async function fetchHtml(url) {
  for (const proxy of PROXIES) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
      const res  = await fetch(proxy(url), {
        signal: ctrl.signal,
        headers: { 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' },
      });
      clearTimeout(tid);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.length < 300) continue;
      return text;
    } catch { continue; }
  }
  throw new Error(`Todos os proxies falharam para: ${url}`);
}

// ── Scraping TJSP ─────────────────────────────────────────────────────────────

function extrairNumeros(html) {
  return [...new Set([...html.matchAll(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g)].map(m => m[0]))];
}

async function buscarNumerosPorDoc(cpf) {
  const sistemas = ['cpopg', 'cposg'];
  const numeros  = [];
  for (const s of sistemas) {
    try {
      const url  = `https://esaj.tjsp.jus.br/${s}/search.do?conversationId=&paginaConsulta=0&cbPesquisa=DOCPARTE&dePesquisa=${cpf}`;
      const html = await fetchHtml(url);
      for (const n of extrairNumeros(html)) {
        if (!numeros.includes(n)) numeros.push(n);
      }
    } catch (e) { console.warn(`  [WARN] ${s}: ${e.message}`); }
  }
  return numeros;
}

async function buscarNumerosPorNome(nome) {
  const sistemas = ['cpopg', 'cposg'];
  const numeros  = [];
  for (const s of sistemas) {
    try {
      const url  = `https://esaj.tjsp.jus.br/${s}/search.do?conversationId=&paginaConsulta=0&cbPesquisa=NMPARTE&dePesquisa=${encodeURIComponent(nome)}`;
      const html = await fetchHtml(url);
      for (const n of extrairNumeros(html)) {
        if (!numeros.includes(n)) numeros.push(n);
      }
    } catch (e) { console.warn(`  [WARN] ${s}: ${e.message}`); }
  }
  return numeros;
}

async function buscarMovimentacoes(numero) {
  const m = numero.match(/(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})/);
  if (!m) return [];
  const digitoAno = `${m[1]}-${m[2]}.${m[3]}`;
  const oooo      = m[6];
  const url = `https://esaj.tjsp.jus.br/cpopg/search.do?conversationId=&cbPesquisa=NUMPROC`
            + `&numeroDigitoAnoUnificado=${digitoAno}&foroNumeroUnificado=${oooo}`
            + `&dePesquisaNuUnificado=${encodeURIComponent(numero)}&tipoNuProcesso=UNIFICADO`;

  const html = await fetchHtml(url);
  const root = parse(html);
  const movs = [];
  const seen = new Set();

  for (const tabela of ['#tabelaTodasMovimentacoes','#tabelaUltimasMovimentacoes']) {
    const el = root.querySelector(tabela);
    if (!el) continue;
    for (const row of el.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      const data  = (row.querySelector('.dataMovimentacao')?.text || cells[0]?.text || '').trim().replace(/\s+/g,' ');
      const titulo= (row.querySelector('.descricaoMovimentacao')?.text || cells[2]?.text || cells[1]?.text || '').trim().replace(/\s+/g,' ');
      if (data && titulo && /\d{2}\/\d{2}\/\d{4}/.test(data)) {
        const key = `${data}|${titulo}`;
        if (!seen.has(key)) { seen.add(key); movs.push({ data, titulo }); }
      }
    }
    if (movs.length) break;
  }
  return movs;
}

// ── Estado no Gist ────────────────────────────────────────────────────────────

async function lerEstado() {
  if (!GIST_ID) return {};
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GIST_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const content = data.files?.['monitor-state.json']?.content;
    return content ? JSON.parse(content) : {};
  } catch { return {}; }
}

async function salvarEstado(estado) {
  const body = JSON.stringify({
    description: 'JusConsulta Monitor — estado interno (não editar)',
    public: false,
    files: { 'monitor-state.json': { content: JSON.stringify(estado, null, 2) } },
  });

  if (!GIST_ID) {
    // Criar gist pela primeira vez
    const res  = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: { Authorization: `token ${GIST_TOKEN}`, 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json();
    GIST_ID    = data.id;
    console.log(`\n✅ Gist criado! Adicione este ID ao secret GIST_ID: ${GIST_ID}\n`);
  } else {
    await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: { Authorization: `token ${GIST_TOKEN}`, 'Content-Type': 'application/json' },
      body,
    });
  }
}

// ── E-mail ────────────────────────────────────────────────────────────────────

async function enviarEmailNovoProcesso(numero, movs) {
  const transport = createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  const ultimaMov = movs[0];
  const linhas = movs.slice(0, 5).map(m => `
    <tr>
      <td style="padding:8px 14px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap">${m.data}</td>
      <td style="padding:8px 14px;border-bottom:1px solid #1e293b;color:#e2e8f0">${m.titulo}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
<div style="background:#1e293b;border-radius:14px;overflow:hidden;border:1px solid #334155">
  <div style="background:linear-gradient(135deg,#3b82f618,#1e293b);padding:22px 24px;border-bottom:1px solid #334155">
    <span style="font-size:26px">⚖️</span>
    <span style="color:#3b82f6;font-size:19px;font-weight:700;margin-left:10px">JusConsulta TJSP</span>
    <h1 style="color:#fff;font-size:15px;margin:8px 0 0;font-weight:600">🆕 Novo processo encontrado</h1>
  </div>
  <div style="padding:22px 24px">
    <div style="background:#0f172a;border-radius:9px;padding:11px 15px;border:1px solid #334155;margin-bottom:18px">
      <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Número do processo</div>
      <div style="color:#3b82f6;font-family:monospace;font-size:14px;font-weight:700">${numero}</div>
    </div>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 14px">
      Um novo processo vinculado ao seu CPF foi encontrado no TJSP. Últimas movimentações:
    </p>
    <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:9px;overflow:hidden;border:1px solid #334155">
      <thead><tr style="background:#1e293b">
        <th style="padding:9px 14px;text-align:left;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Data</th>
        <th style="padding:9px 14px;text-align:left;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Movimentação</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <div style="margin-top:22px;text-align:center">
      <a href="https://esaj.tjsp.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&dePesquisaNuUnificado=${encodeURIComponent(numero)}"
         style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:700;font-size:13px">
        Ver no e-SAJ oficial ↗
      </a>
    </div>
  </div>
  <div style="padding:14px 24px;border-top:1px solid #1e293b;text-align:center">
    <p style="color:#475569;font-size:11px;margin:0">JusConsulta TJSP — monitoramento automático via GitHub Actions</p>
  </div>
</div></div></body></html>`;

  await transport.sendMail({
    from: `"JusConsulta TJSP" <\${GMAIL_USER}>`,
    to: EMAIL_TO,
    subject: `🆕 Novo processo encontrado — \${numero}`,
    html,
  });
  console.log(`  ✉️  E-mail de novo processo enviado para \${EMAIL_TO}`);
}

async function enviarEmail(numero, novas) {
  const transport = createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,        // TLS via STARTTLS
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  const linhas = novas.map(m => `
    <tr>
      <td style="padding:8px 14px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap">${m.data}</td>
      <td style="padding:8px 14px;border-bottom:1px solid #1e293b;color:#e2e8f0">${m.titulo}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:28px 16px">
<div style="background:#1e293b;border-radius:14px;overflow:hidden;border:1px solid #334155">
  <div style="background:linear-gradient(135deg,#f59e0b18,#1e293b);padding:22px 24px;border-bottom:1px solid #334155">
    <span style="font-size:26px">⚖️</span>
    <span style="color:#f59e0b;font-size:19px;font-weight:700;margin-left:10px">JusConsulta TJSP</span>
    <h1 style="color:#fff;font-size:15px;margin:8px 0 0;font-weight:600">Nova movimentação detectada</h1>
  </div>
  <div style="padding:22px 24px">
    <div style="background:#0f172a;border-radius:9px;padding:11px 15px;border:1px solid #334155;margin-bottom:18px">
      <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">Processo</div>
      <div style="color:#f59e0b;font-family:monospace;font-size:14px;font-weight:700">${numero}</div>
    </div>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 14px">
      ${novas.length === 1 ? 'Uma nova movimentação foi registrada' : `${novas.length} novas movimentações foram registradas`}:
    </p>
    <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:9px;overflow:hidden;border:1px solid #334155">
      <thead><tr style="background:#1e293b">
        <th style="padding:9px 14px;text-align:left;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Data</th>
        <th style="padding:9px 14px;text-align:left;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Movimentação</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <div style="margin-top:22px;text-align:center">
      <a href="https://esaj.tjsp.jus.br/cpopg/search.do?cbPesquisa=NUMPROC&dePesquisaNuUnificado=${encodeURIComponent(numero)}"
         style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:700;font-size:13px">
        Ver no e-SAJ oficial ↗
      </a>
    </div>
  </div>
  <div style="padding:14px 24px;border-top:1px solid #1e293b;text-align:center">
    <p style="color:#475569;font-size:11px;margin:0">JusConsulta TJSP — monitoramento automático via GitHub Actions</p>
  </div>
</div></div></body></html>`;

  await transport.sendMail({
    from: `"JusConsulta TJSP" <${GMAIL_USER}>`,
    to: EMAIL_TO,
    subject: `⚖️ Nova movimentação — ${numero}`,
    html,
  });
  console.log(`  ✉️  E-mail enviado para ${EMAIL_TO}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 JusConsulta Monitor iniciando...');
  console.log(`   Buscando por: ${CPF ? `CPF ${CPF}` : `Nome "${NOME}"`}`);

  const estado = await lerEstado();
  let houveAlteracao = false;

  // Buscar números de processo
  const numeros = CPF
    ? await buscarNumerosPorDoc(CPF)
    : await buscarNumerosPorNome(NOME);

  console.log(`   ${numeros.length} processo(s) encontrado(s): ${numeros.join(', ') || '—'}`);

  for (const numero of numeros) {
    console.log(`\n📋 Verificando ${numero}...`);
    try {
      const movs = await buscarMovimentacoes(numero);
      console.log(`   ${movs.length} movimentação(ões) no e-SAJ`);

      // Ignorar processos arquivados definitivamente
      const IGNORAR_SE_ULTIMA = [
        'arquivado definitivamente',
        'arquivamento definitivo',
        'processo arquivado',
        'baixado definitivamente',
      ];
      const ultimaMov = (movs[0]?.titulo || '').toLowerCase();
      if (IGNORAR_SE_ULTIMA.some(p => ultimaMov.includes(p))) {
        console.log(`   ⏭️  Ignorado — processo arquivado: "${movs[0]?.titulo}"`);
        // Salvar estado mas não alertar nunca mais
        estado[numero] = { movs, atualizado: new Date().toISOString(), ignorado: true };
        continue;
      }

      // Se já estava marcado como ignorado anteriormente, pular
      if (estado[numero]?.ignorado) {
        console.log(`   ⏭️  Ignorado (arquivado)`);
        continue;
      }

      const isNovo = !estado[numero];
      const anterior = estado[numero] || { movs: [] };
      const keysAnt  = new Set(anterior.movs.map(m => `${m.data}|${m.titulo}`));
      const novas    = movs.filter(m => !keysAnt.has(`${m.data}|${m.titulo}`));

      if (isNovo) {
        // Processo encontrado pela primeira vez — notificar
        console.log(`   🆕 Novo processo encontrado! Notificando...`);
        await enviarEmailNovoProcesso(numero, movs);
        houveAlteracao = true;
      } else if (novas.length > 0) {
        // Processo já conhecido com novas movimentações
        console.log(`   🚨 ${novas.length} nova(s) movimentação(ões) detectada(s)!`);
        novas.forEach(m => console.log(`      • ${m.data} — ${m.titulo}`));
        await enviarEmail(numero, novas);
        houveAlteracao = true;
      } else {
        console.log('   ✅ Sem novidades');
      }

      // Atualizar estado
      estado[numero] = { movs, atualizado: new Date().toISOString() };

    } catch (e) {
      console.warn(`   ⚠️  Falha: ${e.message}`);
    }

    // Delay cortês entre requisições
    await new Promise(r => setTimeout(r, 2000));
  }

  await salvarEstado(estado);
  console.log(`\n✅ Ciclo concluído. ${houveAlteracao ? 'Alertas enviados.' : 'Nenhuma novidade.'}`);
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
