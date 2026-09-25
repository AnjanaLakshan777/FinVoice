import { loadApiConfig } from "@finvoice/config";
import { Global, Module } from "@nestjs/common";

/**
 * Injection token for the validated {@link import("@finvoice/config").ApiConfig}.
 * The object contains credentials: never log or serialize it.
 */
export const API_CONFIG = Symbol("API_CONFIG");

/** Loads and validates the API configuration once, and makes it injectable everywhere. */
@Global()
@Module({
  providers: [{ provide: API_CONFIG, useFactory: () => loadApiConfig() }],
  exports: [API_CONFIG],
})
export class ApiConfigModule {}
