import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/cli.ts',
  platform: 'node',
  copy: 'src/guide.md',
})
