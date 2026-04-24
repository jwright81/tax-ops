import * as mariadb from 'mariadb';
import { env } from '../config/env.js';

export const pool = mariadb.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  connectionLimit: 5,
});
