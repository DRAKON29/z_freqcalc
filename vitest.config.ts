import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // CSS Leaflet не нужен в jsdom-тестах — пустая заглушка (PostCSS-конфиг Tailwind несовместим с vite-loader)
      'leaflet/dist/leaflet.css': path.resolve(__dirname, './tests/empty.css'),
      // Старые тесты написаны под bun:test — запускаем их тем же раннером vitest
      'bun:test': 'vitest',
    },
  },
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // Leaflet требует ResizeObserver/matchMedia и реальной вёрстки — карта мокается в тестах
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html'],
      reportsDirectory: 'coverage',
      include: [
        'src/lib/**/*.{ts,tsx}',
        'src/store/**/*.{ts,tsx}',
        'src/hooks/**/*.{ts,tsx}',
        'src/components/radio/**/*.{ts,tsx}',
        'src/app/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/components/ui/**',
        // Файлы только с типами — рантайм-кода нет, покрытие не имеет смысла
        'src/lib/radio/types.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 60,
        lines: 60,
      },
    },
  },
})
