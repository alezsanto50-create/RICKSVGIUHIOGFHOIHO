import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { db, initDatabase, getSettingsObject, createSqliteBackup, getTodayBR, getNowTimeBR } from './server/db.ts';

initDatabase();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

// Cloud Run readiness / liveness health checks
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, status: 'healthy' });
});
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, status: 'healthy' });
});

// Ephemeral + deterministic secret per instance for HMAC session tokens
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(process.cwd() + '_barbearia_trindade').digest('hex');

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'manager' | 'barber';
  active: boolean;
  createdAt: string;
}

interface AuthedRequest extends Request {
  user?: AuthUser;
}

function signToken(payload: { userId: string; exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): { userId: string; exp: number } | null {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function mapUserRow(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as 'owner' | 'manager' | 'barber',
    active: Boolean(row.active),
    createdAt: String(row.created_at),
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const verified = token ? verifyToken(token) : null;
  if (!verified) {
    res.status(401).json({ error: 'Sessão expirada ou não autenticada.' });
    return;
  }
  const userRow = db.prepare('SELECT id, name, email, role, active, created_at FROM users WHERE id = ?').get(verified.userId) as Record<string, unknown> | undefined;
  if (!userRow || !userRow.active) {
    res.status(401).json({ error: 'Usuário inválido ou desativado.' });
    return;
  }
  req.user = mapUserRow(userRow);
  next();
}

function mapServiceRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category),
    price: Number(r.price),
    durationMin: Number(r.duration_min),
    active: Boolean(r.active),
    createdAt: String(r.created_at),
  };
}

function mapAppointmentRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    serviceId: String(r.service_id),
    serviceName: String(r.service_name),
    barberName: String(r.barber_name),
    clientName: String(r.client_name || ''),
    amount: Number(r.amount),
    date: String(r.date),
    time: String(r.time),
    paymentMethod: String(r.payment_method),
    notes: String(r.notes || ''),
    transactionId: r.transaction_id ? String(r.transaction_id) : null,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
  };
}

function mapTransactionRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    type: String(r.type),
    category: String(r.category),
    description: String(r.description),
    amount: Number(r.amount),
    paymentMethod: String(r.payment_method),
    date: String(r.date),
    time: String(r.time),
    appointmentId: r.appointment_id ? String(r.appointment_id) : null,
    notes: String(r.notes || ''),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapClosingRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    date: String(r.date),
    openingBalance: Number(r.opening_balance),
    totalReceived: Number(r.total_received),
    totalCash: Number(r.total_cash),
    totalPix: Number(r.total_pix),
    totalDebit: Number(r.total_debit),
    totalCredit: Number(r.total_credit),
    totalCard: Number(r.total_card),
    totalExpenses: Number(r.total_expenses),
    finalBalance: Number(r.final_balance),
    countedCash: r.counted_cash !== null && r.counted_cash !== undefined ? Number(r.counted_cash) : null,
    appointmentsCount: Number(r.appointments_count),
    notes: String(r.notes || ''),
    closedBy: String(r.closed_by),
    closedAt: String(r.closed_at),
  };
}

function mapPlanRow(r: Record<string, unknown>) {
  let included: string[] = [];
  try {
    const parsed = JSON.parse(String(r.included_services || '[]'));
    if (Array.isArray(parsed)) included = parsed.map(String);
  } catch {
    included = [];
  }
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description || ''),
    includedServices: included,
    cycle: String(r.cycle),
    price: Number(r.price),
    active: Boolean(r.active),
    isTemplate: Boolean(r.is_template),
    createdAt: String(r.created_at),
  };
}

function mapSubscriberRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    clientName: String(r.client_name),
    clientPhone: String(r.client_phone || ''),
    planId: String(r.plan_id),
    planName: String(r.plan_name),
    includedServices: String(r.included_services || ''),
    cycle: String(r.cycle),
    amount: Number(r.amount),
    paymentMethod: String(r.payment_method),
    nextDueDate: String(r.next_due_date),
    lastPaidAt: r.last_paid_at ? String(r.last_paid_at) : null,
    status: String(r.status),
    notes: String(r.notes || ''),
    createdAt: String(r.created_at),
  };
}

function advanceDateByCycle(dateISO: string, cycle: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (cycle === 'semanal') dt.setUTCDate(dt.getUTCDate() + 7);
  else if (cycle === 'quinzenal') dt.setUTCDate(dt.getUTCDate() + 15);
  else dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 10);
}

// ==================== AUTH ROUTES ====================
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Informe e-mail e senha.' });
    return;
  }
  const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(String(email).trim()) as Record<string, unknown> | undefined;
  if (!row || !bcrypt.compareSync(String(password), String(row.password_hash))) {
    res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    return;
  }
  if (!row.active) {
    res.status(403).json({ error: 'Este usuário está desativado. Contate o administrador.' });
    return;
  }
  const user = mapUserRow(row);
  const token = signToken({ userId: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
  res.json({ token, user });
});

