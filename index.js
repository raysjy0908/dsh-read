import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const root = '/dsh-paper-reader'
const types = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
}

export function apply(ctx) {
  ctx.inject(['webServer'], scope => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: root,
      async handler(req, res) {
        const path = new URL(req.url, 'http://localhost').pathname.slice(root.length + 1)
        const allowed = path === 'reader.css' ||
          /^vendor\/(?:build|web|web\/images|cmaps|standard_fonts|wasm|iccs)\/[\w.-]+$/.test(path)
        if (!allowed || !['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(404).end()
          return
        }
        try {
          const body = await readFile(new URL(path, import.meta.url))
          res.writeHead(200, {
            'Content-Type': types[extname(path)] ?? 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
          }).end(req.method === 'HEAD' ? undefined : body)
        } catch (error) {
          res.writeHead(error.code === 'ENOENT' ? 404 : 500).end()
        }
      },
    }))
  })
}
