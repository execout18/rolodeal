import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `vercel dev` runs the API route on 3000; this lets `npm run dev` reach it
    proxy: { "/api": "http://localhost:3000" },
  },
});
