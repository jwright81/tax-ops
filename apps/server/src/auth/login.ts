import bcrypt from 'bcryptjs';
import { signAuthToken } from './jwt.js';
import { pool } from '../db/pool.js';

export async function authenticate(username: string, password: string) {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT id, username, password_hash, role, active, must_change_password, created_at, updated_at, last_login_at
       FROM users WHERE username = ? LIMIT 1`,
      [username],
    );

    const user = Array.isArray(rows) ? rows[0] : null;
    if (!user || !user.active) {
      return null;
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return null;
    }

    await conn.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    const token = signAuthToken({
      sub: String(user.id),
      username: user.username,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        active: Boolean(user.active),
        mustChangePassword: Boolean(user.must_change_password),
        createdAt: new Date(user.created_at).toISOString(),
        updatedAt: new Date(user.updated_at).toISOString(),
        lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
      },
    };
  } finally {
    conn.release();
  }
}
