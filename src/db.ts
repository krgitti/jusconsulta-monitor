import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'monitor.db');

// Garante que o diretório existe
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// Habilitar WAL para performance
db.pragma('journal_mode = WAL');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS monitored (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo        TEXT NOT NULL CHECK(tipo IN ('cpf','cnpj','numero','nome')),
    valor       TEXT NOT NULL,
    label       TEXT,
    email       TEXT NOT NULL,
    fcm_token   TEXT,
    ativo       INTEGER NOT NULL DEFAULT 1,
    criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tipo, valor, email)
  );

  CREATE TABLE IF NOT EXISTS processos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    monitored_id      INTEGER NOT NULL REFERENCES monitored(id) ON DELETE CASCADE,
    numero            TEXT NOT NULL,
    ultima_mov_data   TEXT,
    ultima_mov_titulo TEXT,
    hash_movs         TEXT,
    dados_json        TEXT,
    atualizado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(monitored_id, numero)
  );

  CREATE TABLE IF NOT EXISTS alertas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    processo_id   INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    tipo          TEXT NOT NULL,
    mensagem      TEXT NOT NULL,
    enviado_em    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Queries tipadas ───────────────────────────────────────────────────────────

export interface Monitored {
  id: number;
  tipo: string;
  valor: string;
  label: string | null;
  email: string;
  fcm_token: string | null;
  ativo: number;
}

export interface ProcessoRow {
  id: number;
  monitored_id: number;
  numero: string;
  ultima_mov_data: string | null;
  ultima_mov_titulo: string | null;
  hash_movs: string | null;
  dados_json: string | null;
}

export const queries = {
  getAllActive: db.prepare<[], Monitored>(
    `SELECT * FROM monitored WHERE ativo = 1`
  ),
  getById: db.prepare<[number], Monitored>(
    `SELECT * FROM monitored WHERE id = ?`
  ),
  insert: db.prepare(
    `INSERT INTO monitored (tipo, valor, label, email, fcm_token)
     VALUES (@tipo, @valor, @label, @email, @fcm_token)
     ON CONFLICT(tipo, valor, email) DO UPDATE SET
       ativo = 1,
       fcm_token = excluded.fcm_token,
       label = excluded.label`
  ),
  deactivate: db.prepare(
    `UPDATE monitored SET ativo = 0 WHERE id = ?`
  ),
  updateFcmToken: db.prepare(
    `UPDATE monitored SET fcm_token = ? WHERE id = ?`
  ),
  getProcesso: db.prepare<[number, string], ProcessoRow>(
    `SELECT * FROM processos WHERE monitored_id = ? AND numero = ?`
  ),
  upsertProcesso: db.prepare(
    `INSERT INTO processos (monitored_id, numero, ultima_mov_data, ultima_mov_titulo, hash_movs, dados_json, atualizado_em)
     VALUES (@monitored_id, @numero, @ultima_mov_data, @ultima_mov_titulo, @hash_movs, @dados_json, datetime('now'))
     ON CONFLICT(monitored_id, numero) DO UPDATE SET
       ultima_mov_data   = excluded.ultima_mov_data,
       ultima_mov_titulo = excluded.ultima_mov_titulo,
       hash_movs         = excluded.hash_movs,
       dados_json        = excluded.dados_json,
       atualizado_em     = excluded.atualizado_em`
  ),
  insertAlerta: db.prepare(
    `INSERT INTO alertas (processo_id, tipo, mensagem) VALUES (?, ?, ?)`
  ),
  listMonitored: db.prepare<[string], Monitored>(
    `SELECT * FROM monitored WHERE email = ? AND ativo = 1 ORDER BY criado_em DESC`
  ),
};
