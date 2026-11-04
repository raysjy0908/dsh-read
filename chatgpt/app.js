import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'

const h = React.createElement
const app = new App({ name: 'Paper Reader', version: '0.1.0' })
let snapshot = { active: navigator.language }
const listeners = new Set()
const locale = {
  getSnapshot: () => snapshot,
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
function updateLocale(context) {
  if (!context?.locale || context.locale === snapshot.active) return
  snapshot = { active: context.locale }
  document.documentElement.lang = context.locale
  for (const listener of listeners) listener()
}
app.onhostcontextchanged = updateLocale
const { origin } = new URL(import.meta.url)
let Reader
window.__ModuleLoader__ = {
  load({ factory }) {
    ;({ Reader } = factory(() => React, { assetBase: origin + '/dsh-paper-reader/' }))
  },
}
await import('../client.js')
delete window.__ModuleLoader__

const tabInfo = { tab: { visible: true } }
function Widget() {
  const { active } = React.useSyncExternalStore(locale.subscribe, locale.getSnapshot)
  const zh = active.startsWith('zh')
  const [draft, setDraft] = React.useState(null)
  const [sending, setSending] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  async function send(event) {
    event.preventDefault()
    setNotice('')
    setSending(true)
    try {
      const result = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: draft.trim() }] })
      if (result?.isError) throw new Error('Host refused the message')
      setDraft(null)
      setNotice(zh ? '已发送到会话。' : 'Sent to the conversation.')
    } catch {
      setNotice(zh ? '当前界面无法发送。可复制下方提问到 ChatGPT 会话。' :
        'Sending is unavailable here. Copy your question into the ChatGPT conversation.')
    } finally {
      setSending(false)
    }
  }
  const title = zh ? '编辑论文提问' : 'Edit paper question'
  return h('main', null,
    h('div', { className: 'reader' }, h(Reader, {
      useTabInfo: () => tabInfo, locale,
      onAsk: prompt => { setNotice(''); setDraft(prompt) },
    })),
    notice && h('p', { role: 'status' }, notice),
    draft !== null && h('form', { onSubmit: send, 'aria-label': title },
      h('label', null, title, h('textarea', { value: draft, onChange: e => setDraft(e.target.value),
        disabled: sending, autoFocus: true, rows: 5 })),
      h('button', { type: 'submit', disabled: sending || !draft.trim() }, zh ? '发送到会话' : 'Send to chat'),
      h('button', { type: 'button', disabled: sending, onClick: () => { setDraft(null); setNotice('') } },
        zh ? '取消' : 'Cancel')))
}

createRoot(document.querySelector('#app')).render(h(Widget))
if (window.parent !== window) {
  void app.connect().then(() => updateLocale(app.getHostContext())).catch(console.error)
}
