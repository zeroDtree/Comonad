const META = 'comonad'

const MODES = [
  ['ro', 'Read only', 'Read files, and a shell that cannot write'],
  ['sw', 'Write files', 'Also create and edit workspace files'],
  ['aw', 'Write and shell', 'Also a shell that can write in the workspace'],
  ['pl', 'Plan files', 'Read files, a shell that cannot write, and plan files'],
]

const APPROVALS = [
  ['manual', 'Ask'],
  ['universal_reject', 'Reject all'],
  ['blacklist_reject', 'Blacklist'],
  ['whitelist_accept', 'Whitelist'],
  ['universal_accept', 'Accept all'],
]

const CONTEXTS = [
  ['rendered', 'Rendered'],
  ['token', 'Token'],
  ['raw', 'Raw'],
]

const DISPLAYS = [
  ['rendered', 'Rendered — Folded thoughts and tool calls'],
  ['token', 'Token — Assistant text'],
  ['raw', 'Raw — The full record'],
]

const CONTEXT_FORMS = [
  ['rendered', 'Rendered — Text, thoughts, and tool results'],
  ['token', 'Token — Assistant text only'],
  ['raw', 'Raw — The full record'],
]

const bar = document.createElement('div')
bar.className = 'comonad-bar'
bar.innerHTML = `
  <div class="comonad-slot">
    <button class="comonad-pill" type="button" data-menu="mode" aria-expanded="false">
      <span class="comonad-mark">∞</span>
      <span class="comonad-mode-label">Chat</span>
    </button>
    <div class="comonad-menu" data-menu="mode" hidden>
      <button class="comonad-choice" type="button" data-agent="off">Chat</button>
      ${MODES.map(([value, label, detail]) => `<button class="comonad-choice" type="button" data-mode="${value}"><span class="comonad-choice-text"><span>${label}</span><span class="comonad-choice-detail">${detail}</span></span></button>`).join('')}
    </div>
  </div>
  <div class="comonad-slot">
    <button class="comonad-pill" type="button" data-menu="approval" aria-expanded="false">
      <span class="comonad-approval-label">Ask</span>
    </button>
    <div class="comonad-menu" data-menu="approval" hidden>
      ${APPROVALS.map(([value, label]) => `<button class="comonad-choice" type="button" data-approval="${value}">${label}</button>`).join('')}
    </div>
  </div>
  <div class="comonad-slot">
    <button class="comonad-pill" type="button" data-menu="context" aria-expanded="false">
      <span class="comonad-context-label">Rendered</span>
    </button>
    <div class="comonad-menu" data-menu="context" hidden>
      ${CONTEXTS.map(([value, label]) => `<button class="comonad-choice" type="button" data-context="${value}">${label}</button>`).join('')}
    </div>
  </div>
  <button class="comonad-pill" id="comonad-network" type="button">Network</button>
  <button class="comonad-pill" id="comonad-open-settings" type="button">Settings</button>
`
const above = document.createElement('div')
above.className = 'comonad-above'
above.innerHTML = `
  <div class="comonad-slot">
    <button class="comonad-path" id="comonad-directory" type="button">Working directory</button>
    <div class="comonad-menu comonad-picker" hidden>
      <div class="comonad-picker-path"></div>
      <input class="comonad-picker-filter" placeholder="Directory name" autocomplete="off">
      <div class="comonad-dirs"></div>
      <button class="comonad-use" type="button">Use this directory</button>
    </div>
  </div>
  <button id="comonad-diff" type="button">Workspace diff</button>
  <div id="comonad-pending" hidden>
    <div class="comonad-pending-head">
      <button type="button" data-pending="toggle"><span id="comonad-pending-mark">▾</span> <span id="comonad-pending-count">0 Files</span></button>
      <div>
        <button type="button" data-review="undo-all">Undo All</button>
        <button type="button" data-review="keep-all">Keep All</button>
        <button type="button" data-review="open">Review</button>
      </div>
    </div>
    <div id="comonad-pending-files"></div>
  </div>
`
const host = document.querySelector('#send_form') ?? document.body
host.append(above, bar)

const modeLabel = bar.querySelector('.comonad-mode-label')
const approvalLabel = bar.querySelector('.comonad-approval-label')
const contextLabel = bar.querySelector('.comonad-context-label')
const networkButton = bar.querySelector('#comonad-network')
const directoryButton = above.querySelector('#comonad-directory')
const picker = above.querySelector('.comonad-picker')
const pickerPath = above.querySelector('.comonad-picker-path')
const pickerFilter = above.querySelector('.comonad-picker-filter')
const dirList = above.querySelector('.comonad-dirs')
const review = document.createElement('div')
review.id = 'comonad-review'
review.hidden = true
const fileDiff = document.createElement('div')
fileDiff.id = 'comonad-filediff'
fileDiff.hidden = true
document.body.append(review, fileDiff)
const settings = document.createElement('div')
settings.id = 'comonad-settings'
settings.hidden = true
settings.innerHTML = `
  <div class="comonad-settings-top">
    <div class="comonad-settings-tabs">
      <button type="button" class="is-selected" data-tab="graph">Graph</button>
      <button type="button" data-tab="agent">Agent</button>
      <button type="button" data-tab="mcp">MCP</button>
      <button type="button" data-tab="tools">Tools</button>
    </div>
    <div class="comonad-settings-actions">
      <span id="comonad-settings-status"></span>
      <button type="button" data-settings="save">Save</button>
      <button type="button" data-settings="close">Close</button>
    </div>
  </div>
  <div class="comonad-settings-pane is-on" data-pane="graph">
    <div class="comonad-settings-editor">
      <label>Graph<textarea id="comonad-graph" spellcheck="false"></textarea></label>
      <label>Max steps<input id="comonad-steps" type="number" min="1"></label>
      <p id="comonad-symbols"></p>
    </div>
    <div id="comonad-diagram"></div>
  </div>
  <div class="comonad-settings-pane" data-pane="agent">
    <label>Work mode<select id="comonad-default-mode"></select></label>
    <label>Approval<select id="comonad-default-approval"></select></label>
    <label>Display<select id="comonad-default-display"></select></label>
    <label>Context<select id="comonad-default-context"></select></label>
    <label class="comonad-check">Network<input id="comonad-default-network" type="checkbox"></label>
    <label class="comonad-span">Working directory<input id="comonad-default-directory"></label>
    <label>Command timeout<input id="comonad-default-timeout" type="number" min="1"></label>
    <label>Plan directory<input id="comonad-default-plan"></label>
    <label class="comonad-span">Deny read paths<textarea id="comonad-default-deny"></textarea></label>
  </div>
  <div class="comonad-settings-pane" data-pane="mcp">
    <div id="comonad-mcp"></div>
    <button type="button" data-settings="add-mcp">Add server</button>
  </div>
  <div class="comonad-settings-pane" data-pane="tools">
    <div id="comonad-tools"></div>
  </div>
  <p id="comonad-settings-error"></p>
`
document.body.append(settings)
let browsing = ''
let reviewFiles = []
let reviewIndex = 0
let hunkIndex = 0
let openPath = ''
let filesOpen = true
let pendingShown = false
let batch = []
let batchSettled = false
let batchScope = ''
let editorDraft = ''
let editorDirty = false
let settingsReady = false
let editorFor = ''
let liveTrace = null
let agentDefaults = {
  workMode: 'ro',
  approval: 'manual',
  network: false,
  workingDirectory: '',
}
let mcpServers = []
const pending = above.querySelector('#comonad-pending')
const pendingCount = above.querySelector('#comonad-pending-count')
const pendingFiles = above.querySelector('#comonad-pending-files')
const pendingMark = above.querySelector('#comonad-pending-mark')

bar.addEventListener('click', (event) => {
  const opener = event.target.closest('.comonad-pill[data-menu]')
  if (!opener) return
  const menu = bar.querySelector(`.comonad-menu[data-menu="${opener.dataset.menu}"]`)
  const open = menu.hasAttribute('hidden')
  closeMenus()
  menu.hidden = !open
  opener.setAttribute('aria-expanded', String(open))
})

document.addEventListener('click', (event) => {
  if (picker.contains(event.target) || event.target === directoryInput) return
  if (!bar.contains(event.target) && !above.contains(event.target)) closeMenus()
})

bar.addEventListener('click', (event) => {
  const choice = event.target.closest('.comonad-choice')
  if (!choice) return
  const record = chatRecord()
  if (choice.dataset.agent === 'off') record.enabled = false
  if (choice.dataset.mode) {
    record.enabled = true
    record.workMode = choice.dataset.mode
  }
  if (choice.dataset.approval) record.approval = choice.dataset.approval
  if (choice.dataset.context) record.context = choice.dataset.context
  saveChat()
  loadPanel()
  closeMenus()
})

networkButton.addEventListener('click', () => {
  const record = chatRecord()
  record.network = !record.network
  saveChat()
  loadPanel()
})

document.querySelector('#comonad-open-settings').addEventListener('click', () => {
  settings.hidden = false
  settingsStatus('')
  void loadSettings().then(fillSettings).catch((error) => {
    settingsStatus(error.message, true)
  })
})

settings.querySelector('#comonad-graph').addEventListener('input', paintGraph)

