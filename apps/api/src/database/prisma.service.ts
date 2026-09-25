import type { ApiConfig } from "@finvoice/config";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";

import { API_CONFIG } from "../config/api-config.module.js";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * The application's single Prisma client, backed by a `pg` connection pool.
 *
 * Connections are opened lazily on the first query, so the API starts even when the database
 * is briefly unavailable; `GET /health/ready` reports whether it is reachable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.database.url,
        // pg waits forever by default; fail fast instead so health checks and requests don't hang.
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  /** Round-trips a trivial query. Rejects if the database cannot be reached. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  /** Closes the connection pool on shutdown (requires `app.enableShutdownHooks()`). */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
