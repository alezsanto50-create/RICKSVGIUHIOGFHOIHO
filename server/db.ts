import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

function resolveDataDir(): string {
  const candidates = [
    process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null,
    path.resolve(process.cwd(), 'data'),
    path.join(os.tmpdir(), 'barbearia-trindade-data'),
  ].filter((p): p is string => Boolean(p));

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // Try next writable directory
    }
  }
  return os.tmpdir();
}

const DATA_DIR = resolveDataDir();
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'barbearia_trindade.db');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

export function getTodayBR(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

export function getNowTimeBR(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(now);
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('owner', 'manager', 'barber')),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 30,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      barber_name TEXT NOT NULL,
      client_name TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('dinheiro', 'pix', 'debito', 'credito')),
      notes TEXT NOT NULL DEFAULT '',
      transaction_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('entrada', 'saida')),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('dinheiro', 'pix', 'debito', 'credito')),
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      appointment_id TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cash_closings (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      opening_balance REAL NOT NULL,
      total_received REAL NOT NULL,
      total_cash REAL NOT NULL,
      total_pix REAL NOT NULL,
      total_debit REAL NOT NULL,
      total_credit REAL NOT NULL,
      total_card REAL NOT NULL,
      total_expenses REAL NOT NULL,
      final_balance REAL NOT NULL,
      counted_cash REAL,
      appointments_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      closed_by TEXT NOT NULL,
      closed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS private_records (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('reserva', 'pro_labore', 'investimento', 'nota')),
      amount REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      included_services TEXT NOT NULL DEFAULT '[]',
      cycle TEXT NOT NULL CHECK(cycle IN ('semanal', 'quinzenal', 'mensal')),
      price REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      is_template INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      client_phone TEXT NOT NULL DEFAULT '',
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      included_services TEXT NOT NULL DEFAULT '',
      cycle TEXT NOT NULL CHECK(cycle IN ('semanal', 'quinzenal', 'mensal')),
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('dinheiro', 'pix', 'debito', 'credito')),
      next_due_date TEXT NOT NULL,
      last_paid_at TEXT,
      status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'pausado')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  const insertDefaultSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertDefaultSetting.run('pix_key', '');
  insertDefaultSetting.run('pix_holder_name', 'BARBEARIA TRINDADE');
  insertDefaultSetting.run('pix_city', 'SAO PAULO');

  const userCountRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (userCountRow.cnt === 0) {
    seedInitialData();
  }

  seedMembershipDefaults();
  applyServicePriceUpdatesV2();
}

function applyServicePriceUpdatesV2() {
  const applied = db.prepare('SELECT value FROM settings WHERE key = ?').get('price_update_v2_30_35_10') as { value: string } | undefined;
  if (applied?.value === '1') return;

  db.prepare("UPDATE services SET price = 35 WHERE id = 'srv_corte' OR LOWER(TRIM(name)) = 'corte de cabelo'").run();
  db.prepare("UPDATE services SET price = 30 WHERE id = 'srv_barba' OR LOWER(TRIM(name)) = 'barba'").run();
  db.prepare("UPDATE services SET price = 10 WHERE id = 'srv_sobrancelha' OR LOWER(TRIM(name)) = 'sobrancelha'").run();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('price_update_v2_30_35_10', '1');
}

