import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

const background = '#1b1d22';

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { ...minimal2023Preset.maskable.resizeOptions, background },
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { ...minimal2023Preset.apple.resizeOptions, background },
    },
  },
  images: ['public/logo.svg'],
});