settings.addEventListener('click', async (event) => {
  const button = event.target.closest('button')
  if (!button) return
  if (button.dataset.tab) {
    for (const tab of settings.querySelectorAll('[data-tab]')) tab.classList.toggle('is-selected', tab === button)
    for (const pane of settings.querySelectorAll('.comonad-settings-pane')) {
      pane.classList.toggle('is-on', pane.dataset.pane === button.dataset.tab)
    }
    if (button.dataset.tab === 'graph') paintGraph()
    if (button.dataset.tab === 'tools') void refreshTools()
    return
  }
  const action = button.dataset.settings
  if (action === 'close') {
    settings.hidden = true
    closeMenus()
    return
  }
  if (action === 'add-mcp') {
    captureMcp()
    mcpServers.push({ name: '', url: 'https://', enabled: true, defaultCapability: 'ro', defaultNeedsNetwork: false })
    paintMcp()
    return
  }
  if (action === 'remove-mcp') {
    captureMcp()
    mcpServers.splice(Number(button.dataset.index), 1)
    paintMcp()
    return
  }
  if (action !== 'save') return
  try {
    const response = await fetch('/api/plugins/comonad/settings', {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify(settingsPayload()),
    })
    const body = await response.json()
    if (!response.ok) {
      settingsStatus(body.error || 'Could not save settings', true)
      return
    }
    fillSettings(body)
    applySavedDefaults(body.defaults || {})
    settingsStatus('Saved')
  } catch (error) {
    settingsStatus(error instanceof Error ? error.message : 'Could not save settings', true)
  }
})

function settingsStatus(text, failed) {
  const status = settings.querySelector('#comonad-settings-status')
  status.textContent = text || ''
  status.classList.toggle('is-error', Boolean(failed && text))
  settings.querySelector('#comonad-settings-error').textContent = ''
}

function applySavedDefaults(defaults) {
  const record = chatRecord()
  if (defaults.workMode) record.workMode = defaults.workMode
  if (defaults.approval) record.approval = defaults.approval
  record.network = Boolean(defaults.network)
  record.display = traceForm(defaults.display)
  record.context = traceForm(defaults.context)
  saveChat()
  const chat = tavern().chat
  if (Array.isArray(chat)) {
    for (const message of chat) {
      if (message?.extra?.comonadTrace) traceViews.set(message, record.display)
    }
  }
  loadPanel()
  mountTraces()
}

const directoryInput = settings.querySelector('#comonad-default-directory')
const pickerHome = picker.parentElement
let pickerTarget = 'chat'

directoryInput.addEventListener('focus', openSettingsPicker)
directoryInput.addEventListener('click', openSettingsPicker)
settings.addEventListener('scroll', () => {
  if (pickerTarget === 'settings' && !picker.hidden) placeFloatingPicker()
}, true)

function openSettingsPicker() {
  pickerTarget = 'settings'
  document.body.append(picker)
  picker.classList.add('is-floating')
  placeFloatingPicker()
  picker.hidden = false
  pickerFilter.value = ''
  void renderDirectories(directoryInput.value.trim())
}

function placeFloatingPicker() {
  const rect = directoryInput.getBoundingClientRect()
  picker.style.left = `${rect.left}px`
  picker.style.top = `${rect.bottom + 6}px`
  picker.style.width = `${rect.width}px`
}

directoryButton.addEventListener('click', () => {
  const open = picker.hasAttribute('hidden') && pickerTarget !== 'settings'
  closeMenus()
  if (!open) return
  picker.hidden = false
  pickerFilter.value = ''
  void renderDirectories(chatRecord().workingDirectory || '')
})

dirList.addEventListener('click', (event) => {
  const target = event.target.closest('[data-path]')
  if (!target) return
  pickerFilter.value = ''
  void renderDirectories(target.dataset.path)
})

pickerFilter.addEventListener('input', paintPickerDirs)
pickerFilter.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  const text = pickerFilter.value.trim()
  if (text.includes('/')) {
    pickerFilter.value = ''
    void renderDirectories(text)
    return
  }
  const query = text.toLowerCase()
  const match = pickerEntries.find((entry) => entry.name.toLowerCase().includes(query))
  if (!match) return
  pickerFilter.value = ''
  void renderDirectories(match.path)
})

above.querySelector('.comonad-use').addEventListener('click', () => {
  if (pickerTarget === 'settings') {
    directoryInput.value = browsing
    closeMenus()
    return
  }
  chatRecord().workingDirectory = browsing
  saveChat()
  loadPanel()
  closeMenus()
})

function closeMenus() {
  picker.hidden = true
  picker.classList.remove('is-floating')
  picker.style.left = ''
  picker.style.top = ''
  picker.style.width = ''
  if (picker.parentElement !== pickerHome) pickerHome.append(picker)
  pickerTarget = 'chat'
  for (const menu of bar.querySelectorAll('.comonad-menu')) menu.hidden = true
  for (const opener of bar.querySelectorAll('.comonad-pill[data-menu]')) opener.setAttribute('aria-expanded', 'false')
}

let pickerParent = ''
let pickerEntries = []

async function renderDirectories(path) {
  const response = await fetch(`/api/plugins/comonad/browse?path=${encodeURIComponent(path)}`, { headers: requestHeaders() })
  const body = await response.json()
  if (!response.ok) {
    pickerPath.textContent = body.error || 'Cannot open directory'
    pickerParent = ''
    pickerEntries = []
    paintPickerDirs()
    return
  }
  browsing = body.path
  pickerPath.textContent = body.path
  pickerParent = body.parent || ''
  pickerEntries = (body.directories || []).map((name) => ({
    name,
    path: body.path === '/' ? `/${name}` : `${body.path}/${name}`,
  }))
  paintPickerDirs()
}

function paintPickerDirs() {
  const query = pickerFilter.value.trim().toLowerCase()
  const rows = []
  if (pickerParent && !query) rows.push(row(pickerParent, '↑'))
  for (const entry of pickerEntries) {
    if (query && !entry.name.toLowerCase().includes(query)) continue
    rows.push(row(entry.path, entry.name))
  }
  dirList.replaceChildren(...rows)
}

function row(path, label) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'comonad-choice'
  button.dataset.path = path
  button.textContent = label
  return button
}

const diffButton = above.querySelector('#comonad-diff')
diffButton.addEventListener('click', (event) => {
  event.stopPropagation()
  pendingShown = !pendingShown
  diffButton.classList.toggle('is-selected', pendingShown)
  if (!pendingShown) {
    pending.hidden = true
    return
  }
  void refreshReview('stay')
})

pending.addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (!button) return
  event.stopPropagation()
  if (button.dataset.pending === 'toggle') {
    filesOpen = !filesOpen
    paintPending()
    return
  }
  const action = button.dataset.review
  if (action === 'open') {
    void refreshReview('show')
    return
  }
  if (action === 'file') {
    reviewIndex = Number(button.dataset.index)
    openPath = reviewFiles[reviewIndex]?.path ?? ''
    hunkIndex = 0
    void refreshReview('file')
    return
  }
  if (action === 'keep-all' || action === 'undo-all') void reviewAll(action === 'keep-all' ? 'keep' : 'undo')
})

review.addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (!button) return
  const action = button.dataset.review
  if (action === 'close') {
    review.hidden = true
    return
  }
  if (action === 'file') {
    reviewIndex = Number(button.dataset.index)
    openPath = reviewFiles[reviewIndex]?.path ?? ''
    hunkIndex = 0
    review.hidden = true
    fileDiff.hidden = false
    paintFileDiff()
    return
  }
  if (action === 'keep' || action === 'undo') {
    void reviewAction(action, button.dataset.path, button.dataset.hunk)
    return
  }
  if (action === 'keep-all' || action === 'undo-all') void reviewAll(action === 'keep-all' ? 'keep' : 'undo')
})

fileDiff.addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (!button) return
  const action = button.dataset.review
  const file = reviewFiles[reviewIndex]
  if (action === 'close') {
    fileDiff.hidden = true
    return
  }
  if (action === 'prev-hunk' || action === 'next-hunk') {
    const count = file?.hunks.length ?? 0
    if (!count) return
    hunkIndex = (hunkIndex + (action === 'next-hunk' ? 1 : -1) + count) % count
    const label = fileDiff.querySelector('[data-hunk-count]')
    if (label) label.textContent = `${hunkIndex + 1} of ${count}`
    scrollToHunk()
    return
  }
  if (action === 'prev-file' || action === 'next-file') {
    if (!reviewFiles.length) return
    reviewIndex = (reviewIndex + (action === 'next-file' ? 1 : -1) + reviewFiles.length) % reviewFiles.length
    openPath = reviewFiles[reviewIndex].path
    hunkIndex = 0
    paintFileDiff()
    return
  }
  if (action === 'keep' || action === 'undo') {
    void reviewAction(action, button.dataset.path, button.dataset.hunk)
    return
  }
  if (action === 'save') void saveEditor()
})

