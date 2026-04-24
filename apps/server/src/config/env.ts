import dotenv from 'dotenv';
import { envSchema } from '@tax-ops/shared';

dotenv.config({ path: process.env.CONFIG_PATH || '.env' });

export const env = envSchema.parse(process.env);
