// vitest-pool-workers 0.22 is een Vite-plugin geworden; defineWorkersConfig uit "./config" bestaat
// niet meer. De opties zijn dezelfde: de Worker uit wrangler.toml, met een nepsleutel als binding.
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          MISTRAL_API_KEY: "test-key-not-real",
        },
      },
    }),
  ],
});
