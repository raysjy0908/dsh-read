import { build } from 'esbuild'
await build({
  entryPoints: ['app.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  outfile: 'dist/app.js',
})
