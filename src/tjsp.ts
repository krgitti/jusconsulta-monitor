/**
 * Módulo de scraping do e-SAJ TJSP — reutiliza a lógica do app frontend
 * mas adaptada para Node.js com node-fetch + node-html-parser
 */
import { parse } from 'node-html-parser';

const TIMEOUT_MS = 12000;

const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

let workingProxy = 0;

async function fetchHtml(url: string): Promise<string> {
  const errors: string[] = [];
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const idx = (workingProxy + i) % CORS_PROXIES.length;
    const proxied = CORS_PROXIES[idx](url);
    try {
      const { default: fetch } = await import('node-fetch');
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(proxied, {
        signal: ctrl.signal as any,
        headers: { 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' },
      });
      clearTimeout(tid);
      if (!res.ok) { errors.push(`proxy${idx}: ${res.status}`); continue; }
      const text = await res.text();
      if (text.length < 200) { errors.push(`proxy${idx}: resposta vazia`); continue; }
      workingProxy = idx;
      return text;
    } catch (e: any) {
      errors.push(`proxy${idx}: ${e.message}`);
    }
  }
  throw new Error(`FETCH_FAILED: ${errors.join('; ')}`);
}

function txt(el: any): string {
  return el?.text?.trim().replace(/\s+/g, ' ') || '';
}

function parseNumero(numero: string): { digitoAno: string; oooo: string; formatted: string } | null {
  const m = numero.replace(/\s/g, '').match(/(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})/);
  if (!m) return null;
  return {
    formatted: `${m[1]}-${m[2]}.${m[3]}.${m[4]}.${m[5]}.${m[6]}`,
    digitoAno: `${m[1]}-${m[2]}.${m[3]}`,
    oooo: m[6],
  };
}

export interface Movimentacao { data: string; titulo: string; }
export interface ProcessoInfo {
  numero: string;
  classe: string;
  assunto: string;
  vara: string;
  juiz: string;
  movimentacoes: Movimentacao[];
  urlOriginal: string;
}

async function buscarPorSistema(
  sistema: string, termo: string, tipo: 'NMPARTE' | 'DOCPARTE' | 'NUMPROC'
): Promise<string[]> {
  const base = `https://esaj.tjsp.jus.br/${sistema}`;
  let url: string;

  if (tipo === 'NUMPROC') {
    const p = parseNumero(termo);
    if (!p) return [];
    url = `${base}/search.do?conversationId=&paginaConsulta=0&cbPesquisa=NUMPROC&numeroDigitoAnoUnificado=${p.digitoAno}&foroNumeroUnificado=${p.oooo}&dePesquisaNuUnificado=${p.formatted}&tipoNuProcesso=UNIFICADO`;
  } else {
    const val = tipo === 'DOCPARTE' ? termo.replace(/\D/g, '') : encodeURIComponent(termo);
    url = `${base}/search.do?conversationId=&paginaConsulta=0&cbPesquisa=${tipo}&dePesquisa=${val}`;
  }

  const html = await fetchHtml(url);
  const numeros: string[] = [];
  const matches = html.matchAll(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g);
  for (const m of matches) {
    if (!numeros.includes(m[0])) numeros.push(m[0]);
  }
  return numeros;
}

export async function buscarNumeros(
  valor: string, tipo: 'cpf' | 'cnpj' | 'numero' | 'nome'
): Promise<string[]> {
  if (tipo === 'numero') {
    const p = parseNumero(valor);
    return p ? [p.formatted] : [];
  }
  const tipoBusca = (tipo === 'cpf' || tipo === 'cnpj') ? 'DOCPARTE' : 'NMPARTE';
  const sistemas = ['cpopg', 'cposg'];
  const results = await Promise.allSettled(
    sistemas.map(s => buscarPorSistema(s, valor, tipoBusca))
  );
  const todos: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const n of r.value) {
        if (!todos.includes(n)) todos.push(n);
      }
    }
  }
  return todos;
}

export async function buscarDetalhes(numero: string): Promise<ProcessoInfo | null> {
  const p = parseNumero(numero);
  if (!p) return null;

  const sistema = numero.includes('.8.26.') ? 'cpopg' : 'cpopg';
  const searchUrl = `https://esaj.tjsp.jus.br/${sistema}/search.do?conversationId=&cbPesquisa=NUMPROC&numeroDigitoAnoUnificado=${p.digitoAno}&foroNumeroUnificado=${p.oooo}&dePesquisaNuUnificado=${p.formatted}&tipoNuProcesso=UNIFICADO`;

  const html = await fetchHtml(searchUrl);
  const root = parse(html);

  // Se for página de processo único
  const numEl = root.querySelector('#numeroProcesso');
  const movs: Movimentacao[] = [];

  const tabelaMovs = root.querySelector('#tabelaTodasMovimentacoes') ||
                     root.querySelector('#tabelaUltimasMovimentacoes');

  if (tabelaMovs) {
    tabelaMovs.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      const data = txt(row.querySelector('.dataMovimentacao')) || txt(cells[0]);
      const titulo = txt(row.querySelector('.descricaoMovimentacao')) || txt(cells[2]) || txt(cells[1]);
      if (data && titulo && /\d{2}\/\d{2}\/\d{4}/.test(data)) {
        movs.push({ data, titulo });
      }
    });
  }

  return {
    numero: numero,
    classe: txt(root.querySelector('#classeProcesso')),
    assunto: txt(root.querySelector('#assuntoProcesso')),
    vara: txt(root.querySelector('#varaProcesso')),
    juiz: txt(root.querySelector('#juizProcesso')),
    movimentacoes: movs,
    urlOriginal: searchUrl,
  };
}

export function hashMovimentacoes(movs: Movimentacao[]): string {
  const str = movs.slice(0, 5).map(m => `${m.data}|${m.titulo}`).join(';;');
  // Hash simples (djb2)
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16);
}