app.get('/api/bootstrap', requireAuth, (req: AuthedRequest, res) => {
  const services = (db.prepare('SELECT * FROM services ORDER BY name ASC').all() as Record<string, unknown>[]).map(mapServiceRow);
  const appointments = (db.prepare('SELECT * FROM appointments ORDER BY date DESC, time DESC, created_at DESC').all() as Record<string, unknown>[]).map(mapAppointmentRow);
  const transactions = (db.prepare('SELECT * FROM transactions ORDER BY date DESC, time DESC, created_at DESC').all() as Record<string, unknown>[]).map(mapTransactionRow);
  const cashClosings = (db.prepare('SELECT * FROM cash_closings ORDER BY date DESC').all() as Record<string, unknown>[]).map(mapClosingRow);
  const membershipPlans = (db.prepare('SELECT * FROM membership_plans ORDER BY is_template DESC, price ASC').all() as Record<string, unknown>[]).map(mapPlanRow);
  const subscribers = (db.prepare('SELECT * FROM subscribers ORDER BY next_due_date ASC, client_name ASC').all() as Record<string, unknown>[]).map(mapSubscriberRow);
  const users = req.user?.role !== 'barber'
    ? (db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at ASC').all() as Record<string, unknown>[]).map(mapUserRow)
    : undefined;

  res.json({
    user: req.user,
    settings: getSettingsObject(),
    services,
    appointments,
    transactions,
    cashClosings,
    membershipPlans,
    subscribers,
    users,
  });
});

app.post('/api/auth/verify-admin-pin', requireAuth, (req, res) => {
  const { pin } = req.body || {};
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin_hash') as { value: string } | undefined;
  if (!row || !pin || !bcrypt.compareSync(String(pin), row.value)) {
    res.status(403).json({ error: 'Senha administrativa incorreta.' });
    return;
  }
  res.json({ verified: true });
});

app.post('/api/auth/verify-private-pin', requireAuth, (req, res) => {
  const { pin } = req.body || {};
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('private_pin_hash') as { value: string } | undefined;
  if (!row || !pin || !bcrypt.compareSync(String(pin), row.value)) {
    res.status(403).json({ error: 'Senha da Área Privada incorreta.' });
    return;
  }
  res.json({ verified: true });
});

app.put('/api/auth/passwords', requireAuth, (req: AuthedRequest, res) => {
  const { target, currentValue, newValue } = req.body || {};
  if (!newValue || String(newValue).length < 4) {
    res.status(400).json({ error: 'A nova senha deve ter pelo menos 4 caracteres.' });
    return;
  }

  if (target === 'user') {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string } | undefined;
    if (!row || !bcrypt.compareSync(String(currentValue || ''), row.password_hash)) {
      res.status(403).json({ error: 'Senha atual incorreta.' });
      return;
    }
    const nextHash = bcrypt.hashSync(String(newValue), 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(nextHash, req.user!.id);
    res.json({ ok: true });
    return;
  }

  if (target === 'admin_pin') {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin_hash') as { value: string } | undefined;
    if (!row || !bcrypt.compareSync(String(currentValue || ''), row.value)) {
      res.status(403).json({ error: 'Senha administrativa atual incorreta.' });
      return;
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('admin_pin_hash', bcrypt.hashSync(String(newValue), 10));
    res.json({ ok: true });
    return;
  }

  if (target === 'private_pin') {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('private_pin_hash') as { value: string } | undefined;
    if (!row || !bcrypt.compareSync(String(currentValue || ''), row.value)) {
      res.status(403).json({ error: 'Senha atual da Área Privada incorreta.' });
      return;
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('private_pin_hash', bcrypt.hashSync(String(newValue), 10));
    res.json({ ok: true });
    return;
  }

  res.status(400).json({ error: 'Tipo de senha inválido.' });
});

// ==================== SERVICES ====================
app.post('/api/services', requireAuth, (req, res) => {
  const { name, category, price, durationMin } = req.body || {};
  if (!name || Number(price) < 0) {
    res.status(400).json({ error: 'Nome e valor válido são obrigatórios.' });
    return;
  }
  const id = `srv_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  db.prepare(
    'INSERT INTO services (id, name, category, price, duration_min, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  ).run(id, String(name).trim(), String(category || 'Geral').trim(), Number(price), Number(durationMin || 30), nowIso);

  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json(mapServiceRow(row));
});

app.put('/api/services/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, category, price, durationMin, active } = req.body || {};
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Serviço não encontrado.' });
    return;
  }
  db.prepare(
    'UPDATE services SET name = ?, category = ?, price = ?, duration_min = ?, active = ? WHERE id = ?'
  ).run(
    name !== undefined ? String(name).trim() : String(existing.name),
    category !== undefined ? String(category).trim() : String(existing.category),
    price !== undefined ? Number(price) : Number(existing.price),
    durationMin !== undefined ? Number(durationMin) : Number(existing.duration_min),
    active !== undefined ? (active ? 1 : 0) : Number(existing.active),
    id
  );
  const updated = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Record<string, unknown>;
  res.json(mapServiceRow(updated));
});

app.delete('/api/services/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ==================== APPOINTMENTS (AUTO-SYNCED WITH TRANSACTIONS) ====================
app.post('/api/appointments', requireAuth, (req: AuthedRequest, res) => {
  const { serviceId, serviceName, barberName, clientName, amount, date, time, paymentMethod, notes } = req.body || {};
  if (!serviceName || Number(amount) <= 0 || !paymentMethod) {
    res.status(400).json({ error: 'Serviço, valor positivo e forma de pagamento são obrigatórios.' });
    return;
  }
  const apptId = `apt_${crypto.randomUUID().slice(0, 8)}`;
  const txId = `trx_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const finalDate = date || getTodayBR();
  const finalTime = time || getNowTimeBR();
  const finalBarber = barberName || req.user!.name;
  const finalClient = String(clientName || '').trim();
  const finalNotes = String(notes || '').trim();

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO appointments (id, service_id, service_name, barber_name, client_name, amount, date, time, payment_method, notes, transaction_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apptId,
      String(serviceId || 'custom'),
      String(serviceName).trim(),
      finalBarber,
      finalClient,
      Number(amount),
      finalDate,
      finalTime,
      paymentMethod,
      finalNotes,
      txId,
      req.user!.id,
      nowIso
    );

    db.prepare(`
      INSERT INTO transactions (id, type, category, description, amount, payment_method, date, time, appointment_id, notes, created_by, created_at, updated_at)
      VALUES (?, 'entrada', 'Serviços de Barbearia', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txId,
      `${String(serviceName).trim()}${finalClient ? ` — ${finalClient}` : ''}`,
      Number(amount),
      paymentMethod,
      finalDate,
      finalTime,
      apptId,
      finalNotes,
      req.user!.id,
      nowIso,
      nowIso
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const appt = mapAppointmentRow(db.prepare('SELECT * FROM appointments WHERE id = ?').get(apptId) as Record<string, unknown>);
  const transaction = mapTransactionRow(db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as Record<string, unknown>);
  res.status(201).json({ appointment: appt, transaction });
});

app.put('/api/appointments/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Atendimento não encontrado.' });
    return;
  }
  const { serviceId, serviceName, barberName, clientName, amount, date, time, paymentMethod, notes } = req.body || {};
  const nowIso = new Date().toISOString();
  const nextServiceName = serviceName !== undefined ? String(serviceName).trim() : String(existing.service_name);
  const nextClient = clientName !== undefined ? String(clientName).trim() : String(existing.client_name);
  const nextAmount = amount !== undefined ? Number(amount) : Number(existing.amount);
  const nextDate = date !== undefined ? String(date) : String(existing.date);
  const nextTime = time !== undefined ? String(time) : String(existing.time);
  const nextPay = paymentMethod !== undefined ? String(paymentMethod) : String(existing.payment_method);
  const nextNotes = notes !== undefined ? String(notes).trim() : String(existing.notes);

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE appointments
      SET service_id = ?, service_name = ?, barber_name = ?, client_name = ?, amount = ?, date = ?, time = ?, payment_method = ?, notes = ?
      WHERE id = ?
    `).run(
      serviceId !== undefined ? String(serviceId) : String(existing.service_id),
      nextServiceName,
      barberName !== undefined ? String(barberName).trim() : String(existing.barber_name),
      nextClient,
      nextAmount,
      nextDate,
      nextTime,
      nextPay,
      nextNotes,
      id
    );

    if (existing.transaction_id) {
      db.prepare(`
        UPDATE transactions
        SET description = ?, amount = ?, payment_method = ?, date = ?, time = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        `${nextServiceName}${nextClient ? ` — ${nextClient}` : ''}`,
        nextAmount,
        nextPay,
        nextDate,
        nextTime,
        nextNotes,
        nowIso,
        String(existing.transaction_id)
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const appt = mapAppointmentRow(db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as Record<string, unknown>);
  const transaction = existing.transaction_id
    ? mapTransactionRow(db.prepare('SELECT * FROM transactions WHERE id = ?').get(String(existing.transaction_id)) as Record<string, unknown>)
    : null;
  res.json({ appointment: appt, transaction });
});

app.delete('/api/appointments/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT transaction_id FROM appointments WHERE id = ?').get(id) as { transaction_id: string | null } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Atendimento não encontrado.' });
    return;
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
    if (existing.transaction_id) {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.transaction_id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true, deletedTransactionId: existing.transaction_id });
});

// ==================== TRANSACTIONS ====================
app.post('/api/transactions', requireAuth, (req: AuthedRequest, res) => {
  const { type, category, description, amount, paymentMethod, date, time, notes } = req.body || {};
  if (!type || !category || !description || Number(amount) <= 0 || !paymentMethod) {
    res.status(400).json({ error: 'Tipo, categoria, descrição, valor positivo e forma de pagamento são obrigatórios.' });
    return;
  }
  const id = `trx_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO transactions (id, type, category, description, amount, payment_method, date, time, appointment_id, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    id,
    type,
    String(category).trim(),
    String(description).trim(),
    Number(amount),
    paymentMethod,
    date || getTodayBR(),
    time || getNowTimeBR(),
    String(notes || '').trim(),
    req.user!.id,
    nowIso,
    nowIso
  );
  const created = mapTransactionRow(db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<string, unknown>);
  res.status(201).json(created);
});

app.put('/api/transactions/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Lançamento não encontrado.' });
    return;
  }
  const { type, category, description, amount, paymentMethod, date, time, notes } = req.body || {};
  const nowIso = new Date().toISOString();
  const nextType = type !== undefined ? String(type) : String(existing.type);
  const nextCategory = category !== undefined ? String(category).trim() : String(existing.category);
  const nextDesc = description !== undefined ? String(description).trim() : String(existing.description);
  const nextAmount = amount !== undefined ? Number(amount) : Number(existing.amount);
  const nextPay = paymentMethod !== undefined ? String(paymentMethod) : String(existing.payment_method);
  const nextDate = date !== undefined ? String(date) : String(existing.date);
  const nextTime = time !== undefined ? String(time) : String(existing.time);
  const nextNotes = notes !== undefined ? String(notes).trim() : String(existing.notes);

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE transactions
      SET type = ?, category = ?, description = ?, amount = ?, payment_method = ?, date = ?, time = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(nextType, nextCategory, nextDesc, nextAmount, nextPay, nextDate, nextTime, nextNotes, nowIso, id);

    if (existing.appointment_id) {
      db.prepare(`
        UPDATE appointments SET amount = ?, payment_method = ?, date = ?, time = ?, notes = ? WHERE id = ?
      `).run(nextAmount, nextPay, nextDate, nextTime, nextNotes, String(existing.appointment_id));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const updated = mapTransactionRow(db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<string, unknown>);
  res.json(updated);
});

app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT appointment_id FROM transactions WHERE id = ?').get(id) as { appointment_id: string | null } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Lançamento não encontrado.' });
    return;
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    if (existing.appointment_id) {
      db.prepare('DELETE FROM appointments WHERE id = ?').run(existing.appointment_id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true, deletedAppointmentId: existing.appointment_id });
});

