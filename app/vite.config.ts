import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// SPEC §11.2 — the stack, minus everything P0a does not need yet.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // SPEC §11.2: injectManifest, not generateSW. We own src/sw.ts; the
      // plugin only injects the precache file list into it.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // SPEC §9.8: a PWA cannot force an update, so the user is asked.
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      manifest: {
        id: '/',
        name: 'Lane',
        short_name: 'Lane',
        description: 'A personal task manager between Google Tasks and Trello.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#12151c',
        theme_color: '#12151c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        // So the install prompt and update flow can be exercised in dev too.
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
})
