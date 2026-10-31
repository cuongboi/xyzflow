import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const lib = resolve(import.meta.dirname, "../../packages/react/src")

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(import.meta.dirname, "./src") },
      // resolve the library from source: instant HMR, no library rebuild needed
      { find: /^z-flow\/core$/, replacement: `${lib}/core/index.ts` },
      { find: /^z-flow$/, replacement: `${lib}/index.ts` },
    ],
    dedupe: ["react", "react-dom", "three", "@react-three/fiber"],
  },
})
