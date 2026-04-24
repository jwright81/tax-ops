import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

export async function ensureBootstrapAdmin() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query('SELECT id FROM users LIMIT 1');
    if (Array.isArray(rows) && rows.length > 0) {
      return { created: false };
    }

    const passwordHash = await bcrypt.hash(env.BOOTSTRAP_ADMIN_PASSWORD, 10);
    await conn.query(
      `INSERT INTO users (username, password_hash, role, active, must_change_password)
       VALUES (?, ?, 'admin', 1, 1)`,
      [env.BOOTSTRAP_ADMIN_USERNAME, passwordHash],
    );

    return { created: true, username: env.BOOTSTRAP_ADMIN_USERNAME };
  } finally {
    conn.release();
  }
}
