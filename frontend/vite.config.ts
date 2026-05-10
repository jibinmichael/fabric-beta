import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // vfile uses package subpath imports (#minpath); map to browser builds for Rollup/Vite 3
      "#minpath": path.resolve(__dirname, "./node_modules/vfile/lib/minpath.browser.js"),
      "#minproc": path.resolve(__dirname, "./node_modules/vfile/lib/minproc.browser.js"),
      "#minurl": path.resolve(__dirname, "./node_modules/vfile/lib/minurl.browser.js"),
    },
  },
})
