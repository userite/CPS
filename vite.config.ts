import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { blondinaPlugin } from "./src/server/blondinaPlugin";

export default defineConfig({
  plugins: [react(), blondinaPlugin()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Vite blocks every Windows path that contains "~" while fs.strict is on.
    // This project lives in C:\~ip\..., so the dev server must turn that check off.
    fs: { strict: false },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