function seedMembershipDefaults() {
  const planCount = db.prepare('SELECT COUNT(*) as cnt FROM membership_plans').get() as { cnt: number };
  const nowIso = new Date().toISOString();

  if (planCount.cnt === 0) {
    const insPlan = db.prepare(`
      INSERT INTO membership_plans (id, name, description, included_services, cycle, price, active, is_template, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insPlan.run(
      'pln_semanal_completo',
      'Pacote Semanal Completo',
      'Pacote completo toda semana: corte de cabelo, barba alinhada e sobrancelha.',
      JSON.stringify(['Corte de cabelo', 'Barba', 'Sobrancelha']),
      'semanal',
      85,
      1,
      nowIso
    );
    insPlan.run(
      'pln_mensal_corte',
      'Mensalidade Corte Ilimitado',
      'Até 4 cortes de cabelo por mês com agendamento prioritário.',
      JSON.stringify(['Corte de cabelo']),
      'mensal',
      150,
      1,
      nowIso
    );
    insPlan.run(
      'pln_mensal_vip',
      'Pacote Mensal VIP Trindade',
      'Combo completo semanal durante todo o mês (4x Corte + Barba + Sobrancelha + Acabamento).',
      JSON.stringify(['Corte de cabelo', 'Barba', 'Sobrancelha', 'Pigmentação / Acabamento']),
      'mensal',
      260,
      1,
      nowIso
    );
    insPlan.run(
      'pln_quinzenal',
      'Plano Quinzenal Clássico',
      'Corte + barba a cada 15 dias com desconto especial de fidelidade.',
      JSON.stringify(['Corte de cabelo', 'Barba']),
      'quinzenal',
      135,
      1,
      nowIso
    );
  }
}

function seedInitialData() {
  const nowIso = new Date().toISOString();

  const ownerHash = bcrypt.hashSync('trindade123', 8);
  const barberHash = bcrypt.hashSync('123456', 8);
  const adminPinHash = bcrypt.hashSync('1234', 8);
  const privatePinHash = bcrypt.hashSync('9999', 8);

  const insertUser = db.prepare(
    'INSERT INTO users (id, name, email, role, password_hash, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertUser.run('usr_owner', 'Proprietário Trindade', 'admin@trindade.com', 'owner', ownerHash, 1, nowIso);
  insertUser.run('usr_barber1', 'Lucas Barbeiro', 'lucas@trindade.com', 'barber', barberHash, 1, nowIso);

  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('shop_name', 'Barbearia Trindade');
  insertSetting.run('opening_cash_balance', '0');
  insertSetting.run('daily_goal', '0');
  insertSetting.run('monthly_goal', '0');
  insertSetting.run('cloud_sync_enabled', '1');
  insertSetting.run('cloud_sync_url', '');
  insertSetting.run('last_backup_at', '');
  insertSetting.run('admin_pin_hash', adminPinHash);
  insertSetting.run('private_pin_hash', privatePinHash);

  const services = [
    { id: 'srv_corte', name: 'Corte de cabelo', category: 'Cabelo', price: 35, durationMin: 35 },
    { id: 'srv_barba', name: 'Barba', category: 'Barba', price: 30, durationMin: 25 },
    { id: 'srv_combo', name: 'Corte + barba', category: 'Combo', price: 55, durationMin: 55 },
    { id: 'srv_pigmentacao', name: 'Pigmentação e acabamento', category: 'Especial', price: 30, durationMin: 20 },
    { id: 'srv_sobrancelha', name: 'Sobrancelha', category: 'Acabamento', price: 10, durationMin: 15 },
  ];

  const insertService = db.prepare(
    'INSERT INTO services (id, name, category, price, duration_min, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  );
  for (const s of services) {
    insertService.run(s.id, s.name, s.category, s.price, s.durationMin, nowIso);
  }
}

export function getSettingsObject() {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    shopName: map.get('shop_name') || 'Barbearia Trindade',
    openingCashBalance: Number(map.get('opening_cash_balance') || 0),
    dailyGoal: map.has('daily_goal') ? Number(map.get('daily_goal')) : 0,
    monthlyGoal: map.has('monthly_goal') ? Number(map.get('monthly_goal')) : 0,
    cloudSyncEnabled: map.get('cloud_sync_enabled') === '1',
    cloudSyncUrl: map.get('cloud_sync_url') || '',
    lastBackupAt: map.get('last_backup_at') || null,
    pixKey: map.get('pix_key') || '',
    pixHolderName: map.get('pix_holder_name') || 'BARBEARIA TRINDADE',
    pixCity: map.get('pix_city') || 'SAO PAULO',
  };
}

export function createSqliteBackup(): { filename: string; path: string; timestamp: string } {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Ignore if checkpoint cannot acquire exclusive lock
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `trindade-backup-${ts}.db`;
  const dest = path.join(BACKUP_DIR, filename);
  fs.copyFileSync(DB_PATH, dest);

  // Retain at most the 5 most recent backups to avoid disk/tmpfs bloat on Cloud Run
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('trindade-backup-') && f.endsWith('.db'))
      .sort()
      .reverse();
    for (const oldFile of files.slice(5)) {
      fs.unlinkSync(path.join(BACKUP_DIR, oldFile));
    }
  } catch {
    // Non-fatal cleanup error
  }

  const nowIso = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('last_backup_at', nowIso);
  return { filename, path: dest, timestamp: nowIso };
}
