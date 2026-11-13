import type { Config } from "drizzle-kit";

export default {
  schema: "./src/modules/tasks/db/schema.ts",
  out: "./src/modules/tasks/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/tasks.db",
  },
} satisfies Config;
