import { pool } from './pool.js';

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'staff') NOT NULL DEFAULT 'staff',
    active TINYINT(1) NOT NULL DEFAULT 1,
    must_change_password TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL DEFAULT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(120) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actor_user_id INT NULL,
    action VARCHAR(120) NOT NULL,
    target_type VARCHAR(120) NOT NULL,
    target_id VARCHAR(120) NULL,
    details_json LONGTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_created_at (created_at),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS processing_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_type VARCHAR(80) NOT NULL,
    status ENUM('queued', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'queued',
    source_path VARCHAR(500) NOT NULL,
    message TEXT NULL,
    payload_json LONGTEXT NULL,
    result_json LONGTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_processing_jobs_status (status),
    INDEX idx_processing_jobs_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id INT NULL,
    original_filename VARCHAR(255) NOT NULL,
    original_path VARCHAR(500) NOT NULL,
    current_path VARCHAR(500) NOT NULL,
    tax_year VARCHAR(10) NULL,
    form_type VARCHAR(120) NULL,
    issuer VARCHAR(255) NULL,
    client_name VARCHAR(255) NULL,
    ssn_last4 VARCHAR(4) NULL,
    status ENUM('intake', 'review', 'filed', 'error') NOT NULL DEFAULT 'intake',
    confidence_score DECIMAL(5,2) NULL,
    extracted_text LONGTEXT NULL,
    ocr_status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    ocr_provider VARCHAR(120) NULL,
    review_notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_documents_status (status),
    INDEX idx_documents_client_name (client_name),
    CONSTRAINT fk_documents_job FOREIGN KEY (job_id) REFERENCES processing_jobs(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_provider VARCHAR(120) NULL`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS review_notes TEXT NULL`,
];

export async function runMigrations() {
  const conn = await pool.getConnection();
  try {
    for (const statement of statements) {
      try {
        await conn.query(statement);
      } catch (error) {
        const text = String(error);
        if (!text.includes('Duplicate column') && !text.includes('check that column/key exists')) {
          throw error;
        }
      }
    }
  } finally {
    conn.release();
  }
}