async function refreshReview(mode) {
  const directory = chatRecord().workingDirectory || ''
  let response
  try {
    response = await fetch(`/api/plugins/comonad/diff?path=${encodeURIComponent(directory)}&chatId=${encodeURIComponent(currentChatId())}`, { headers: requestHeaders() })
  } catch {
    return
  }
  const body = await response.json()
  const live = body.available ? body.files ?? [] : []
  reviewFiles = rememberBatch(directory, live)
  pending.hidden = !pendingShown
  pendingCount.textContent = `${reviewFiles.length} File${reviewFiles.length === 1 ? '' : 's'}`
  for (const button of above.querySelectorAll('#comonad-pending [data-review="undo-all"], #comonad-pending [data-review="keep-all"]')) {
    button.hidden = live.length === 0
  }
  paintPending()
  const settled = live.length === 0 && batch.length > 0
  if (!reviewFiles.length) {
    review.hidden = true
    fileDiff.hidden = true
  } else if (mode === 'show') {
    review.hidden = false
    fileDiff.hidden = true
  } else if (mode === 'file') {
    fileDiff.hidden = false
    review.hidden = true
  } else if (settled) {
    review.hidden = true
    fileDiff.hidden = true
  }
  if (!fileDiff.hidden) {
    const next = reviewFiles.findIndex((file) => file.path === openPath)
    if (next === -1) {
      reviewIndex = Math.min(reviewIndex, reviewFiles.length - 1)
      openPath = reviewFiles[reviewIndex].path
      hunkIndex = 0
    } else {
      reviewIndex = next
      if (hunkIndex >= reviewFiles[next].hunks.length) hunkIndex = 0
    }
  }
  if (reviewIndex >= reviewFiles.length) reviewIndex = 0
  if (!review.hidden) paintReview()
  if (!fileDiff.hidden) paintFileDiff()
}

function rememberBatch(directory, live) {
  const scope = `${currentChatId()}\0${directory}`
  if (scope !== batchScope) {
    batchScope = scope
    batch = []
    batchSettled = false
  }
  if (live.length) {
    if (batchSettled) {
      batch = live.slice()
      batchSettled = false
    } else {
      for (const file of live) {
        const index = batch.findIndex((item) => item.path === file.path)
        if (index === -1) batch.push(file)
        else batch[index] = file
      }
    }
    return live
  }
  if (batch.length) {
    batchSettled = true
    return batch
  }
  return []
}

function forgetBatch() {
  batch = []
  batchSettled = false
}

function paintFileDiff() {
  const file = reviewFiles[reviewIndex]
  if (!file) return
  const plain = batchSettled
  const hunks = file.hunks.length
  fileDiff.replaceChildren()
  const top = document.createElement('div')
  top.className = 'comonad-filediff-top'
  const name = document.createElement('span')
  name.textContent = file.path
  const actions = document.createElement('div')
  actions.append(
    ...(plain ? [] : [
      reviewButton('prev-hunk', '↑'),
      hunkCount(`${hunks ? hunkIndex + 1 : 0} of ${hunks}`),
      reviewButton('next-hunk', '↓'),
    ]),
    reviewButton('prev-file', '↑'),
    textSpan(`${reviewIndex + 1} of ${reviewFiles.length} Files`),
    reviewButton('next-file', '↓'),
    ...(plain ? [] : [
      fileButton('undo', 'Undo File', file.path),
      fileButton('keep', 'Keep File', file.path),
    ]),
    reviewButton('save', 'Save'),
    reviewButton('close', 'Close'),
  )
  top.append(name, actions)
  const body = document.createElement('div')
  body.className = 'comonad-filediff-body'
  body.addEventListener('keydown', onEditorKey)
  fileDiff.append(top, body)
  placeFileDiff()
  if (editorFor === file.path && editorDirty) renderEditor(file, editorDraft)
  else void loadEditor(file.path)
}

async function loadEditor(path) {
  const directory = chatRecord().workingDirectory || ''
  const response = await fetch(`/api/plugins/comonad/file?path=${encodeURIComponent(directory)}&file=${encodeURIComponent(path)}`, { headers: requestHeaders() })
  const payload = await response.json()
  if (!response.ok || fileDiff.hidden || (editorFor === path && editorDirty)) return
  const file = reviewFiles.find((item) => item.path === path)
  if (!file || reviewFiles[reviewIndex]?.path !== path) return
  editorDraft = payload.text ?? ''
  editorFor = path
  editorDirty = false
  renderEditor(file, editorDraft)
}

function renderEditor(file, text) {
  const body = fileDiff.querySelector('.comonad-filediff-body')
  if (!body) return
  body.replaceChildren()
  const lines = text.split('\n')
  if (batchSettled) {
    for (const line of lines) body.append(editLine('same', line, true))
    return
  }
  const { kinds, delsBefore, hunkOf, delHunk } = lineMarks(file.hunks)
  let wrap = null
  let open = -1
  const close = () => {
    wrap = null
    open = -1
  }
  const use = (index) => {
    if (index < 0) {
      close()
      return body
    }
    if (open === index) return wrap
    close()
    open = index
    wrap = document.createElement('div')
    wrap.className = 'comonad-hunk'
    wrap.id = `comonad-hunk-${index}`
    wrap.append(hunkTools(file, index))
    wrap.addEventListener('mousemove', (event) => {
      const host = event.currentTarget
      if (event.target.closest('.comonad-hunk-tools')) return
      const tools = host.querySelector('.comonad-hunk-tools')
      if (!tools) return
      const rect = host.getBoundingClientRect()
      const top = Math.min(Math.max(0, event.clientY - rect.top - 12), Math.max(0, rect.height - 28))
      tools.style.top = `${top}px`
    })
    body.append(wrap)
    return wrap
  }
  for (let number = 1; number <= lines.length; number += 1) {
    const deleted = delsBefore.get(number) ?? []
    const added = kinds.get(number) === 'add'
    if (deleted.length || added) {
      const host = use(deleted.length ? delHunk.get(number) ?? -1 : hunkOf.get(number) ?? -1)
      for (const text of deleted) host.append(editLine('del', text, false))
      if (added) host.append(editLine('add', lines[number - 1], true))
      else {
        close()
        body.append(editLine('same', lines[number - 1], true))
      }
      continue
    }
    close()
    body.append(editLine('same', lines[number - 1], true))
  }
  const trailing = delsBefore.get(lines.length + 1) ?? []
  if (trailing.length) {
    const host = use(delHunk.get(lines.length + 1) ?? -1)
    for (const text of trailing) host.append(editLine('del', text, false))
  }
  scrollToHunk()
}

function scrollToHunk() {
  const body = fileDiff.querySelector('.comonad-filediff-body')
  const target = fileDiff.querySelector(`#comonad-hunk-${hunkIndex}`)
  if (!body || !target) return
  body.scrollTop = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
}

function hunkCount(text) {
  const span = textSpan(text)
  span.dataset.hunkCount = ''
  return span
}

function hunkTools(file, index) {
  const tools = document.createElement('div')
  tools.className = 'comonad-hunk-tools'
  tools.append(
    textSpan(`${index + 1} of ${file.hunks.length}`),
    fileButton('undo', 'Undo', file.path, index),
    fileButton('keep', 'Keep', file.path, index),
  )
  return tools
}

function editLine(type, text, live) {
  const line = document.createElement('div')
  line.className = `comonad-edit-line ${type}`
  line.textContent = text
  if (live) {
    line.dataset.live = '1'
    line.contentEditable = 'plaintext-only'
    line.addEventListener('input', syncDraft)
  }
  return line
}

function lineMarks(hunks) {
  const kinds = new Map()
  const delsBefore = new Map()
  const hunkOf = new Map()
  const delHunk = new Map()
  hunks.forEach((hunk, index) => {
    const range = hunkRange(hunk.header)
    let newLine = range.newStart
    let deleted = []
    const flush = () => {
      if (!deleted.length) return
      delsBefore.set(newLine, [...(delsBefore.get(newLine) ?? []), ...deleted])
      delHunk.set(newLine, index)
      deleted = []
    }
    for (const line of hunk.lines) {
      if (line.type === 'meta') continue
      if (line.type === 'del') {
        deleted.push(line.text)
        continue
      }
      flush()
      if (line.type === 'add') hunkOf.set(newLine, index)
      kinds.set(newLine, line.type)
      newLine += 1
    }
    flush()
  })
  return { kinds, delsBefore, hunkOf, delHunk }
}

function onEditorKey(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void saveEditor()
    return
  }
  const line = event.target.closest?.('.comonad-edit-line[data-live="1"]')
  if (!line) return
  if (event.key === 'Enter') {
    event.preventDefault()
    const text = line.textContent.replace(/\n/g, '')
    const offset = caretOffset(line)
    line.textContent = text.slice(0, offset)
    const next = editLine(line.classList.contains('add') ? 'add' : 'same', text.slice(offset), true)
    line.after(next)
    placeCaret(next, 0)
    syncDraft()
    return
  }
  if (event.key === 'Backspace' && caretOffset(line) === 0) {
    const prev = line.previousElementSibling?.matches?.('.comonad-edit-line[data-live="1"]')
      ? line.previousElementSibling
      : line.previousElementSibling?.previousElementSibling?.matches?.('.comonad-edit-line[data-live="1"]')
        ? line.previousElementSibling.previousElementSibling
        : null
    if (!prev) return
    event.preventDefault()
    const prevText = prev.textContent.replace(/\n/g, '')
    prev.textContent = `${prevText}${line.textContent.replace(/\n/g, '')}`
    line.remove()
    placeCaret(prev, prevText.length)
    syncDraft()
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    document.execCommand('insertText', false, '  ')
    syncDraft()
  }
}