// ==================== CASH CLOSING ====================
app.post('/api/cash-closings', requireAuth, (req: AuthedRequest, res) => {
  const { date, countedCash, notes } = req.body || {};
  const targetDate = date || getTodayBR();
  const settings = getSettingsObject();

  // Compute opening balance dynamically: initial opening balance + cumulative net before targetDate
  const prior = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END), 0) as entradas,
      COALESCE(SUM(CASE WHEN type = 'saida' THEN amount ELSE 0 END), 0) as saidas
    FROM transactions WHERE date < ?
  `).get(targetDate) as { entradas: number; saidas: number };

  const openingBalance = Number((settings.openingCashBalance + prior.entradas - prior.saidas).toFixed(2));

  const dayTxs = db.prepare('SELECT * FROM transactions WHERE date = ?').all(targetDate) as Record<string, unknown>[];
  let totalReceived = 0;
  let totalCash = 0;
  let totalPix = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  let totalExpenses = 0;

  for (const tx of dayTxs) {
    const amt = Number(tx.amount);
    if (tx.type === 'entrada') {
      totalReceived += amt;
      if (tx.payment_method === 'dinheiro') totalCash += amt;
      else if (tx.payment_method === 'pix') totalPix += amt;
      else if (tx.payment_method === 'debito') totalDebit += amt;
      else if (tx.payment_method === 'credito') totalCredit += amt;
    } else {
      totalExpenses += amt;
    }
  }

  const totalCard = totalDebit + totalCredit;
  const finalBalance = Number((openingBalance + totalReceived - totalExpenses).toFixed(2));
  const apptRow = db.prepare('SELECT COUNT(*) as cnt FROM appointments WHERE date = ?').get(targetDate) as { cnt: number };
  const nowIso = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM cash_closings WHERE date = ?').get(targetDate) as { id: string } | undefined;
  const id = existing ? existing.id : `cls_${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT OR REPLACE INTO cash_closings (
      id, date, opening_balance, total_received, total_cash, total_pix, total_debit, total_credit, total_card, total_expenses, final_balance, counted_cash, appointments_count, notes, closed_by, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    targetDate,
    openingBalance,
    Number(totalReceived.toFixed(2)),
    Number(totalCash.toFixed(2)),
    Number(totalPix.toFixed(2)),
    Number(totalDebit.toFixed(2)),
    Number(totalCredit.toFixed(2)),
    Number(totalCard.toFixed(2)),
    Number(totalExpenses.toFixed(2)),
    finalBalance,
    countedCash !== null && countedCash !== undefined && countedCash !== '' ? Number(countedCash) : null,
    apptRow.cnt,
    String(notes || '').trim(),
    req.user!.name,
    nowIso
  );

  const closing = mapClosingRow(db.prepare('SELECT * FROM cash_closings WHERE id = ?').get(id) as Record<string, unknown>);
  res.status(201).json(closing);
});

