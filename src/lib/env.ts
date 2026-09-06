/** Centralised, validated environment access. Fails fast on misconfiguration. */
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_COOKIE: z.string().default("rtm_session"),
  PORT: z.coerce.number().default(3000),
  HOSTNAME: z.string().default("localhost"),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  GIPHY_API_KEY: z.string().min(1),
  STORAGE_DIR: z.string().default("./storage"),
  MAX_UPLOAD_BYTES: z.coerce.number().default(8_388_608),
  NSFW_MODEL_DIR: z.string().default("./public/models/nsfw"),
  NSFW_THRESHOLD: z.coerce.number().default(0.6),
});

export const env = schema.parse(process.env);