function caretOffset(line) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !line.contains(selection.anchorNode)) return 0
  const range = selection.getRangeAt(0)
  const pre = range.cloneRange()
  pre.selectNodeContents(line)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

function placeCaret(line, offset) {
  const node = line.firstChild ?? line.appendChild(document.createTextNode(''))
  const range = document.createRange()
  range.setStart(node, Math.min(offset, node.textContent?.length ?? 0))
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function readEditor() {
  return [...fileDiff.querySelectorAll('.comonad-edit-line[data-live="1"]')].map((line) => line.textContent.replace(/\n/g, '')).join('\n')
}

function syncDraft() {
  editorDirty = true
  editorDraft = readEditor()
  editorFor = reviewFiles[reviewIndex]?.path ?? editorFor
}

async function saveEditor() {
  const file = reviewFiles[reviewIndex]
  if (!file) return
  const text = fileDiff.querySelector('.comonad-edit-line') ? readEditor() : editorDraft
  const response = await fetch('/api/plugins/comonad/file', {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify({
      path: file.path,
      directory: chatRecord().workingDirectory || '',
      text,
    }),
  })
  if (!response.ok) return
  editorDirty = false
  editorFor = file.path
  editorDraft = text
  await refreshReview('file')
}

function placeFileDiff() {
  const form = document.querySelector('#send_form')
  if (!form) return
  const rect = form.getBoundingClientRect()
  const gap = 8
  fileDiff.style.inset = 'auto'
  fileDiff.style.top = '12px'
  fileDiff.style.left = `${rect.left}px`
  fileDiff.style.width = `${rect.width}px`
  fileDiff.style.bottom = `${window.innerHeight - rect.top + gap}px`
  fileDiff.style.height = 'auto'
  fileDiff.style.maxHeight = 'none'
}

window.addEventListener('resize', () => {
  if (!fileDiff.hidden) placeFileDiff()
})

function textSpan(text) {
  const span = document.createElement('span')
  span.textContent = text
  return span
}

const CAPABILITIES = [
  ['ro', 'Read workspace files'],
  ['rw', 'Create and edit workspace files'],
  ['rw_plan', 'Read and write plan files'],
  ['shell_ro', 'Shell that cannot write'],
  ['shell_rw', 'Shell that can write in the workspace'],
]

function capabilityLabel(value) {
  return CAPABILITIES.find(([capability]) => capability === value)?.[1] ?? value
}

function selectOptions(select, values, current) {
  select.replaceChildren()
  for (const entry of values) {
    const [value, label] = Array.isArray(entry) ? entry : [entry, entry]
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    select.append(option)
  }
  select.value = current
}

async function loadSettings() {
  const response = await fetch('/api/plugins/comonad/settings', { headers: requestHeaders() })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Could not load settings')
  agentDefaults = body.defaults
  settingsReady = true
  return body
}

function fillSettings(body) {
  agentDefaults = body.defaults
  mcpServers = (body.mcp || []).map((server) => ({ ...server }))
  settings.querySelector('#comonad-graph').value = body.graph?.source || ''
  settings.querySelector('#comonad-steps').value = String(body.graph?.maxSteps || 32)
  settings.querySelector('#comonad-symbols').textContent = `Nodes: ${(body.graph?.nodes || []).join(', ')}\nRoutes: ${(body.graph?.routes || []).join(', ')}`
  selectOptions(settings.querySelector('#comonad-default-mode'), MODES.map(([value, label, detail]) => [value, `${label} — ${detail}`]), body.defaults.workMode)
  selectOptions(settings.querySelector('#comonad-default-approval'), APPROVALS, body.defaults.approval)
  selectOptions(settings.querySelector('#comonad-default-display'), DISPLAYS, body.defaults.display || 'rendered')
  selectOptions(settings.querySelector('#comonad-default-context'), CONTEXT_FORMS, body.defaults.context || 'rendered')
  settings.querySelector('#comonad-default-network').checked = Boolean(body.defaults.network)
  settings.querySelector('#comonad-default-directory').value = body.defaults.workingDirectory || ''
  settings.querySelector('#comonad-default-timeout').value = String(body.defaults.commandTimeout)
  settings.querySelector('#comonad-default-plan').value = body.defaults.planDirectory || ''
  settings.querySelector('#comonad-default-deny').value = (body.defaults.denyReadPaths || []).join('\n')
  paintMcp()
  paintTools(body.tools || [])
  paintGraph()
  if (pickerTarget === 'settings') closeMenus()
}

function captureMcp() {
  const rows = [...settings.querySelectorAll('#comonad-mcp .comonad-mcp-row')]
  mcpServers = rows.map((row, index) => ({
    ...(mcpServers[index]?.tools ? { tools: mcpServers[index].tools } : {}),
    name: row.querySelector('[data-field="name"]').value,
    url: row.querySelector('[data-field="url"]').value,
    enabled: row.querySelector('[data-field="enabled"]').checked,
    defaultCapability: row.querySelector('[data-field="capability"]').value,
    defaultNeedsNetwork: row.querySelector('[data-field="network"]').checked,
  }))
}

async function refreshTools() {
  try {
    const body = await loadSettings()
    paintTools(body.tools || [])
  } catch (error) {
    settingsStatus(error.message, true)
  }
}

function paintTools(tools) {
  const list = settings.querySelector('#comonad-tools')
  list.replaceChildren()
  const head = document.createElement('div')
  head.className = 'comonad-tools-head'
  head.innerHTML = '<span>Name</span><span>Description</span><span>Capability</span><span>Network</span><span>Workspace</span>'
  list.append(head)
  for (const tool of tools) {
    const row = document.createElement('div')
    row.className = 'comonad-tools-row'
    for (const text of [
      tool.name,
      tool.description,
      capabilityLabel(tool.capability),
      tool.needsNetwork ? 'yes' : 'no',
      tool.needsWorkspace ? 'yes' : 'no',
    ]) row.append(textSpan(text))
    list.append(row)
  }
}

function paintMcp() {
  const list = settings.querySelector('#comonad-mcp')
  list.replaceChildren()
  const head = document.createElement('div')
  head.className = 'comonad-mcp-head'
  head.innerHTML = '<span>Enable</span><span>Name</span><span>URL</span><span>Capability</span><span>Network</span><span></span>'
  list.append(head)
  mcpServers.forEach((server, index) => {
    const row = document.createElement('div')
    row.className = 'comonad-mcp-row'
    row.innerHTML = `
      <label class="comonad-check"><input data-field="enabled" type="checkbox"></label>
      <input data-field="name" placeholder="name">
      <input data-field="url" placeholder="https://">
      <select data-field="capability"></select>
      <label class="comonad-check"><input data-field="network" type="checkbox"></label>
      <button type="button" data-settings="remove-mcp" data-index="${index}">Remove</button>
    `
    row.querySelector('[data-field="enabled"]').checked = server.enabled !== false
    row.querySelector('[data-field="name"]').value = server.name || ''
    row.querySelector('[data-field="url"]').value = server.url || ''
    selectOptions(row.querySelector('[data-field="capability"]'), CAPABILITIES, server.defaultCapability || 'ro')
    row.querySelector('[data-field="network"]').checked = Boolean(server.defaultNeedsNetwork)
    list.append(row)
  })
}

function settingsPayload() {
  captureMcp()
  return {
    defaults: {
      workMode: settings.querySelector('#comonad-default-mode').value,
      approval: settings.querySelector('#comonad-default-approval').value,
      display: settings.querySelector('#comonad-default-display').value,
      context: settings.querySelector('#comonad-default-context').value,
      network: settings.querySelector('#comonad-default-network').checked,
      workingDirectory: settings.querySelector('#comonad-default-directory').value,
      commandTimeout: Number(settings.querySelector('#comonad-default-timeout').value),
      planDirectory: settings.querySelector('#comonad-default-plan').value,
      denyReadPaths: settings.querySelector('#comonad-default-deny').value.split('\n').map((line) => line.trim()).filter(Boolean),
    },
    mcp: mcpServers.filter((server) => server.name && server.url),
    graph: {
      source: settings.querySelector('#comonad-graph').value,
      maxSteps: Number(settings.querySelector('#comonad-steps').value),
    },
  }
}

function paintGraph() {
  const host = settings.querySelector('#comonad-diagram')
  const text = settings.querySelector('#comonad-graph').value
  host.replaceChildren(graphSvg(text))
}

function graphSvg(text) {
  const nodes = new Map()
  const edges = []
  let start = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('flowchart')) continue
    const started = line.match(/^%%\s*start:\s*(\S+)/)
    if (started) {
      start = started[1]
      continue
    }
    if (line.startsWith('%%')) continue
    const arrow = line.indexOf('-->')
    if (arrow < 0) continue
    const left = graphNode(line.slice(0, arrow).trim())
    let rightText = line.slice(arrow + 3).trim()
    let label = ''
    if (rightText.startsWith('|')) {
      const close = rightText.indexOf('|', 1)
      if (close > 0) {
        label = rightText.slice(1, close).trim()
        rightText = rightText.slice(close + 1).trim()
      }
    }
    const right = graphNode(rightText)
    if (!left.id || !right.id) continue
    nodes.set(left.id, left.label)
    nodes.set(right.id, nodes.get(right.id) && nodes.get(right.id) !== right.id ? nodes.get(right.id) : right.label)
    edges.push({ from: left.id, to: right.id, label })
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  if (!nodes.size) return svg
  if (!nodes.has(start)) start = nodes.keys().next().value
  const rank = new Map([[start, 0]])
  const queue = [start]
  while (queue.length) {
    const id = queue.shift()
    for (const edge of edges) {
      if (edge.from !== id || rank.has(edge.to)) continue
      rank.set(edge.to, rank.get(id) + 1)
      queue.push(edge.to)
    }
  }
  for (const id of nodes.keys()) if (!rank.has(id)) rank.set(id, 0)
  const rows = new Map()
  for (const [id, level] of rank) {
    const row = rows.get(level) ?? []
    row.push(id)
    rows.set(level, row)
  }
  const levels = [...rows.keys()].sort((a, b) => a - b)
  const box = new Map()
  const columnWidth = 340
  const rowHeight = 84
  const backEdges = edges.filter((edge) => rank.get(edge.to) < rank.get(edge.from))
  const leftPad = 40 + backEdges.length * 16
  const tallest = Math.max(...levels.map((level) => rows.get(level).length))
  const height = 48 + tallest * rowHeight
  const width = leftPad + levels.length * columnWidth
  for (const level of levels) {
    const ids = rows.get(level)
    const offset = (height - ids.length * rowHeight) / 2
    ids.forEach((id, index) => {
      const label = nodes.get(id)
      const w = Math.max(140, Math.min(180, label.length * 7 + 24))
      box.set(id, { x: leftPad + level * columnWidth, y: offset + index * rowHeight, w, h: 40, label })
    })
  }
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  const stroke = (d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#8b949e')
    path.setAttribute('stroke-width', '1.5')
    path.setAttribute('marker-end', 'url(#comonad-arrow)')
    svg.append(path)
  }
  const midY = (node) => node.y + node.h / 2
  const edgeText = (x, y, text) => {
    if (!text) return
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(x))
    label.setAttribute('y', String(y))
    label.setAttribute('fill', '#8ab4f8')
    label.setAttribute('font-size', '11')
    label.setAttribute('text-anchor', 'middle')
    label.textContent = text.replace(/^(route|soft):\s*/, '')
    svg.append(label)
  }
  edges.forEach((edge, index) => {
    const from = box.get(edge.from)
    const to = box.get(edge.to)
    if (!from || !to) return
    const fromRank = rank.get(edge.from)
    const toRank = rank.get(edge.to)
    const y1 = midY(from)
    const y2 = midY(to)
    if (toRank === fromRank) {
      const rail = Math.max(from.x + from.w, to.x + to.w) + 28
      stroke(`M ${from.x + from.w} ${y1} H ${rail} V ${y2} H ${to.x + to.w}`)
      edgeText(rail + 8, (y1 + y2) / 2, edge.label)
      return
    }
    if (toRank < fromRank) {
      const lane = 18 + backEdges.indexOf(edge) * 16
      stroke(`M ${from.x} ${y1} H ${lane} V ${y2} H ${to.x}`)
      edgeText((lane + to.x) / 2, y2 - 6, edge.label)
      return
    }
    const gutter = from.x + from.w + (to.x - (from.x + from.w)) / 2
    stroke(`M ${from.x + from.w} ${y1} H ${gutter} V ${y2} H ${to.x}`)
    edgeText((gutter + to.x) / 2, y2 - 8, edge.label)
  })
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  defs.innerHTML = '<marker id="comonad-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6" fill="#8b949e"></path></marker>'
  svg.prepend(defs)
  for (const [id, node] of box) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(node.x))
    rect.setAttribute('y', String(node.y))
    rect.setAttribute('width', String(node.w))
    rect.setAttribute('height', String(node.h))
    rect.setAttribute('rx', '8')
    rect.setAttribute('fill', id === start ? '#1f3b2d' : '#21262d')
    rect.setAttribute('stroke', id === start ? '#3fb950' : '#8b949e')
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(node.x + node.w / 2))
    label.setAttribute('y', String(node.y + 23))
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('fill', '#eee')
    label.setAttribute('font-size', '12')
    label.textContent = node.label
    svg.append(rect, label)
  }
  return svg
}

