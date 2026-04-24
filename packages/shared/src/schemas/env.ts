import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(8),
  SESSION_SECRET: z.string().min(8),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  BOOTSTRAP_ADMIN_USERNAME: z.string().min(1).default('admin'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8),
  WATCH_FOLDER: z.string().min(1),
  PROCESSED_FOLDER: z.string().min(1),
  REVIEW_FOLDER: z.string().min(1),
  CLIENTS_FOLDER: z.string().min(1),
  ORIGINALS_FOLDER: z.string().min(1),
});

export type AppEnv = z.infer<typeof envSchema>;
