/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

const dark = '#1b1d22';

/** Artifact build: drop head tags that point at files the single-file page doesn't ship (icons, PWA hints). */
function artifactHtml(): Plugin {
  return {
    name: 'rwtm-artifact-html',
    transformIndexHtml(html) {
      return html
        .replace(/^\s*<link rel="(icon|apple-touch-icon)"[^>]*>\n/gm, '')
        .replace(/^\s*<meta name="(apple-mobile-web-app-[a-z-]+|mobile-web-app-capable)"[^>]*>\n/gm, '');
    },
  };
}

export default defineConfig(({ mode }) => {
  // `vite build --mode artifact`: one self-contained HTML file for a Claude artifact, data in the artifact's
  // db capability (src/db/cloudSync.ts), no service worker or manifest.
  if (mode === 'artifact') {
    return {
      base: './',
      publicDir: false,
      define: { 'import.meta.env.VITE_ARTIFACT': JSON.stringify('1') },
      plugins: [react(), artifactHtml(), viteSingleFile({ removeViteModuleLoader: true })],
      build: { outDir: 'dist-artifact', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
    };
  }
  return {
    base: process.env.BASE_PATH ?? '/',
    // Fixed at build time, so the artifact-only code (and fake-indexeddb) drops out of the PWA bundle.
    define: mode === 'test' ? {} : { 'import.meta.env.VITE_ARTIFACT': JSON.stringify('') },
    plugins: [
      react(),
      // 'prompt' + no update UI: a new service worker waits and takes over on the
      // next launch (all tabs closed), so an open session is never interrupted (spec §6).
      VitePWA({
        registerType: 'prompt',
        injectRegister: 'auto',
        includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
        manifest: {
          name: 'Rage with the machine',
          short_name: 'RWTM',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '.',
          scope: '.',
          background_color: dark,
          theme_color: dark,
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          navigateFallback: 'index.html',
        },
      }),
    ],
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      globals: true,
    },
  };
});