function graphNode(input) {
  const match = input.match(/^([A-Za-z_][A-Za-z0-9_]*)/)
  if (!match) return { id: '', label: '' }
  const id = match[1]
  const quoted = input.slice(id.length).match(/^\["([^"]*)"\]/)
  return { id, label: quoted?.[1] || id }
}

function paintPending() {
  pendingMark.textContent = filesOpen ? '▾' : '▸'
  pendingFiles.hidden = !filesOpen
  pendingFiles.replaceChildren()
  if (!reviewFiles.length) {
    const empty = document.createElement('p')
    empty.className = 'comonad-review-empty'
    empty.textContent = 'No pending changes'
    pendingFiles.append(empty)
    return
  }
  reviewFiles.forEach((file, index) => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'comonad-pending-file'
    row.dataset.review = 'file'
    row.dataset.index = String(index)
    const name = document.createElement('span')
    name.textContent = file.path
    const stat = document.createElement('span')
    stat.className = 'comonad-stat'
    if (file.additions) stat.append(statSpan('add', `+${file.additions}`))
    if (file.deletions) stat.append(statSpan('del', `-${file.deletions}`))
    row.append(name, stat)
    pendingFiles.append(row)
  })
}

async function reviewAction(action, path, hunk) {
  const response = await fetch(`/api/plugins/comonad/diff/${action}`, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify({
      chatId: currentChatId(),
      path,
      directory: chatRecord().workingDirectory || '',
      hunk: hunk === undefined ? undefined : Number(hunk),
    }),
  })
  if (!response.ok) return
  editorDirty = false
  await refreshReview('stay')
}

async function reviewAll(action) {
  const directory = chatRecord().workingDirectory || ''
  for (const file of [...reviewFiles]) {
    await fetch(`/api/plugins/comonad/diff/${action}`, {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify({ chatId: currentChatId(), path: file.path, directory }),
    })
  }
  await refreshReview('stay')
}

function paintReview() {
  review.replaceChildren()
  const top = document.createElement('div')
  top.className = 'comonad-review-top'
  const title = document.createElement('span')
  title.textContent = 'Review'
  const actions = document.createElement('div')
  actions.append(reviewButton('undo-all', 'Undo All'), reviewButton('keep-all', 'Keep All'), reviewButton('close', 'Close'))
  top.append(title, actions)
  const body = document.createElement('div')
  body.className = 'comonad-review-body'
  const diff = document.createElement('div')
  diff.className = 'comonad-review-diff'
  reviewFiles.forEach((file, index) => diff.append(paintFile(file, index)))
  body.append(diff, paintList())
  review.append(top, body)
}

function paintList() {
  const side = document.createElement('div')
  side.className = 'comonad-review-side'
  const count = document.createElement('div')
  count.className = 'comonad-review-side-count'
  count.textContent = `${reviewFiles.length} File${reviewFiles.length === 1 ? '' : 's'}`
  side.append(count)
  reviewFiles.forEach((file, index) => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'comonad-review-row'
    if (index === reviewIndex) row.classList.add('is-active')
    row.dataset.review = 'file'
    row.dataset.index = String(index)
    const name = document.createElement('span')
    name.textContent = file.path
    const stat = document.createElement('span')
    stat.className = 'comonad-stat'
    if (file.additions) stat.append(statSpan('add', `+${file.additions}`))
    if (file.deletions) stat.append(statSpan('del', `-${file.deletions}`))
    row.append(name, stat)
    side.append(row)
  })
  return side
}

function paintFile(file, index) {
  const view = document.createElement('section')
  view.className = 'comonad-review-file'
  view.id = `comonad-file-${index}`
  const head = document.createElement('div')
  head.className = 'comonad-review-head'
  const name = document.createElement('span')
  name.textContent = file.path
  const stat = document.createElement('span')
  stat.className = 'comonad-stat'
  if (file.additions) stat.append(statSpan('add', `+${file.additions}`))
  if (file.deletions) stat.append(statSpan('del', `-${file.deletions}`))
  const fileActions = document.createElement('div')
  fileActions.append(fileButton('undo', 'Undo File', file.path), fileButton('keep', 'Keep File', file.path))
  head.append(name, stat, fileActions)
  view.append(head)
  file.hunks.forEach((hunk, hunkIndex) => {
    const gap = gapBefore(file.hunks, hunkIndex)
    if (gap > 0) view.append(hiddenLines(gap))
    const block = document.createElement('div')
    block.className = 'comonad-hunk'
    const tools = document.createElement('div')
    tools.className = 'comonad-hunk-tools'
    tools.append(fileButton('undo', 'Undo', file.path, hunkIndex), fileButton('keep', 'Keep', file.path, hunkIndex))
    block.append(tools, paintSplit(hunk))
    view.append(block)
  })
  return view
}

function paintSplit(hunk) {
  const split = document.createElement('div')
  split.className = 'comonad-split'
  for (const row of hunkRows(hunk)) {
    const line = document.createElement('div')
    line.className = 'comonad-split-row'
    line.append(splitCell(row.left), splitCell(row.right))
    split.append(line)
  }
  return split
}

function splitCell(cell) {
  const side = document.createElement('div')
  side.className = `comonad-cell${cell ? ` ${cell.type}` : ''}`
  const num = document.createElement('span')
  num.className = 'comonad-num'
  num.textContent = cell?.num ? String(cell.num) : ''
  const code = document.createElement('span')
  code.className = 'comonad-code'
  code.textContent = cell?.text ?? ''
  side.append(num, code)
  return side
}

