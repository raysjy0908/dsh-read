window.__ModuleLoader__.load({
  id: 'dsh-paper-reader',
  factory(require, { assetBase } = {}) {
    const { createElement: h, useEffect, useRef, useState, useSyncExternalStore } = require('react')
    const id = 'dsh-paper-reader'
    const base = assetBase ?? '/' + id + '/'
    const vendor = base + 'vendor/'
    const copy = {
      zh: {
        title: '论文阅读器', guide: '阅读原版 PDF、批注选区并在会话中提问',
        upload: '导入 PDF', choose: '选择论文', original: '下载原件', notes: '标注',
        highlight: '高亮', note: '添加笔记', ask: '在会话中提问', save: '保存', cancel: '取消',
        remove: '删除', empty: '导入一份 PDF 开始阅读。扫描版可查看，选字需要 PDF 自带文字层。',
        loading: '正在打开 PDF…', fit: '适应宽度', password: '请输入 PDF 密码',
        inserted: '已填入当前会话的输入框。', blocked: '输入框暂不可编辑，请稍后重试。',
        page: '页', previous: '上一页', next: '下一页', noNotes: '暂无标注。',
        error: '论文阅读器遇到问题', prompt: (name, pages, quote) =>
          `请用中文解释论文《${name}》第 ${pages} 页的以下选段，并说明理解它所需的背景。如果仅凭选段无法判断，请指出缺少的上下文。\n\n${quote}`,
      },
      en: {
        title: 'Paper Reader', guide: 'Read original PDFs, annotate passages, and ask in chat',
        upload: 'Import PDF', choose: 'Choose a paper', original: 'Download original', notes: 'Annotations',
        highlight: 'Highlight', note: 'Add note', ask: 'Ask in chat', save: 'Save', cancel: 'Cancel',
        remove: 'Delete', empty: 'Import a PDF to start reading. Scans need a text layer for selection.',
        loading: 'Opening PDF…', fit: 'Fit width', password: 'Enter the PDF password',
        inserted: 'Added to the current conversation draft.', blocked: 'The composer is busy. Try again shortly.',
        page: 'Page', previous: 'Previous page', next: 'Next page', noNotes: 'No annotations yet.',
        error: 'Paper Reader error', prompt: (name, pages, quote) =>
          `Explain the passage below from "${name}" (PDF page(s) ${pages}) in English. Include the background needed to understand it, and identify any context missing from the excerpt.\n\n${quote}`,
      },
    }

    let database
    function openDatabase() {
      database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(id, 1)
        request.onupgradeneeded = () => {
          request.result.createObjectStore('papers', { keyPath: 'id' })
          request.result.createObjectStore('originals')
          request.result.createObjectStore('marks', { keyPath: 'id' }).createIndex('paper', 'paper')
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }).catch(error => {
        database = undefined
        throw error
      })
      return database
    }

    async function storage(store, mode, operation) {
      const db = await openDatabase()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const request = operation(typeof store === 'string' ? tx.objectStore(store) : tx)
        tx.oncomplete = () => resolve(request?.result)
        tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'))
      })
    }

    let libraries
    function loadLibraries() {
      libraries ??= (async () => {
        const pdf = await import(vendor + 'build/pdf.mjs')
        const viewer = await import(vendor + 'web/pdf_viewer.mjs')
        pdf.GlobalWorkerOptions.workerSrc = new URL(vendor + 'build/pdf.worker.mjs', location.href).href
        return { pdf, viewer }
      })().catch(error => {
        libraries = undefined
        throw error
      })
      return libraries
    }

    function capture(root, viewerElement) {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) return null
      const range = selection.getRangeAt(0)
      const text = selection.toString().trim()
      if (!text || !viewerElement.contains(range.startContainer) ||
          !viewerElement.contains(range.endContainer)) return null
      const pages = []
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
      for (const page of viewerElement.querySelectorAll('.page[data-page-number]')) {
        const layer = page.querySelector('.textLayer')
        if (!layer || !range.intersectsNode(layer)) continue
        const bounds = layer.getBoundingClientRect()
        const boxes = rects.flatMap(rect => {
          const x = Math.max(rect.left, bounds.left)
          const y = Math.max(rect.top, bounds.top)
          const right = Math.min(rect.right, bounds.right)
          const bottom = Math.min(rect.bottom, bounds.bottom)
          if (right <= x || bottom <= y) return []
          // Ignore container rectangles emitted alongside the individual glyph runs.
          if (rect.height >= bounds.height * 0.9 && rect.width >= bounds.width * 0.9) return []
          return [[(x - bounds.left) / bounds.width, (y - bounds.top) / bounds.height,
            (right - x) / bounds.width, (bottom - y) / bounds.height]]
        })
        if (boxes.length) pages.push({ number: Number(page.dataset.pageNumber), boxes })
      }
      if (!pages.length) return null
      const pane = root.getBoundingClientRect()
      const area = range.getBoundingClientRect()
      return { text, pages, x: Math.max(4, area.left - pane.left),
        y: Math.max(4, area.top - pane.top), bottom: area.bottom - pane.top }
    }

    function paint(viewerElement, marks) {
      for (const old of viewerElement.querySelectorAll('.dsh-paper-mark')) old.remove()
      for (const mark of marks) {
        for (const { number, boxes } of mark.pages) {
          const page = viewerElement.querySelector(`.page[data-page-number="${number}"] .canvasWrapper`)
          if (!page) continue
          for (const [x, y, width, height] of boxes) {
            const node = document.createElement('div')
            node.className = 'dsh-paper-mark'
            if (mark.note) node.dataset.note = ''
            Object.assign(node.style, { left: x * 100 + '%', top: y * 100 + '%',
              width: width * 100 + '%', height: height * 100 + '%' })
            page.append(node)
          }
        }
      }
    }

    const pageList = pages => pages.map(page => page.number).join(', ')

    function Reader({ inputActions, useTabInfo, locale, onAsk }) {
      const { tab } = useTabInfo()
      const localeHooks = useRef({ subscribe: listener => locale.subscribe(listener),
        getSnapshot: () => locale.getSnapshot() }).current
      const lang = useSyncExternalStore(localeHooks.subscribe, localeHooks.getSnapshot).active
      const t = copy[lang.startsWith('zh') ? 'zh' : 'en']
      const [papers, setPapers] = useState([])
      const [paperId, setPaperId] = useState('')
      const [paper, setPaper] = useState(null)
      const [marks, setMarks] = useState([])
      const [selection, setSelection] = useState(null)
      const [pendingNote, setPendingNote] = useState(null)
      const [note, setNote] = useState('')
      const [showNotes, setShowNotes] = useState(false)
      const [status, setStatus] = useState('')
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(false)
      const [page, setPage] = useState({ number: 0, total: 0 })
      const [zoom, setZoom] = useState('page-width')
      const [menuStyle, setMenuStyle] = useState({ visibility: 'hidden' })
      const root = useRef(null)
      const scroll = useRef(null)
      const content = useRef(null)
      const menu = useRef(null)
      const viewerRef = useRef(null)
      const marksRef = useRef([])
      const tRef = useRef(t)
      tRef.current = t

      const report = error => setError(error.message || String(error))
      useEffect(() => {
        let alive = true
        storage('papers', 'readonly', store => store.getAll()).then(entries => {
          if (alive) setPapers(current => [...current, ...entries.filter(item => !current.some(p => p.id === item.id))])
        }).catch(error => { if (alive) report(error) })
        return () => { alive = false }
      }, [])

      useEffect(() => {
        const viewerElement = content.current
        const container = scroll.current
        let alive = true
        let task
        let pdfViewer
        let linkService
        let downloadUrl
        const controller = new AbortController()
        setPaper(null)
        setMarks([])
        marksRef.current = []
        setPage({ number: 0, total: 0 })
        setSelection(null)
        setPendingNote(null)
        setError('')
        setStatus('')
        setLoading(Boolean(paperId))
        if (!paperId) return
        ;(async () => {
          const [entry, file, saved, { pdf, viewer }] = await Promise.all([
            storage('papers', 'readonly', store => store.get(paperId)),
            storage('originals', 'readonly', store => store.get(paperId)),
            storage('marks', 'readonly', store => store.index('paper').getAll(paperId)),
            loadLibraries(),
          ])
          if (!entry || !file) throw new Error('PDF unavailable')
          const data = await file.arrayBuffer()
          if (!alive) return
          const eventBus = new viewer.EventBus()
          linkService = new viewer.PDFLinkService({ eventBus, externalLinkTarget: 2 })
          pdfViewer = new viewer.PDFViewer({ container, viewer: viewerElement, eventBus,
            linkService, abortSignal: controller.signal, annotationEditorMode: pdf.AnnotationEditorType.DISABLE,
            downloadManager: new viewer.DownloadManager(),
            imageResourcesPath: vendor + 'web/images/' })
          viewerRef.current = pdfViewer
          linkService.setViewer(pdfViewer)
          eventBus.on('pagesinit', () => {
            if (!alive) return
            pdfViewer.currentScaleValue = 'page-width'
            setZoom('page-width')
            setPage({ number: 1, total: pdfViewer.pagesCount })
          })
          eventBus.on('pagechanging', ({ pageNumber }) => {
            if (alive) setPage({ number: pageNumber, total: pdfViewer.pagesCount })
          })
          eventBus.on('pagerendered', ({ error }) => {
            if (!alive) return
            if (error) report(error)
            paint(viewerElement, marksRef.current)
          })
          task = pdf.getDocument({ data, isEvalSupported: false, enableXfa: true,
            cMapUrl: vendor + 'cmaps/', standardFontDataUrl: vendor + 'standard_fonts/',
            wasmUrl: vendor + 'wasm/', iccUrl: vendor + 'iccs/', useWorkerFetch: false })
          task.onPassword = update => {
            const password = window.prompt(tRef.current.password)
            if (password) update(password)
            else void task.destroy()
          }
          const doc = await task.promise
          if (!alive) return
          marksRef.current = saved
          setMarks(saved)
          downloadUrl = URL.createObjectURL(file)
          setPaper({ id: entry.id, name: entry.name, url: downloadUrl })
          linkService.setDocument(doc)
          pdfViewer.setDocument(doc)
        })().catch(error => { if (alive) report(error) })
          .finally(() => { if (alive) setLoading(false) })
        return () => {
          alive = false
          viewerRef.current = null
          pdfViewer?.setDocument(null)
          linkService?.setDocument(null)
          controller.abort()
          if (task) void task.destroy().catch(() => {})
          if (downloadUrl) URL.revokeObjectURL(downloadUrl)
        }
      }, [paperId])

      useEffect(() => {
        marksRef.current = marks
        paint(content.current, marks)
      }, [marks])

      useEffect(() => {
        if (!tab.visible) return
        const update = () => {
          if (!menu.current?.contains(document.activeElement)) {
            setSelection(capture(root.current, content.current))
          }
        }
        document.addEventListener('selectionchange', update)
        return () => document.removeEventListener('selectionchange', update)
      }, [tab.visible])

      useEffect(() => {
        if (!selection || !menu.current) return
        const w = menu.current.offsetWidth
        const height = menu.current.offsetHeight
        setMenuStyle({
          left: Math.max(4, Math.min(selection.x, root.current.clientWidth - w - 4)),
          top: Math.max(4, Math.min(selection.y - height - 6 < 4 ? selection.bottom + 6 :
            selection.y - height - 6, root.current.clientHeight - height - 4)),
        })
      }, [selection, lang])

      async function importPaper(file) {
        if (!file) return
        try {
          const header = await file.slice(0, 1024).text()
          if (!header.includes('%PDF-')) throw new Error('Invalid PDF')
          const bytes = await file.arrayBuffer()
          const digest = await crypto.subtle.digest('SHA-256', bytes)
          const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
          await storage(['papers', 'originals'], 'readwrite', tx => {
            tx.objectStore('papers').put({ id, name: file.name })
            tx.objectStore('originals').put(file, id)
          })
          setPapers(items => [...items.filter(item => item.id !== id), { id, name: file.name }])
          setPaperId(id)
        } catch (error) { report(error) }
      }

      function clearSelection() {
        window.getSelection()?.removeAllRanges()
        setSelection(null)
      }

      async function addMark(passage, body = '') {
        if (!paper) return
        const mark = { id: crypto.randomUUID(), paper: paper.id, text: passage.text,
          pages: passage.pages, note: body }
        try {
          await storage('marks', 'readwrite', store => store.add(mark))
          if (viewerRef.current !== null && paper.id === activePaper.current) {
            setMarks(items => [...items, mark])
            setPendingNote(null)
            setShowNotes(true)
          }
        } catch (error) { report(error) }
      }

      const activePaper = useRef(paperId)
      activePaper.current = paperId

      function ask() {
        const lines = selection.text.split(/\r?\n/).map(line => '> ' + line).join('\n')
        const prompt = t.prompt(paper.name, pageList(selection.pages), lines)
        if (onAsk) {
          onAsk(prompt)
          clearSelection()
          return
        }
        const inserted = inputActions?.insertText(prompt, inputActions.captureInsertion())
        if (inserted) inputActions.persistDraft()
        setStatus(inserted ? 'inserted' : 'blocked')
        if (inserted) clearSelection()
      }

      const jump = number => {
        if (viewerRef.current && number >= 1 && number <= page.total) viewerRef.current.currentPageNumber = number
      }
      const button = (label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, label)
      return h('section', { className: 'dsh-paper', ref: root, 'aria-label': t.title,
        onKeyDown: event => { if (event.key === 'Escape') clearSelection() } },
        h('div', { className: 'dsh-paper-bar' },
          h('label', null, t.upload, ' ', h('input', { type: 'file', accept: '.pdf,application/pdf',
            onChange: event => { const file = event.target.files[0]; event.target.value = ''; void importPaper(file) } })),
          h('select', { 'aria-label': t.choose, value: paperId, onChange: e => setPaperId(e.target.value) },
            h('option', { value: '' }, t.choose),
            papers.map(item => h('option', { key: item.id, value: item.id }, item.name))),
          paper && h('a', { href: paper.url, download: paper.name }, t.original),
          page.total > 0 && h('span', null,
            button('‹', () => jump(page.number - 1), { 'aria-label': t.previous, disabled: page.number <= 1 }),
            ` ${page.number} / ${page.total} `,
            button('›', () => jump(page.number + 1), { 'aria-label': t.next, disabled: page.number >= page.total })),
          page.total > 0 && h('select', { 'aria-label': t.fit, value: zoom, onChange: e => {
            setZoom(e.target.value); viewerRef.current.currentScaleValue = e.target.value; clearSelection()
          } }, h('option', { value: 'page-width' }, t.fit),
          ['0.75', '1', '1.25', '1.5', '2'].map(value => h('option', { key: value, value }, Number(value) * 100 + '%'))),
          paper && button(`${t.notes} (${marks.length})`, () => setShowNotes(open => !open), { 'aria-expanded': showNotes })),
        !paperId && h('p', { className: 'dsh-paper-status' }, t.empty),
        loading && h('p', { className: 'dsh-paper-status', role: 'status' }, t.loading),
        status && h('p', { className: 'dsh-paper-status', role: 'status' }, t[status]),
        error && h('p', { className: 'dsh-paper-status', role: 'alert' }, t.error + ' · ' + error),
        h('div', { className: 'dsh-paper-space' },
          h('div', { className: 'dsh-paper-scroll', ref: scroll, onScroll: () => setSelection(null) },
            h('div', { className: 'pdfViewer', ref: content }))),
        paper && (showNotes || pendingNote) && h('div', { className: 'dsh-paper-notes' },
          pendingNote && h('form', { onSubmit: event => {
            event.preventDefault(); if (note.trim()) void addMark(pendingNote, note.trim())
          } }, h('blockquote', null, pendingNote.text),
          h('textarea', { autoFocus: true, required: true, 'aria-label': t.note, value: note,
            onChange: e => setNote(e.target.value) }),
          h('button', { type: 'submit', disabled: !note.trim() }, t.save),
          button(t.cancel, () => setPendingNote(null))),
          showNotes && (!marks.length ? h('p', null, t.noNotes) : marks.map(mark => h('article', { key: mark.id },
            button(`${t.page} ${pageList(mark.pages)}`, () => jump(mark.pages[0].number)),
            button(t.remove, async () => {
              try {
                await storage('marks', 'readwrite', store => store.delete(mark.id))
                if (activePaper.current === mark.paper) setMarks(items => items.filter(item => item.id !== mark.id))
              } catch (error) { report(error) }
            }),
            h('blockquote', null, mark.text), mark.note && h('p', null, mark.note))))),
        tab.visible && paper && selection && h('div', { className: 'dsh-paper-float', ref: menu,
          style: menuStyle, role: 'group', 'aria-label': t.notes,
          onMouseDown: event => event.preventDefault() },
          button(t.highlight, () => { void addMark(selection); clearSelection() }),
          button(t.note, () => { setPendingNote(selection); setNote(''); clearSelection() }),
          button(t.ask, ask)))
    }

    const inject = ['slots', 'locale', 'sidebarRightTabs']
    function apply(ctx) {
      const label = () => copy[ctx.locale.getSnapshot().active.startsWith('zh') ? 'zh' : 'en']
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id, kind: id, title: () => label().title, keepMounted: true,
        guide: [{ id, order: 45, title: () => label().title, description: () => label().guide }],
      }))
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id },
          props => h(Reader, { ...props, locale: ctx.locale }))))
      ctx.effect(() => {
        const links = [vendor + 'web/pdf_viewer.css', base + 'reader.css'].map(url => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = url
          document.head.append(link)
          return link
        })
        return () => links.forEach(link => link.remove())
      })
    }

    return { apply, inject, Reader }
  },
})