// ==================== ADMIN SETTINGS & USERS ====================
app.put('/api/settings', requireAuth, (req, res) => {
  const {
    shopName,
    openingCashBalance,
    dailyGoal,
    monthlyGoal,
    cloudSyncEnabled,
    cloudSyncUrl,
    pixKey,
    pixHolderName,
    pixCity,
  } = req.body || {};
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (shopName !== undefined) upsert.run('shop_name', String(shopName).trim() || 'Barbearia Trindade');
  if (openingCashBalance !== undefined) {
    const val = Number(openingCashBalance);
    upsert.run('opening_cash_balance', String(Number.isFinite(val) ? val : 0));
  }
  if (dailyGoal !== undefined) {
    const val = Number(dailyGoal);
    upsert.run('daily_goal', String(Number.isFinite(val) ? val : 0));
  }
  if (monthlyGoal !== undefined) {
    const val = Number(monthlyGoal);
    upsert.run('monthly_goal', String(Number.isFinite(val) ? val : 0));
  }
  if (cloudSyncEnabled !== undefined) upsert.run('cloud_sync_enabled', cloudSyncEnabled ? '1' : '0');
  if (cloudSyncUrl !== undefined) upsert.run('cloud_sync_url', String(cloudSyncUrl).trim());
  if (pixKey !== undefined) upsert.run('pix_key', String(pixKey).trim());
  if (pixHolderName !== undefined) upsert.run('pix_holder_name', String(pixHolderName).trim() || 'BARBEARIA TRINDADE');
  if (pixCity !== undefined) upsert.run('pix_city', String(pixCity).trim() || 'SAO PAULO');
  res.json(getSettingsObject());
});

