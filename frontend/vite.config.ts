import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned: backend CORS (Laptop A server.ts) allows exactly this origin.
  server: { port: 5173, strictPort: true },
})
