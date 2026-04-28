import { pool } from '../db/pool.js';

export interface SystemSetting {
  key: string;
  value: string;
}

const editableDefaultSettings: Record<string, string> = {
  office_name: 'Tax Office',
  auto_create_jobs: 'true',
  ocr_mode: 'internal',
  ocr_deskew: 'true',
  ocr_rotate_pages: 'true',
  ocr_jobs_enabled: 'true',
  ocr_jobs: '1',
  ocr_skip_text: 'true',
  ocr_sidecar: 'true',
  ocr_rotate_pages_threshold_enabled: 'false',
  ocr_rotate_pages_threshold: '14.0',
  ocr_clean: 'false',
  ocr_clean_final: 'false',
};

const editableSettingKeys = [
  'office_name',
  'auto_create_jobs',
  'ocr_mode',
  'ocr_deskew',
  'ocr_rotate_pages',
  'ocr_jobs_enabled',
  'ocr_jobs',
  'ocr_skip_text',
  'ocr_sidecar',
  'ocr_rotate_pages_threshold_enabled',
  'ocr_rotate_pages_threshold',
  'ocr_clean',
  'ocr_clean_final',
] as const;

const editableSettingKeySet = new Set<string>(editableSettingKeys);

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
    const rows = await conn.query('SELECT setting_key, setting_value FROM system_settings');
    const map = new Map(
      (Array.isArray(rows) ? rows : [])
        .filter((row) => editableSettingKeySet.has(row.setting_key))
        .map((row) => [row.setting_key, row.setting_value]),
    );

    return editableSettingKeys.map((key) => ({ key, value: map.get(key) ?? editableDefaultSettings[key] }));
  } finally {
    conn.release();
  }
}

export async function upsertSettings(settings: SystemSetting[]) {
  const conn = await pool.getConnection();
  try {
    for (const setting of settings) {
      if (!editableSettingKeySet.has(setting.key)) continue;
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
