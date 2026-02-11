import { defineConfig } from 'rolldown'

export default defineConfig([
  {
    input: 'src/cli.ts',
    output: {
      file: 'dist/cli.js',
      format: 'esm',
      sourcemap: true
    },
    platform: 'node',
    target: 'node24'
  },
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.js',
      format: 'esm',
      sourcemap: true
    },
    platform: 'node',
    target: 'node24'
  },
  {
    input: 'src/core/text-inspector.test.ts',
    output: {
      file: 'dist/core/text-inspector.test.js',
      format: 'esm',
      sourcemap: true
    },
    platform: 'node',
    target: 'node24'
  }
])