function hunkRows(hunk) {
  const range = hunkRange(hunk.header)
  let oldLine = range.oldStart
  let newLine = range.newStart
  const rows = []
  let index = 0
  const lines = hunk.lines
  while (index < lines.length) {
    const line = lines[index]
    if (line.type === 'ctx') {
      rows.push({ left: { ...line, num: oldLine }, right: { ...line, num: newLine } })
      oldLine += 1
      newLine += 1
      index += 1
      continue
    }
    const dels = []
    while (index < lines.length && lines[index].type === 'del') {
      dels.push({ ...lines[index], num: oldLine })
      oldLine += 1
      index += 1
    }
    const adds = []
    while (index < lines.length && lines[index].type === 'add') {
      adds.push({ ...lines[index], num: newLine })
      newLine += 1
      index += 1
    }
    const count = Math.max(dels.length, adds.length)
    for (let offset = 0; offset < count; offset += 1) rows.push({ left: dels[offset] ?? null, right: adds[offset] ?? null })
  }
  return rows
}

function hunkRange(header) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
  return {
    oldStart: Number(match?.[1] ?? 1),
    oldCount: Number(match?.[2] ?? 1),
    newStart: Number(match?.[3] ?? 1),
  }
}

function gapBefore(hunks, index) {
  const start = hunkRange(hunks[index].header).oldStart
  if (index === 0) return Math.max(0, start - 1)
  const prev = hunkRange(hunks[index - 1].header)
  return Math.max(0, start - (prev.oldStart + prev.oldCount - 1) - 1)
}

function hiddenLines(count) {
  const note = document.createElement('div')
  note.className = 'comonad-hidden'
  note.textContent = `${count} hidden line${count === 1 ? '' : 's'}`
  return note
}

function statSpan(kind, text) {
  const span = document.createElement('span')
  span.className = kind
  span.textContent = text
  return span
}

function reviewButton(action, label) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.review = action
  button.textContent = label
  return button
}

function fileButton(action, label, path, hunk) {
  const button = reviewButton(action, label)
  button.dataset.path = path
  if (hunk !== undefined) button.dataset.hunk = String(hunk)
  return button
}

const tavernContext = tavern()
const changed = tavernContext.event_types?.CHAT_CHANGED
const rendered = tavernContext.event_types?.USER_MESSAGE_RENDERED
if (tavernContext.eventSource && changed) tavernContext.eventSource.on(changed, () => {
  loadPanel()
  mountRevert()
  mountTraces()
})
const received = tavernContext.event_types?.MESSAGE_RECEIVED
if (tavernContext.eventSource && received) tavernContext.eventSource.on(received, () => settleTrace())
const messageEdited = tavernContext.event_types?.MESSAGE_EDITED
if (tavernContext.eventSource && messageEdited) tavernContext.eventSource.on(messageEdited, (id) => {
  const message = tavern().chat?.[id]
  if (!message?.extra?.comonadTrace) return
  message.extra.comonadEdited = !knownForm(message)
})
const messageUpdated = tavernContext.event_types?.MESSAGE_UPDATED
if (tavernContext.eventSource && messageUpdated) tavernContext.eventSource.on(messageUpdated, (id) => {
  const index = Number(id)
  if (liveTrace && streamingMessage()?.index === index) return
  mountTraceAt(index)
})
const streamingToken = tavernContext.event_types?.STREAM_TOKEN_RECEIVED
if (tavernContext.eventSource && streamingToken) tavernContext.eventSource.on(streamingToken, () => mountLive())
if (tavernContext.eventSource && rendered) tavernContext.eventSource.on(rendered, mountRevert)
mountRevert()
mountTraces()
void loadSettings().then(() => loadPanel()).catch(() => {
  settingsReady = true
  loadPanel()
})

const originalFetch = window.fetch.bind(window)
window.fetch = async function comonadFetch(input, init) {
  const url = requestUrl(input)
  const record = chatRecord()
  if (!record.enabled || !url.includes('/api/backends/chat-completions/generate')) {
    return originalFetch(input, init)
  }
  const payload = parseBody(init)
  if (payload?.type && payload.type !== 'normal' && payload.type !== 'continue' && payload.type !== 'regenerate' && payload.type !== 'swipe') {
    return originalFetch(input, init)
  }
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  return streamAgent(messages, init?.signal, payload?.stream !== false, payload)
}

function tavern() {
  return globalThis.SillyTavern?.getContext?.() ?? {}
}

function chatRecord() {
  const ctx = tavern()
  const metadata = ctx.chatMetadata ?? ctx.chat_metadata ?? (globalThis.chat_metadata ??= {})
  if (!metadata[META]) {
    const fresh = {
      enabled: false,
      workMode: agentDefaults.workMode || 'ro',
      approval: agentDefaults.approval || 'manual',
      network: Boolean(agentDefaults.network),
      workingDirectory: agentDefaults.workingDirectory || '',
      display: traceForm(agentDefaults.display),
      context: traceForm(agentDefaults.context),
    }
    if (!settingsReady) return fresh
    metadata[META] = fresh
  }
  const record = metadata[META]
  if (!record.display) record.display = traceForm(record.context)
  return record
}

let replayRegenerate = false
let regenerateChoice = ''

document.addEventListener('click', (event) => {
  if (replayRegenerate) {
    replayRegenerate = false
    return
  }
  const trigger = event.target?.closest?.('#option_regenerate, .mes_regen')
  if (!trigger) return
  const record = chatRecord()
  if (!record.enabled || !record.workingDirectory || !lastUserCheckpoint()) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  openRegenerate(trigger)
}, true)

function checkpointAction(type) {
  if (type === 'regenerate' && regenerateChoice) {
    const choice = regenerateChoice
    regenerateChoice = ''
    return choice
  }
  if (type === 'regenerate' || type === 'swipe') return 'restore'
  if (type === 'continue') return 'keep'
  return 'capture'
}

function lastUserCheckpoint() {
  const chat = tavern().chat
  if (!Array.isArray(chat)) return ''
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    const message = chat[index]
    if (!message?.is_user) continue
    return message.extra?.comonadCheckpoint || ''
  }
  return ''
}

function openRegenerate(trigger) {
  const dialog = document.createElement('div')
  dialog.className = 'comonad-dialog'
  dialog.innerHTML = `<section><h3>Regenerate this reply?</h3><p>File changes after this message will be reverted so they match, or kept as they are.</p><div><button type="button" data-revert="cancel">Cancel</button><button type="button" data-revert="keep">Keep Files</button><button type="button" data-revert="files">Revert Files</button></div></section>`
  dialog.addEventListener('click', (event) => {
    const choice = event.target?.dataset?.revert
    if (!choice) return
    dialog.remove()
    if (choice === 'cancel') return
    if (choice === 'files') {
      void revertThenRegenerate(trigger)
      return
    }
    regenerateChoice = 'keep'
    replayRegenerate = true
    trigger.click()
  })
  document.body.append(dialog)
}

async function revertThenRegenerate(trigger) {
  const id = lastUserCheckpoint()
  if (!id) return
  const response = await fetch('/api/plugins/comonad/revert', {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify({
      chatId: currentChatId(),
      directory: chatRecord().workingDirectory || '',
      checkpoint: id,
    }),
  })
  if (!response.ok) return
  regenerateChoice = 'restore'
  editorDirty = false
  forgetBatch()
  await refreshReview('auto')
  replayRegenerate = true
  trigger.click()
}

function stampCheckpoint() {
  const ctx = tavern()
  const chat = ctx.chat
  if (!Array.isArray(chat)) return undefined
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    const message = chat[index]
    if (!message?.is_user) continue
    message.extra ??= {}
    message.extra.comonadCheckpoint ??= crypto.randomUUID()
    if (typeof ctx.saveChat === 'function') void ctx.saveChat()
    return message.extra.comonadCheckpoint
  }
  return undefined
}

