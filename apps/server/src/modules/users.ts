import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';

export type UserRole = 'admin' | 'staff';

function mapUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  };
}

export async function listUsers() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, username, role, active, must_change_password, created_at, updated_at, last_login_at
       FROM users ORDER BY username ASC`,
    );
    return (Array.isArray(rows) ? rows : []).map(mapUser);
  } finally {
    conn.release();
  }
}

export async function getUserById(userId: number) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, username, role, active, must_change_password, created_at, updated_at, last_login_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    const user = Array.isArray(rows) ? rows[0] : null;
    return user ? mapUser(user) : null;
  } finally {
    conn.release();
  }
}

export async function createUser(input: { username: string; password: string; role: UserRole; active?: boolean }) {
  const conn = await pool.getConnection();
  try {
    const passwordHash = await bcrypt.hash(input.password, 10);
    const result = await conn.query(
      `INSERT INTO users (username, password_hash, role, active, must_change_password)
       VALUES (?, ?, ?, ?, 1)`,
      [input.username, passwordHash, input.role, input.active ?? true],
    );
    return getUserById(Number(result.insertId));
  } finally {
    conn.release();
  }
}

export async function updateUser(userId: number, input: { role?: UserRole; active?: boolean; mustChangePassword?: boolean }) {
  const conn = await pool.getConnection();
  try {
    const updates: string[] = [];
    const values: Array<string | number | boolean> = [];

    if (input.role) {
      updates.push('role = ?');
      values.push(input.role);
    }
    if (typeof input.active === 'boolean') {
      updates.push('active = ?');
      values.push(input.active ? 1 : 0);
    }
    if (typeof input.mustChangePassword === 'boolean') {
      updates.push('must_change_password = ?');
      values.push(input.mustChangePassword ? 1 : 0);
    }

    if (updates.length === 0) {
      return getUserById(userId);
    }

    values.push(userId);
    await conn.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    return getUserById(userId);
  } finally {
    conn.release();
  }
}

export async function resetUserPassword(userId: number, password: string) {
  const conn = await pool.getConnection();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await conn.query(
      'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
      [passwordHash, userId],
    );
    return getUserById(userId);
  } finally {
    conn.release();
  }
}

export async function recordAudit(actorUserId: number | null, action: string, targetType: string, targetId: string | null, details: unknown) {
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, details_json)
       VALUES (?, ?, ?, ?, ?)`,
      [actorUserId, action, targetType, targetId, details ? JSON.stringify(details) : null],
    );
  } finally {
    conn.release();
  }
}
