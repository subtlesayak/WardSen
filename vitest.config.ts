import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@wardsen/core": "/packages/core/src/index.ts",
      "@wardsen/security": "/packages/security/src/index.ts",
      "@wardsen/database": "/packages/database/src/index.ts",
      "@wardsen/provider-bitwarden": "/packages/provider-bitwarden/src/index.ts",
      "@wardsen/provider-keepassxc": "/packages/provider-keepassxc/src/index.ts",
      "@wardsen/delivery-bitwarden-send": "/packages/delivery-bitwarden-send/src/index.ts",
      "@wardsen/provider-scaffolds": "/packages/provider-scaffolds/src/index.ts"
    }
  }
});
