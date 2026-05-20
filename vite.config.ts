import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import Layouts from 'vite-plugin-vue-layouts'
import { VueRouterAutoImports } from 'vue-router/unplugin'
import VueRouter from 'vue-router/vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '127.0.0.1',
    watch: {
      ignored: ['**/server/data/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    VueRouter(),
    vue(),
    AutoImport({
      imports: ['vue', VueRouterAutoImports, 'pinia'],
      dts: true,
      eslintrc: {
        enabled: true,
      },
    }),
    Layouts({
      layoutsDirs: './src/layouts',
      pagesDirs: './src/pages',
      defaultLayout: 'default'
    }),
    Components({
      dts: true,
    }),
  ],
})