// ==================== MEMBERSHIP PLANS & SUBSCRIBERS (PIX & REMINDERS) ====================
app.post('/api/plans', requireAuth, (req, res) => {
  const { name, description, includedServices, cycle, price } = req.body || {};
  if (!name || Number(price) <= 0 || !cycle) {
    res.status(400).json({ error: 'Nome, periodicidade e valor positivo são obrigatórios.' });
    return;
  }
  const id = `pln_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const srvArr = Array.isArray(includedServices)
    ? includedServices.map((s: unknown) => String(s).trim()).filter(Boolean)
    : String(includedServices || '').split(',').map((s) => s.trim()).filter(Boolean);

  db.prepare(`
    INSERT INTO membership_plans (id, name, description, included_services, cycle, price, active, is_template, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
  `).run(id, String(name).trim(), String(description || '').trim(), JSON.stringify(srvArr), String(cycle), Number(price), nowIso);

  const row = db.prepare('SELECT * FROM membership_plans WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json(mapPlanRow(row));
});

app.put('/api/plans/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM membership_plans WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Plano não encontrado.' });
    return;
  }
  const { name, description, includedServices, cycle, price, active } = req.body || {};
  const nextIncluded =
    includedServices !== undefined
      ? JSON.stringify(
          Array.isArray(includedServices)
            ? includedServices.map((s: unknown) => String(s).trim()).filter(Boolean)
            : String(includedServices).split(',').map((s) => s.trim()).filter(Boolean)
        )
      : String(existing.included_services);

  db.prepare(`
    UPDATE membership_plans SET name = ?, description = ?, included_services = ?, cycle = ?, price = ?, active = ? WHERE id = ?
  `).run(
    name !== undefined ? String(name).trim() : String(existing.name),
    description !== undefined ? String(description).trim() : String(existing.description),
    nextIncluded,
    cycle !== undefined ? String(cycle) : String(existing.cycle),
    price !== undefined ? Number(price) : Number(existing.price),
    active !== undefined ? (active ? 1 : 0) : Number(existing.active),
    id
  );
  const updated = db.prepare('SELECT * FROM membership_plans WHERE id = ?').get(id) as Record<string, unknown>;
  res.json(mapPlanRow(updated));
});

app.delete('/api/plans/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM membership_plans WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/subscribers', requireAuth, (req, res) => {
  const { clientName, clientPhone, planId, planName, includedServices, cycle, amount, paymentMethod, nextDueDate, notes } = req.body || {};
  if (!clientName || !planName || Number(amount) <= 0 || !cycle) {
    res.status(400).json({ error: 'Nome do cliente, plano, periodicidade e valor são obrigatórios.' });
    return;
  }
  const id = `sub_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO subscribers (id, client_name, client_phone, plan_id, plan_name, included_services, cycle, amount, payment_method, next_due_date, last_paid_at, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'ativo', ?, ?)
  `).run(
    id,
    String(clientName).trim(),
    String(clientPhone || '').trim(),
    String(planId || 'custom'),
    String(planName).trim(),
    String(includedServices || '').trim(),
    String(cycle),
    Number(amount),
    String(paymentMethod || 'pix'),
    String(nextDueDate || getTodayBR()),
    String(notes || '').trim(),
    nowIso
  );
  const row = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json(mapSubscriberRow(row));
});

app.put('/api/subscribers/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Mensalista não encontrado.' });
    return;
  }
  const { clientName, clientPhone, planName, includedServices, cycle, amount, paymentMethod, nextDueDate, status, notes } = req.body || {};
  db.prepare(`
    UPDATE subscribers
    SET client_name = ?, client_phone = ?, plan_name = ?, included_services = ?, cycle = ?, amount = ?, payment_method = ?, next_due_date = ?, status = ?, notes = ?
    WHERE id = ?
  `).run(
    clientName !== undefined ? String(clientName).trim() : String(existing.client_name),
    clientPhone !== undefined ? String(clientPhone).trim() : String(existing.client_phone),
    planName !== undefined ? String(planName).trim() : String(existing.plan_name),
    includedServices !== undefined ? String(includedServices).trim() : String(existing.included_services),
    cycle !== undefined ? String(cycle) : String(existing.cycle),
    amount !== undefined ? Number(amount) : Number(existing.amount),
    paymentMethod !== undefined ? String(paymentMethod) : String(existing.payment_method),
    nextDueDate !== undefined ? String(nextDueDate) : String(existing.next_due_date),
    status !== undefined ? String(status) : String(existing.status),
    notes !== undefined ? String(notes).trim() : String(existing.notes),
    id
  );
  const updated = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(id) as Record<string, unknown>;
  res.json(mapSubscriberRow(updated));
});

app.delete('/api/subscribers/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/subscribers/:id/pay', requireAuth, (req: AuthedRequest, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Mensalista não encontrado.' });
    return;
  }
  const { paymentMethod, amount, paidDate } = req.body || {};
  const today = getTodayBR();
  const actualDate = String(paidDate || today);
  const actualTime = getNowTimeBR();
  const finalAmount = amount !== undefined ? Number(amount) : Number(existing.amount);
  const finalPay = String(paymentMethod || existing.payment_method || 'pix');
  const currentDue = String(existing.next_due_date);
  const baseDateForNext = currentDue >= actualDate ? currentDue : actualDate;
  const nextDue = advanceDateByCycle(baseDateForNext, String(existing.cycle));
  const nowIso = new Date().toISOString();
  const txId = `trx_${crypto.randomUUID().slice(0, 8)}`;

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO transactions (id, type, category, description, amount, payment_method, date, time, appointment_id, notes, created_by, created_at, updated_at)
      VALUES (?, 'entrada', 'Planos / Assinaturas', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      txId,
      `${String(existing.plan_name)} — ${String(existing.client_name)}`,
      finalAmount,
      finalPay,
      actualDate,
      actualTime,
      `Renovação automática (${String(existing.cycle)})`,
      req.user!.id,
      nowIso,
      nowIso
    );

    db.prepare('UPDATE subscribers SET last_paid_at = ?, next_due_date = ?, status = ? WHERE id = ?').run(
      actualDate,
      nextDue,
      'ativo',
      id
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const subscriber = mapSubscriberRow(db.prepare('SELECT * FROM subscribers WHERE id = ?').get(id) as Record<string, unknown>);
  const transaction = mapTransactionRow(db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as Record<string, unknown>);
  res.json({ subscriber, transaction });
});

app.get('/api/users', requireAuth, (_req, res) => {
  const users = (db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at ASC').all() as Record<string, unknown>[]).map(mapUserRow);
  res.json(users);
});

app.post('/api/users', requireAuth, (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 4) {
    res.status(400).json({ error: 'Nome, e-mail e senha (mín. 4 caracteres) são obrigatórios.' });
    return;
  }
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(String(email).trim());
  if (existing) {
    res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
    return;
  }
  const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const hash = bcrypt.hashSync(String(password), 10);
  db.prepare('INSERT INTO users (id, name, email, role, password_hash, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
    id,
    String(name).trim(),
    String(email).trim().toLowerCase(),
    role || 'barber',
    hash,
    nowIso
  );
  const user = mapUserRow(db.prepare('SELECT id, name, email, role, active, created_at FROM users WHERE id = ?').get(id) as Record<string, unknown>);
  res.status(201).json(user);
});

app.put('/api/users/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, role, active, password } = req.body || {};
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return;
  }
  db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(
    name !== undefined ? String(name).trim() : String(existing.name),
    role !== undefined ? String(role) : String(existing.role),
    active !== undefined ? (active ? 1 : 0) : Number(existing.active),
    id
  );
  if (password && String(password).length >= 4) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), id);
  }
  const user = mapUserRow(db.prepare('SELECT id, name, email, role, active, created_at FROM users WHERE id = ?').get(id) as Record<string, unknown>);
  res.json(user);
});

app.delete('/api/users/:id', requireAuth, (req: AuthedRequest, res) => {
  const { id } = req.params;
  if (id === req.user!.id) {
    res.status(400).json({ error: 'Não é possível excluir o usuário logado atualmente.' });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ==================== PRIVATE CONFIDENTIAL AREA ====================
app.post('/api/private/records-list', requireAuth, (req, res) => {
  const { pin } = req.body || {};
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('private_pin_hash') as { value: string } | undefined;
  if (!row || !pin || !bcrypt.compareSync(String(pin), row.value)) {
    res.status(403).json({ error: 'Acesso negado à Área Privada.' });
    return;
  }
  const records = (db.prepare('SELECT * FROM private_records ORDER BY date DESC, created_at DESC').all() as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    type: String(r.type),
    amount: Number(r.amount),
    date: String(r.date),
    details: String(r.details || ''),
    createdAt: String(r.created_at),
  }));
  res.json(records);
});

app.post('/api/private/records', requireAuth, (req, res) => {
  const { pin, title, type, amount, date, details } = req.body || {};
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('private_pin_hash') as { value: string } | undefined;
  if (!row || !pin || !bcrypt.compareSync(String(pin), row.value)) {
    res.status(403).json({ error: 'Acesso negado à Área Privada.' });
    return;
  }
  if (!title || !type) {
    res.status(400).json({ error: 'Título e categoria são obrigatórios.' });
    return;
  }
  const id = `prv_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  db.prepare('INSERT INTO private_records (id, title, type, amount, date, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    String(title).trim(),
    type,
    Number(amount || 0),
    date || getTodayBR(),
    String(details || '').trim(),
    nowIso
  );
  const created = db.prepare('SELECT * FROM private_records WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json({
    id: String(created.id),
    title: String(created.title),
    type: String(created.type),
    amount: Number(created.amount),
    date: String(created.date),
    details: String(created.details || ''),
    createdAt: String(created.created_at),
  });
});

