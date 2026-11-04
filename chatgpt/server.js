import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { apply as registerReaderAssets } from '../index.js'

const port = Number(process.env.PORT ?? 8787)
const publicUrl = new URL(process.env.PAPER_READER_URL ?? `http://localhost:${port}`)
if (publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' ||
    publicUrl.search || publicUrl.hash ||
    (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(publicUrl.hostname)))) {
  throw new Error('PAPER_READER_URL must be the HTTPS origin, or a local HTTP origin for development')
}
const origin = publicUrl.origin
const bundle = await readFile(new URL('./dist/app.js', import.meta.url))
const uiUri = 'ui://paper-reader/index.html'
const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${origin}/dsh-paper-reader/vendor/web/pdf_viewer.css">
<link rel="stylesheet" href="${origin}/dsh-paper-reader/reader.css">
<style>
  html { color-scheme: light dark; font: 14px system-ui; }
  body { margin: 0; color: CanvasText; background: Canvas; }
  .reader { height: min(68vh, 760px); min-height: 340px; }
  form, main > p { padding: 8px 12px; margin: 0; }
  form textarea { display: block; width: 100%; box-sizing: border-box; margin: 6px 0; font: inherit; }
  form button { margin-inline-end: 8px; }
</style>
<div id="app"></div><script type="module" src="${origin}/app.js"></script></html>`

let assets
registerReaderAssets({
  inject(_services, setup) {
    setup({ effect: register => register(), webServer: { register: route => { assets = route } } })
  },
})
function makeMcpServer() {
  const mcp = new McpServer({ name: 'paper-reader', version: '0.1.0' })
  registerAppResource(mcp, 'paper-reader', uiUri, {}, async () => ({
    contents: [{
      uri: uiUri, mimeType: RESOURCE_MIME_TYPE, text: html,
      _meta: { ui: { csp: { resourceDomains: [origin], connectDomains: [origin] } } },
    }],
  }))
  registerAppTool(mcp, 'open_paper_reader', {
    title: 'Paper Reader / 论文阅读器',
    description: 'Open the local PDF reader to import and read a paper and annotate or ask about a selection.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiUri },
      'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] },
    },
  }, async () => ({
    content: [{ type: 'text', text: 'Paper Reader opened. Choose a PDF in the reader to begin.' }],
  }))
  return mcp
}

createServer(async (req, res) => {
  try {
    const path = new URL(req.url, origin).pathname
    if (path === '/mcp' && req.method === 'POST') {
      const mcp = makeMcpServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => { void mcp.close() })
      await mcp.connect(transport)
      await transport.handleRequest(req, res)
      return
    }
    if (path === '/mcp') {
      res.writeHead(405, { Allow: 'POST' }).end()
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      if (path.startsWith(assets.path + '/')) {
        await assets.handler(req, res)
        return
      }
      if (path === '/app.js' || path === '/') {
        const type = path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
        res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' })
          .end(req.method === 'HEAD' ? undefined : (path === '/' ? html : bundle))
        return
      }
    }
    res.writeHead(404).end()
  } catch (error) {
    console.error(error)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }
}).listen(port, process.env.HOST ?? '127.0.0.1', () => console.log('Paper Reader MCP endpoint: ' + origin + '/mcp'))
