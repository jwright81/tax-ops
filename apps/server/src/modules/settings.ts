import { pool } from '../db/pool.js';

export interface SystemSetting {
  key: string;
  value: string;
}

const editableDefaultSettings: Record<string, string> = {
  office_name: 'Tax Office',
  auto_create_jobs: 'true',
};

export async function ensureDefaultSettings() {
  const conn = await pool.getConnection();
  try {
    for (const [key, value] of Object.entries(editableDefaultSettings)) {
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
      'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?) ORDER BY setting_key ASC',
      ['auto_create_jobs', 'office_name'],
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({ key: row.setting_key, value: row.setting_value }));
  } finally {
    conn.release();
  }
}

export async function upsertSettings(settings: SystemSetting[]) {
  const allowed = new Set(['auto_create_jobs', 'office_name']);
  const conn = await pool.getConnection();
  try {
    for (const setting of settings) {
      if (!allowed.has(setting.key)) continue;
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

export async function getSettingsMap() {
  const settings = await listSettings();
  return Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
}
