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
  `CREATE TABLE IF NOT EXISTS tool_runs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tool_type VARCHAR(80) NOT NULL,
    source_kind ENUM('upload', 'existing_document') NOT NULL,
    source_document_id INT NULL,
    source_filename VARCHAR(255) NOT NULL,
    source_path VARCHAR(500) NOT NULL,
    client_id INT NULL,
    status ENUM('queued', 'processing', 'reviewing', 'completed', 'failed') NOT NULL DEFAULT 'queued',
    page_count INT NULL,
    selected_page_range VARCHAR(120) NULL,
    detected_metadata_json LONGTEXT NULL,
    created_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tool_runs_type_created_at (tool_type, created_at),
    INDEX idx_tool_runs_status (status),
    CONSTRAINT fk_tool_runs_source_document FOREIGN KEY (source_document_id) REFERENCES documents(id) ON DELETE SET NULL,
    CONSTRAINT fk_tool_runs_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS tool_run_pages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    run_id INT NOT NULL,
    page_number INT NOT NULL,
    status ENUM('queued', 'processing', 'ready', 'reviewed', 'failed') NOT NULL DEFAULT 'queued',
    review_status ENUM('pending', 'reviewed', 'flagged') NOT NULL DEFAULT 'pending',
    preview_path VARCHAR(500) NULL,
    text_path VARCHAR(500) NULL,
    extracted_text LONGTEXT NULL,
    warnings_json LONGTEXT NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_tool_run_page (run_id, page_number),
    INDEX idx_tool_run_pages_status (status),
    CONSTRAINT fk_tool_run_pages_run FOREIGN KEY (run_id) REFERENCES tool_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS tool_run_page_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    run_page_id INT NOT NULL,
    result_json LONGTEXT NULL,
    normalized_rows_json LONGTEXT NULL,
    audit_json LONGTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_tool_run_page_result (run_page_id),
    CONSTRAINT fk_tool_run_page_results_page FOREIGN KEY (run_page_id) REFERENCES tool_run_pages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS tool_run_exports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    run_id INT NOT NULL,
    export_type ENUM('txf') NOT NULL,
    status ENUM('queued', 'completed', 'failed') NOT NULL DEFAULT 'queued',
    output_path VARCHAR(500) NULL,
    summary_json LONGTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tool_run_exports_run_created_at (run_id, created_at),
    CONSTRAINT fk_tool_run_exports_run FOREIGN KEY (run_id) REFERENCES tool_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS ai_providers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_key VARCHAR(120) NOT NULL UNIQUE,
    kind ENUM('openai', 'lmstudio', 'ollama') NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    status ENUM('unconfigured', 'configured', 'connected', 'error') NOT NULL DEFAULT 'unconfigured',
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    is_fallback TINYINT(1) NOT NULL DEFAULT 0,
    configured_model VARCHAR(255) NULL,
    available_models_json LONGTEXT NULL,
    config_json LONGTEXT NULL,
    last_error TEXT NULL,
    last_connected_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ai_providers_kind (kind),
    INDEX idx_ai_providers_default (is_default),
    INDEX idx_ai_providers_fallback (is_fallback)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
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
