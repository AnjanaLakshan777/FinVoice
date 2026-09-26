import type { ApiConfig } from "@finvoice/config";
import { Module } from "@nestjs/common";

import { API_CONFIG } from "../../config/api-config.module.js";
import { LANGUAGE_MODEL } from "../model/language-model.js";
import { GeminiLanguageModel } from "./gemini.language-model.js";

/** Provides the LanguageModel, backed by Gemini with the model and key from the API config. */
@Module({
  providers: [
    {
      provide: LANGUAGE_MODEL,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => new GeminiLanguageModel(config.gemini),
    },
  ],
  exports: [LANGUAGE_MODEL],
})
export class GeminiModule {}