function mountRevert() {
  const chat = tavern().chat
  if (!Array.isArray(chat)) return
  chat.forEach((message, index) => {
    const id = message?.extra?.comonadCheckpoint
    if (!message?.is_user || !id) return
    const mes = document.querySelector(`.mes[mesid="${index}"]`)
    if (!mes || mes.querySelector('.comonad-revert')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'comonad-revert'
    button.textContent = 'Revert'
    button.addEventListener('click', () => openRevert(index, id))
    ;(mes.querySelector('.mes_block') ?? mes).append(button)
  })
}

function openRevert(index, id) {
  const dialog = document.createElement('div')
  dialog.className = 'comonad-dialog'
  dialog.innerHTML = `<section><h3>Revert files to this message?</h3><p>Later messages in this chat will be removed. File changes after this message will be reverted so they match, or kept as they are.</p><div><button type="button" data-revert="cancel">Cancel</button><button type="button" data-revert="keep">Keep Files</button><button type="button" data-revert="files">Revert Files</button></div></section>`
  dialog.addEventListener('click', (event) => {
    const choice = event.target?.dataset?.revert
    if (!choice) return
    dialog.remove()
    if (choice === 'cancel') return
    void finishRevert(index, id, choice === 'files')
  })
  document.body.append(dialog)
}

async function finishRevert(index, id, restore) {
  if (restore) {
    const response = await fetch('/api/plugins/comonad/revert', {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify({
        chatId: currentChatId(),
        directory: chatRecord().workingDirectory || '',
        checkpoint: id,
      }),
    })
    if (!response.ok) return
    editorDirty = false
    forgetBatch()
    await refreshReview('auto')
  }
  const ctx = tavern()
  if (!Array.isArray(ctx.chat) || index < 0 || index >= ctx.chat.length) return
  ctx.chat.length = index + 1
  if (typeof ctx.saveChat === 'function') void ctx.saveChat()
  document.querySelectorAll('.mes').forEach((node) => {
    if (Number(node.getAttribute('mesid')) > index) node.remove()
  })
}

function saveChat() {
  const ctx = tavern()
  if (typeof ctx.saveMetadata === 'function') void ctx.saveMetadata()
}

function loadPanel() {
  const record = chatRecord()
  const workMode = record.workMode || 'ro'
  const approval = record.approval || 'manual'
  directoryButton.textContent = record.workingDirectory || 'Working directory'
  directoryButton.title = record.workingDirectory || ''
  const modeButton = bar.querySelector('.comonad-pill[data-menu="mode"]')
  modeButton.dataset.on = record.enabled ? 'true' : 'false'
  modeLabel.textContent = record.enabled ? (MODES.find(([value]) => value === workMode)?.[1] ?? 'Agent') : 'Chat'
  approvalLabel.textContent = APPROVALS.find(([value]) => value === approval)?.[1] ?? 'Ask'
  contextLabel.textContent = CONTEXTS.find(([value]) => value === contextMode())?.[1] ?? 'Rendered'
  networkButton.dataset.on = record.network ? 'true' : 'false'
  void refreshReview('auto')
  for (const choice of bar.querySelectorAll('.comonad-choice')) {
    const selected = choice.dataset.context
      ? choice.dataset.context === contextMode()
      : choice.dataset.agent === 'off'
        ? !record.enabled
        : choice.dataset.mode
          ? Boolean(record.enabled) && choice.dataset.mode === workMode
          : choice.dataset.approval === approval
    choice.classList.toggle('is-selected', selected)
  }
}

function currentChatId() {
  const ctx = tavern()
  return String(ctx.getCurrentChatId?.() || ctx.chatId || 'default')
}

function requestHeaders() {
  const ctx = tavern()
  const headers = typeof ctx.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : {}
  return { 'Content-Type': 'application/json', ...headers }
}

function requestUrl(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return ''
}

const SAMPLING_KEYS = [
  'temperature',
  'top_p',
  'top_k',
  'top_a',
  'min_p',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'max_tokens',
  'max_completion_tokens',
  'stop',
  'logit_bias',
  'seed',
  'n',
  'reasoning_effort',
  'include_reasoning',
]

function samplingFrom(payload) {
  const sampling = {}
  if (!payload || typeof payload !== 'object') return sampling
  for (const key of SAMPLING_KEYS) {
    if (payload[key] !== undefined) sampling[key] = payload[key]
  }
  return sampling
}

function parseBody(init) {
  if (!init?.body || typeof init.body !== 'string') return null
  try {
    return JSON.parse(init.body)
  } catch {
    return null
  }
}

function streamAgent(messages, signal, streaming, payload) {
  if (!streaming) {
    return run(messages, signal, () => {}, payload).then((content) => Response.json({
      choices: [{ message: { role: 'assistant', content } }],
    }))
  }
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const push = (text) => controller.enqueue(encoder.encode(chunk(text)))
      try {
        await run(messages, signal, push, payload)
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

async function run(messages, signal, push, payload) {
  const chatId = currentChatId()
  const record = chatRecord()
  messages = applyContext(messages)
  beginTrace(payload?.type)
  let path = '/api/plugins/comonad/turn'
  let body = {
    chatId,
    messages,
    text: lastUser(messages),
    connection: {
      source: payload?.chat_completion_source,
      reverseProxy: payload?.reverse_proxy,
      proxyPassword: payload?.proxy_password,
      customUrl: payload?.custom_url,
      model: payload?.model,
      siliconflowEndpoint: payload?.siliconflow_endpoint,
      minimaxEndpoint: payload?.minimax_endpoint,
      zaiEndpoint: payload?.zai_endpoint,
    },
    policy: {
      workMode: record.workMode,
      approval: record.approval,
      network: Boolean(record.network),
      workingDirectory: record.workingDirectory || '',
    },
    checkpoint: stampCheckpoint(),
    checkpointAction: checkpointAction(payload?.type),
    sampling: samplingFrom(payload),
  }
  signal?.addEventListener('abort', () => {
    void originalFetch('/api/plugins/comonad/stop', {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify({ chatId }),
    })
    void refreshReview('auto')
  }, { once: true })
  try {
    while (true) {
      const response = await originalFetch(path, {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify(body),
        signal,
      })
      const outcome = await readEvents(response, push)
      if (outcome.event === 'done') {
        void refreshReview('auto')
        return liveTrace ? traceTexts(liveTrace.parts).token : (outcome.data?.content ?? '')
      }
      if (outcome.event !== 'suspended') throw new Error(outcome.data?.message || 'agent failed')
      const allow = await confirmTools(outcome.data?.calls ?? [])
      path = '/api/plugins/comonad/resume'
      body = { chatId, allow }
    }
  } catch (error) {
    void refreshReview('auto')
    throw error
  } finally {
    setTimeout(() => settleTrace(), 300)
  }
}

async function readEvents(response, push) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let last = { event: 'error', data: { message: 'empty agent response' } }
  while (true) {
    const step = await reader.read()
    if (step.done) return last
    buffer += decoder.decode(step.value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const block of chunks) {
      const parsed = parseEvent(block)
      if (!parsed) continue
      const text = noteEvent(parsed)
      if (text) push(text)
      last = parsed
    }
  }
}

function noteEvent(parsed) {
  if (!liveTrace) return ''
  if (parsed.event === 'token' && parsed.data?.text) {
    addToken(liveTrace, parsed.data.text)
    mountLive()
    return parsed.data.text
  }
  if (parsed.event === 'reasoning' && parsed.data?.text) {
    addThought(liveTrace, parsed.data.text)
    mountLive()
    return ''
  }
  if (parsed.event === 'tool-delta') {
    addToolDelta(liveTrace, parsed.data)
    mountLive()
    return ''
  }
  if (parsed.event === 'tool-result') {
    addToolResult(liveTrace, parsed.data)
    mountLive()
    return ''
  }
  return ''
}

function parseEvent(block) {
  let event = 'message'
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }
  if (!data.length) return null
  try {
    return { event, data: JSON.parse(data.join('\n')) }
  } catch {
    return null
  }
}

function lastUser(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') return typeof message.content === 'string' ? message.content : ''
  }
  return ''
}

