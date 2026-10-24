import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = `http://127.0.0.1:${process.env.LAZYLINK_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": server, "/auth": server, "/media": server },
  },
});
