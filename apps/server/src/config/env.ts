import dotenv from 'dotenv';
import { envSchema } from '../../../../packages/shared/src/schemas/env.js';

dotenv.config({ path: process.env.CONFIG_PATH || '.env' });

export const env = envSchema.parse(process.env);