function chunk(text) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`
}

function confirmTools(calls) {
  const list = calls.map((call) => `${call.name} ${call.arguments ?? ''}`).join('\n') || '(no calls)'
  return new Promise((resolve) => {
    const dialog = document.createElement('div')
    dialog.className = 'comonad-dialog'
    dialog.innerHTML = `<section><h3>Allow these tools?</h3><pre></pre><div><button type="button" data-allow="no">Reject</button><button type="button" data-allow="yes">Allow</button></div></section>`
    dialog.querySelector('pre').textContent = list
    dialog.addEventListener('click', (event) => {
      const choice = event.target?.dataset?.allow
      if (!choice) return
      dialog.remove()
      resolve(choice === 'yes')
    })
    document.body.append(dialog)
  })
}

const traceViews = new WeakMap()

document.addEventListener('click', (event) => {
  const tab = event.target.closest?.('.comonad-trace-tabs button')
  if (tab) {
    event.preventDefault()
    event.stopPropagation()
    const mes = tab.closest('.mes')
    const index = Number(mes?.getAttribute('mesid'))
    const message = tavern().chat?.[index]
    if (!message) return
    traceViews.set(message, tab.dataset.view)
    writeMes(message, formText(message.extra?.comonadTrace, tab.dataset.view))
    mountTraceAt(index)
    const area = mes.querySelector('.edit_textarea')
    if (area instanceof HTMLTextAreaElement) area.value = message.mes ?? ''
    return
  }
  const mes = event.target.closest?.('.mes.comonad-traced')
  if (!mes || !event.target.closest?.('.mes_edit, .mes_edit_done, .mes_edit_cancel')) return
  requestAnimationFrame(() => syncTraceEditing(mes))
})

function traceForm(value) {
  if (value === 'full') return 'raw'
  return value === 'token' || value === 'raw' || value === 'rendered' ? value : 'rendered'
}

function contextMode() {
  return traceForm(chatRecord().context)
}

function displayMode() {
  const record = chatRecord()
  return traceForm(record.display || record.context)
}

function beginTrace(type) {
  const target = streamingMessage()
  const existing = type === 'continue' ? target?.message?.extra?.comonadTrace : null
  const parts = existing?.parts ? existing.parts.map((part) => ({ ...part })) : []
  const tools = {}
  parts.forEach((part, index) => {
    if (part.type === 'tool') tools[toolKey(part, index)] = part
  })
  liveTrace = { parts, tools, open: '' }
}

function addThought(trace, text) {
  if (trace.open !== 'thought') {
    trace.parts.push({ type: 'thought', text: '' })
    trace.open = 'thought'
  }
  trace.parts[trace.parts.length - 1].text += text
}

function addToken(trace, text) {
  trace.open = 'text'
  const last = trace.parts[trace.parts.length - 1]
  if (last?.type === 'text') last.text += text
  else trace.parts.push({ type: 'text', text })
}

function toolKey(part, index) {
  if (part?.id) return part.id
  return `index:${part?.index ?? index ?? 0}`
}

function addToolDelta(trace, data) {
  trace.open = 'tool'
  const key = data?.id || `index:${data?.index ?? 0}`
  let tool = trace.tools[key]
  const startsNew = Boolean(data?.name && tool?.arguments)
  if (!tool || tool.result !== undefined || startsNew) {
    tool = { type: 'tool', name: '', arguments: '', result: undefined, id: data?.id, index: data?.index }
    trace.tools[key] = tool
    trace.parts.push(tool)
  }
  if (data?.id) tool.id = data.id
  tool.name += data?.name || ''
  tool.arguments += data?.arguments || ''
}

function addToolResult(trace, data) {
  const unfinished = (part) => part.type === 'tool' && part.result === undefined
  const tool = (data?.id && trace.parts.find((part) => unfinished(part) && part.id === data.id))
    || (data?.name && trace.parts.find((part) => unfinished(part) && part.name === data.name))
    || trace.parts.find(unfinished)
  if (tool) tool.result = String(data?.content ?? '')
}

function traceTexts(parts) {
  return {
    token: parts.filter((part) => part.type === 'text').map((part) => part.text).join(''),
    raw: parts.map(rawPart).join(''),
    rendered: parts.map(renderedPart).filter(Boolean).join('\n\n'),
  }
}

function rawPart(part) {
  if (part.type === 'thought') return `\nThought\n${part.text}`
  if (part.type === 'tool') return `\n\n> ${part.name || ''}${part.arguments || ''}\n${part.result || ''}\n`
  return part.text || ''
}

function renderedPart(part) {
  if (part.type === 'thought') return `Thought\n${part.text}`
  if (part.type === 'tool') return `Tool ${part.name || ''}\n${part.arguments || ''}\nResult\n${part.result || ''}`
  return part.text || ''
}

function streamingMessage() {
  const chat = tavern().chat
  if (!Array.isArray(chat) || !chat.length) return null
  const index = chat.length - 1
  const message = chat[index]
  if (!message || message.is_user) return null
  return { index, message }
}

function writeMes(message, text) {
  let changed = message.mes !== text
  message.mes = text
  const swipe = message.swipe_id ?? 0
  if (Array.isArray(message.swipes) && message.swipes[swipe] != null && message.swipes[swipe] !== text) {
    message.swipes[swipe] = text
    changed = true
  }
  return changed
}

function viewOf(message) {
  const chosen = message && traceViews.get(message)
  if (chosen === 'full') return 'raw'
  if (chosen === 'rendered' || chosen === 'token' || chosen === 'raw') return chosen
  return displayMode()
}

function formText(trace, view) {
  if (!trace) return ''
  if (view === 'token') return trace.token ?? ''
  if (view === 'raw') return trace.raw ?? trace.full ?? ''
  return trace.rendered ?? ''
}

function knownForm(message) {
  const trace = message?.extra?.comonadTrace
  if (!trace) return false
  const mes = message.mes ?? ''
  return mes === (trace.token ?? '') || mes === (trace.rendered ?? '') || mes === (trace.raw ?? trace.full ?? '') || mes === ''
}

function syncMessageForm(message) {
  const trace = message?.extra?.comonadTrace
  if (!trace || (message.extra?.comonadEdited && !knownForm(message))) return false
  if (message.extra) message.extra.comonadEdited = false
  return writeMes(message, formText(trace, viewOf(message)))
}

function settleTrace() {
  const target = streamingMessage()
  if (!target) return
  let dirty = false
  if (liveTrace) {
    const texts = traceTexts(liveTrace.parts)
    const parts = liveTrace.parts.map((part) => part.type === 'tool'
      ? { type: 'tool', name: part.name, arguments: part.arguments, result: part.result ?? '', id: part.id, index: part.index }
      : { type: part.type, text: part.text })
    target.message.extra ??= {}
    target.message.extra.comonadTrace = { parts, ...texts }
    delete target.message.extra.comonadEdited
    liveTrace = null
    dirty = true
  }
  const trace = target.message.extra?.comonadTrace
  if (trace && syncMessageForm(target.message)) dirty = true
  if (dirty) {
    const ctx = tavern()
    if (typeof ctx.saveChat === 'function') void ctx.saveChat()
  }
  mountTraces()
}

function applyContext(messages) {
  const chat = tavern().chat
  if (!Array.isArray(messages) || !Array.isArray(chat)) return messages
  const traces = chat.filter((message) => message && !message.is_user && message.extra?.comonadTrace)
  let cursor = traces.length - 1
  const mode = contextMode()
  const copy = messages.map((message) => ({ ...message }))
  for (let index = copy.length - 1; index >= 0 && cursor >= 0; index -= 1) {
    if (copy[index]?.role !== 'assistant') continue
    const message = traces[cursor]
    cursor -= 1
    const trace = message.extra.comonadTrace
    const raw = trace.raw ?? trace.full
    const forms = [trace.token, raw, trace.rendered, message.mes]
    const chosen = mode === 'raw' ? raw : trace[mode]
    if (!forms.includes(copy[index].content) || chosen == null) continue
    copy[index].content = chosen
  }
  return copy
}

function mountTraces() {
  const chat = tavern().chat
  if (!Array.isArray(chat)) return
  const editing = Boolean(document.querySelector('#curEditTextarea'))
  let dirty = false
  chat.forEach((message, index) => {
    if (!message?.extra?.comonadTrace) return
    if (!editing && syncMessageForm(message)) dirty = true
    mountTraceAt(index)
  })
  mountLive()
  if (dirty) {
    const ctx = tavern()
    if (typeof ctx.saveChat === 'function') void ctx.saveChat()
  }
}

function mountLive() {
  if (!liveTrace) return
  const target = streamingMessage()
  if (!target) return
  const texts = traceTexts(liveTrace.parts)
  paintTrace(target.index, { parts: liveTrace.parts, ...texts })
}

function mountTraceAt(index) {
  const message = tavern().chat?.[index]
  const trace = message?.extra?.comonadTrace
  if (!trace) return
  paintTrace(index, trace)
}

function traceSuppressed(message) {
  return Boolean(message?.extra?.comonadEdited && !knownForm(message))
}

function syncTraceEditing(mes) {
  if (!(mes instanceof Element)) return
  const editing = Boolean(mes.querySelector('.mes_block > .mes_text .edit_textarea'))
  mes.classList.toggle('is-editing', editing)
}

function paintTrace(index, trace) {
  const mes = document.querySelector(`.mes[mesid="${index}"]`)
  const block = mes?.querySelector('.mes_block') ?? mes
  if (!block) return
  const message = tavern().chat?.[index]
  block.querySelector('.comonad-trace')?.remove()
  if (traceSuppressed(message)) {
    mes.classList.remove('comonad-traced', 'is-editing')
    return
  }
  mes.classList.add('comonad-traced')
  const view = viewOf(message)
  const panel = document.createElement('div')
  panel.className = 'comonad-trace'
  const tabs = document.createElement('div')
  tabs.className = 'comonad-trace-tabs'
  for (const [value, label] of CONTEXTS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.view = value
    button.textContent = label
    button.classList.toggle('is-selected', value === view)
    tabs.append(button)
  }
  const body = document.createElement('div')
  body.className = 'comonad-trace-body'
  body.replaceChildren(view === 'rendered' ? renderedNodes(trace.parts, index) : tracePre(view === 'token' ? trace.token : (trace.raw ?? trace.full)))
  panel.append(tabs, body)
  const text = [...block.children].find((node) => node.classList.contains('mes_text'))
  if (text) text.before(panel)
  else block.prepend(panel)
  syncTraceEditing(mes)
}

function renderedNodes(parts, index) {
  const host = document.createElement('div')
  host.className = 'comonad-rendered'
  for (const part of parts ?? []) {
    if (part.type === 'thought') host.append(fold('Thought', part.text))
    else if (part.type === 'tool') host.append(fold(`> ${part.name || 'tool'}`, `${part.arguments || ''}\n\n${part.result || ''}`))
    else host.append(traceMarkdown(part.text, index))
  }
  return host
}

function traceMarkdown(text, index) {
  const ctx = tavern()
  const message = ctx.chat?.[index]
  const node = document.createElement('div')
  node.className = 'comonad-md'
  const format = ctx.messageFormatting
  node.innerHTML = typeof format === 'function'
    ? format(text || '', message?.name ?? '', Boolean(message?.is_system), false, index, {}, false)
    : ''
  if (typeof format !== 'function') node.textContent = text || ''
  return node
}

function fold(title, text) {
  const details = document.createElement('details')
  details.className = 'comonad-fold'
  const summary = document.createElement('summary')
  summary.textContent = title
  details.append(summary, tracePre(text))
  return details
}

function tracePre(text) {
  const pre = document.createElement('pre')
  pre.className = 'comonad-trace-pre'
  pre.textContent = text || ''
  return pre
}
