import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ['@mediapipe/tasks-vision'],
  minify: 'terser',
  terserOptions: {
    compress: {
      drop_console: true,
      drop_debugger: true,
      passes: 2,
    },
    mangle: {
      toplevel: true,
      properties: {
        regex: /^_/,
      },
    },
    format: {
      comments: false,
    },
  },
  treeshake: true,
  target: 'es2020',
});
