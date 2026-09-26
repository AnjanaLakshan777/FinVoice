/**
 * Loads the curated financial-literacy knowledge base (prisma/knowledge/content.ts).
 *
 * Run with `pnpm db:seed:knowledge`. Insert-only and idempotent: it adds missing sources, articles
 * and translations, and never updates or deletes existing records, so it cannot overwrite
 * knowledge edited in the database. Records that differ from the seed content are listed.
 *
 * Unlike the demo seed (prisma/seed.ts), this content is real and meant for every environment.
 * Against a production database (NODE_ENV=production) it still refuses to run unless
 * `--allow-production` is passed, so it is never run there by accident.
 */
import { loadDatabaseConfig } from "@finvoice/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { seedKnowledge } from "./knowledge/seed-knowledge.js";

async function main(): Promise<void> {
  const config = loadDatabaseConfig();
  if (config.nodeEnv === "production" && !process.argv.includes("--allow-production")) {
    throw new Error(
      "Refusing to seed knowledge: NODE_ENV is production. Re-run with --allow-production to confirm.",
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.url }) });
  try {
    const report = await seedKnowledge(prisma);
    const { sources, articles, translations } = report.created;
    console.info(
      `Knowledge seed: created ${String(sources)} sources, ${String(articles)} articles and ` +
        `${String(translations)} translations; ${String(report.unchanged)} records already up to date.`,
    );
    if (report.differing.length > 0) {
      console.warn(
        `Left unchanged because the database differs from the seed content:\n- ${report.differing.join("\n- ")}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
