import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // React-free entry: use the store/history in workers, Node, or other renderers
    core: 'src/core/index.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  fixedExtension: false, // emit .js / .d.ts to match package.json "exports"
  external: ['react', 'react/jsx-runtime', 'three', /^@react-three\//],
})