app.post('/api/private/records/:id/delete', requireAuth, (req, res) => {
  const { id } = req.params;
  const { pin } = req.body || {};
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('private_pin_hash') as { value: string } | undefined;
  if (!row || !pin || !bcrypt.compareSync(String(pin), row.value)) {
    res.status(403).json({ error: 'Acesso negado à Área Privada.' });
    return;
  }
  db.prepare('DELETE FROM private_records WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ==================== BACKUP, RESTORE & SYNC ====================
app.get('/api/backup/export', requireAuth, (_req, res) => {
  const services = (db.prepare('SELECT * FROM services').all() as Record<string, unknown>[]).map(mapServiceRow);
  const appointments = (db.prepare('SELECT * FROM appointments').all() as Record<string, unknown>[]).map(mapAppointmentRow);
  const transactions = (db.prepare('SELECT * FROM transactions').all() as Record<string, unknown>[]).map(mapTransactionRow);
  const cashClosings = (db.prepare('SELECT * FROM cash_closings').all() as Record<string, unknown>[]).map(mapClosingRow);
  const membershipPlans = (db.prepare('SELECT * FROM membership_plans').all() as Record<string, unknown>[]).map(mapPlanRow);
  const subscribers = (db.prepare('SELECT * FROM subscribers').all() as Record<string, unknown>[]).map(mapSubscriberRow);
  const settings = getSettingsObject();
  const backup = {
    app: 'Barbearia Trindade – Gestão Inteligente',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    services,
    appointments,
    transactions,
    cashClosings,
    membershipPlans,
    subscribers,
  };
  res.json(backup);
});

app.post('/api/backup/snapshot', requireAuth, (_req, res) => {
  const info = createSqliteBackup();
  res.json({ ok: true, filename: info.filename, lastBackupAt: info.timestamp });
});

app.post('/api/backup/restore', requireAuth, (req, res) => {
  const data = req.body || {};
  if (!Array.isArray(data.services) || !Array.isArray(data.transactions) || !Array.isArray(data.appointments)) {
    res.status(400).json({ error: 'Arquivo de backup inválido ou corrompido.' });
    return;
  }
  // Safety snapshot before restoring
  createSqliteBackup();

  db.exec('BEGIN');
  try {
    if (data.settings && typeof data.settings === 'object') {
      const s = data.settings as Record<string, unknown>;
      const upsertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      if (s.shopName !== undefined) upsertSetting.run('shop_name', String(s.shopName).trim() || 'Barbearia Trindade');
      if (s.openingCashBalance !== undefined && Number.isFinite(Number(s.openingCashBalance))) {
        upsertSetting.run('opening_cash_balance', String(Number(s.openingCashBalance)));
      }
      if (s.dailyGoal !== undefined && Number.isFinite(Number(s.dailyGoal))) {
        upsertSetting.run('daily_goal', String(Number(s.dailyGoal)));
      }
      if (s.monthlyGoal !== undefined && Number.isFinite(Number(s.monthlyGoal))) {
        upsertSetting.run('monthly_goal', String(Number(s.monthlyGoal)));
      }
      if (s.cloudSyncEnabled !== undefined) {
        upsertSetting.run('cloud_sync_enabled', s.cloudSyncEnabled ? '1' : '0');
      }
      if (s.cloudSyncUrl !== undefined) upsertSetting.run('cloud_sync_url', String(s.cloudSyncUrl || '').trim());
      if (s.pixKey !== undefined) upsertSetting.run('pix_key', String(s.pixKey || '').trim());
      if (s.pixHolderName !== undefined) upsertSetting.run('pix_holder_name', String(s.pixHolderName || '').trim() || 'BARBEARIA TRINDADE');
      if (s.pixCity !== undefined) upsertSetting.run('pix_city', String(s.pixCity || '').trim() || 'SAO PAULO');
    }

    db.prepare('DELETE FROM appointments').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM services').run();
    db.prepare('DELETE FROM cash_closings').run();

    const insSrv = db.prepare('INSERT OR REPLACE INTO services (id, name, category, price, duration_min, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const s of data.services) {
      insSrv.run(s.id, s.name, s.category || 'Geral', Number(s.price), Number(s.durationMin || 30), s.active ? 1 : 0, s.createdAt || new Date().toISOString());
    }
    const insApt = db.prepare('INSERT OR REPLACE INTO appointments (id, service_id, service_name, barber_name, client_name, amount, date, time, payment_method, notes, transaction_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const a of data.appointments) {
      insApt.run(a.id, a.serviceId, a.serviceName, a.barberName, a.clientName || '', Number(a.amount), a.date, a.time, a.paymentMethod, a.notes || '', a.transactionId || null, a.createdBy || 'usr_owner', a.createdAt || new Date().toISOString());
    }
    const insTx = db.prepare('INSERT OR REPLACE INTO transactions (id, type, category, description, amount, payment_method, date, time, appointment_id, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const t of data.transactions) {
      insTx.run(t.id, t.type, t.category, t.description, Number(t.amount), t.paymentMethod, t.date, t.time, t.appointmentId || null, t.notes || '', t.createdBy || 'usr_owner', t.createdAt || new Date().toISOString(), t.updatedAt || new Date().toISOString());
    }
    if (Array.isArray(data.cashClosings)) {
      const insCls = db.prepare('INSERT OR REPLACE INTO cash_closings (id, date, opening_balance, total_received, total_cash, total_pix, total_debit, total_credit, total_card, total_expenses, final_balance, counted_cash, appointments_count, notes, closed_by, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const c of data.cashClosings) {
        insCls.run(c.id, c.date, Number(c.openingBalance), Number(c.totalReceived), Number(c.totalCash), Number(c.totalPix), Number(c.totalDebit), Number(c.totalCredit), Number(c.totalCard), Number(c.totalExpenses), Number(c.finalBalance), c.countedCash ?? null, Number(c.appointmentsCount || 0), c.notes || '', c.closedBy || 'Sistema', c.closedAt || new Date().toISOString());
      }
    }
    if (Array.isArray(data.membershipPlans)) {
      db.prepare('DELETE FROM membership_plans').run();
      const insPlan = db.prepare('INSERT OR REPLACE INTO membership_plans (id, name, description, included_services, cycle, price, active, is_template, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const p of data.membershipPlans) {
        insPlan.run(
          String(p.id),
          String(p.name),
          String(p.description || ''),
          JSON.stringify(Array.isArray(p.includedServices) ? p.includedServices : []),
          String(p.cycle || 'mensal'),
          Number(p.price || 0),
          p.active ? 1 : 0,
          p.isTemplate ? 1 : 0,
          String(p.createdAt || new Date().toISOString())
        );
      }
    }
    if (Array.isArray(data.subscribers)) {
      db.prepare('DELETE FROM subscribers').run();
      const insSub = db.prepare('INSERT OR REPLACE INTO subscribers (id, client_name, client_phone, plan_id, plan_name, included_services, cycle, amount, payment_method, next_due_date, last_paid_at, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const s of data.subscribers) {
        insSub.run(
          String(s.id),
          String(s.clientName),
          String(s.clientPhone || ''),
          String(s.planId || 'custom'),
          String(s.planName),
          String(s.includedServices || ''),
          String(s.cycle || 'mensal'),
          Number(s.amount || 0),
          String(s.paymentMethod || 'pix'),
          String(s.nextDueDate || getTodayBR()),
          s.lastPaidAt ? String(s.lastPaidAt) : null,
          String(s.status || 'ativo'),
          String(s.notes || ''),
          String(s.createdAt || new Date().toISOString())
        );
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true });
});

app.post('/api/admin/clear-operations', requireAuth, (req, res) => {
  const { pin } = req.body || {};
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin_hash') as { value: string } | undefined;
  if (!row || !pin || !bcrypt.compareSync(String(pin), row.value)) {
    res.status(403).json({ error: 'Senha administrativa incorreta.' });
    return;
  }
  createSqliteBackup();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM appointments').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM cash_closings').run();
    db.prepare('DELETE FROM subscribers').run();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('opening_cash_balance', '0');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('daily_goal', '0');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('monthly_goal', '0');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true });
});

// ==================== API 404 & ERROR HANDLERS ====================
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Rota da API não encontrada.' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Erro interno no servidor:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ==================== VITE / STATIC SERVING ====================
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const distPath = path.resolve(process.cwd(), 'dist');
  const hasDistBuild = fs.existsSync(path.join(distPath, 'index.html'));
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);

  if (isProd || (!process.env.VITE_DEV && hasDistBuild && process.env.NODE_ENV !== 'development' && !process.argv[1]?.endsWith('tsx'))) {
    if (hasDistBuild) {
      app.use(
        express.static(distPath, {
          index: false,
          maxAge: '1y',
          immutable: true,
          setHeaders: (res, filePath) => {
            const base = path.basename(filePath);
            if (
              base === 'index.html' ||
              base === 'sw.js' ||
              base === 'registerSW.js' ||
              base === 'manifest.webmanifest' ||
              base.startsWith('workbox-')
            ) {
              res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
              res.setHeader('Cache-Control', 'public, max-age=86400');
            }
          },
        })
      );

      app.get('*', (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      app.get('*', (_req, res) => {
        res.status(503).send('Aplicação em build. Execute npm run build.');
      });
    }
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Barbearia Trindade servidor rodando na porta ${PORT} (${isProd ? 'producao' : 'desenvolvimento'})`);
  });

  const gracefulShutdown = () => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      db.close();
    } catch {
      // Ignore cleanup errors on shutdown
    }
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

startServer();
