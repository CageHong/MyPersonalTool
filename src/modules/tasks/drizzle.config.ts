import type { Config } from "drizzle-kit";
import { DB_PATH } from "./db/path";

export default {
  schema: "./src/modules/tasks/db/schema.ts",
  out: "./src/modules/tasks/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: DB_PATH,
  },
} satisfies Config;
