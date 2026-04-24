import { z } from 'zod';
export declare const envSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<{
        development: "development";
        test: "test";
        production: "production";
    }>>;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    APP_URL: z.ZodDefault<z.ZodString>;
    JWT_SECRET: z.ZodString;
    SESSION_SECRET: z.ZodString;
    DB_HOST: z.ZodString;
    DB_PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    DB_NAME: z.ZodString;
    DB_USER: z.ZodString;
    DB_PASSWORD: z.ZodString;
    BOOTSTRAP_ADMIN_USERNAME: z.ZodDefault<z.ZodString>;
    BOOTSTRAP_ADMIN_PASSWORD: z.ZodString;
    WATCH_FOLDER: z.ZodString;
    PROCESSED_FOLDER: z.ZodString;
    REVIEW_FOLDER: z.ZodString;
    CLIENTS_FOLDER: z.ZodString;
    ORIGINALS_FOLDER: z.ZodString;
}, z.core.$strip>;
export type AppEnv = z.infer<typeof envSchema>;
