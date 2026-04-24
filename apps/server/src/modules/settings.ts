import { pool } from '../db/pool.js';

export interface SystemSetting {
  key: string;
  value: string;
}

const defaultSettings: Record<string, string> = {
  office_name: 'Tax Office',
  watch_folder: '/data/incoming',
  processed_folder: '/data/processed',
  review_folder: '/data/review',
  clients_folder: '/data/clients',
  originals_folder: '/data/originals',
  auto_create_jobs: 'true',
};

export async function ensureDefaultSettings() {
  const conn = await pool.getConnection();
  try {
    for (const [key, value] of Object.entries(defaultSettings)) {
      await conn.query(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = setting_value`,
        [key, value],
      );
    }
  } finally {
    conn.release();
  }
}

export async function listSettings() {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      'SELECT setting_key, setting_value FROM system_settings ORDER BY setting_key ASC',
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({ key: row.setting_key, value: row.setting_value }));
  } finally {
    conn.release();
  }
}

export async function upsertSettings(settings: SystemSetting[]) {
  const conn = await pool.getConnection();
  try {
    for (const setting of settings) {
      await conn.query(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [setting.key, setting.value],
      );
    }
  } finally {
    conn.release();
  }
}
