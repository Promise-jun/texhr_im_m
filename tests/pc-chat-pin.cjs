// node tests/pc-chat-pin.cjs：业务接口和云信均为内存模拟，不修改真实账号的置顶状态。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.resolve(__dirname, '..')
const panelSource = fs.readFileSync(path.join(root, 'components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')
const pageSource = fs.readFileSync(path.join(root, 'pages/ehr/pc/chat.vue'), 'utf8')
const conversationSource = fs.readFileSync(path.join(root, 'services/conversation.js'), 'utf8')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function loadComponent(source, globals) {
  const context = vm.createContext({ module: { exports: {} }, ...globals })
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'module.exports =')
  vm.runInContext(script, context)
  return context.module.exports
}

function instance(def, base) {
  Object.assign(base, def.data.call(base))
  for (const [name, method] of Object.entries(def.methods)) base[name] = method.bind(base)
  for (const [name, getter] of Object.entries(def.computed)) {
    Object.defineProperty(base, name, typeof getter === 'function' ? { get: getter.bind(base) }
      : { get: getter.get.bind(base), set: getter.set.bind(base) })
  }
  return base
}

function environment(options = {}) {
  const calls = [], sticks = [], toasts = [], events = [], logs = []
  const state = { loggedIn: true, reloads: 0 }
  let request = async () => ({ Code: 0, Data: {} })
  let stick = async () => {}
  const nim = {
    V2NIMLoginService: { getLoginUser: () => 'enterprise' },
    V2NIMConversationIdUtil: { parseConversationTargetId: id => `person-${id}` },
    V2NIMLocalConversationService: { stickTopConversation: (id, value) => {
      sticks.push({ id, value }); return stick(id, value)
    } }
  }
  const globals = { console: { error: (...args) => logs.push(args), warn() {} },
    getNimInstance: () => nim, isNimLoggedIn: () => state.loggedIn, NIM_EMOJIS: [], PcChatPanel: {},
    requestApi: args => { calls.push(args); return request(args) },
    uni: { showToast: value => toasts.push(value.title), showModal() {} } }
  const serviceContext = vm.createContext(globals)
  vm.runInContext(conversationSource.replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), serviceContext)
  globals.normalizeAndSortConversations = serviceContext.normalizeAndSortConversations
  const pageDef = loadComponent(pageSource, globals)
  const page = instance(pageDef, { _conversationPageAlive: true, _openConversationRequestId: 0 })
  page.pageVisible = true
  page.rawConversations = [
    { conversationId: 'b', type: 1, stickTop: false, unreadCount: 3,
      lastMessage: { messageRefer: { createTime: 200 } }, updateTime: 900 },
    { conversationId: 'a', type: 1, stickTop: Boolean(options.stickTop), unreadCount: 2,
      lastMessage: { messageRefer: { createTime: 100 } }, updateTime: 800 }
  ]
  page.chatDetail = { conversationId: 'a', conversation: page.conversations.find(item => item.id === 'a'),
    jobId: 'job', resumeId: 'resume', personAccId: 'person-a', enterpriseAccId: 'enterprise' }
  if ('isPinned' in options) page.chatDetail.isPinned = options.isPinned
  page.scheduleConversationReload = () => { state.reloads++ }
  const panelDef = loadComponent(panelSource, globals)
  const panel = instance(panelDef, { conversation: page.activeConversation, detail: page.chatDetail,
    jobId: 'job', resumeId: 'resume', personAccId: 'person-a', enterpriseAccId: 'enterprise',
    drafts: { a: 'a draft', b: 'b draft' }, visible: true, opening: false, _alive: true,
    $emit: (event, payload) => {
      events.push({ event, payload })
      if (event === 'pin-changed') page.handleConversationPinChanged(payload)
      if (event === 'changed') page.scheduleConversationReload()
    } })
  panel.accessReady = true
  panel.loadCommonPhrases = () => {}
  panel.prepareConversation = () => {}
  return { panel, panelDef, page, calls, sticks, toasts, events, logs, state, nim,
    request: fn => { request = fn }, stick: fn => { stick = fn } }
}

async function verify() {
  assert.match(panelSource, /:disabled="isPinning \|\| !accessReady \|\| opening"/)
  assert.match(panelSource, /:aria-pressed="isPinned \? 'true' : 'false'"/)
  assert.match(pageSource, /@pin-changed="handleConversationPinChanged"/)
  assert.equal(environment({ isPinned: false, stickTop: true }).panel.isPinned, false)
  assert.equal(environment({ stickTop: true }).panel.isPinned, true)

  for (const [value, expected] of [[true, true], [1, true], ['1', true], ['TRUE', true],
    [false, false], [0, false], ['0', false], ['false', false], [null, false]]) {
    for (const location of ['data', 'root']) {
      const env = environment({ isPinned: !expected })
      env.request(async () => location === 'data'
        ? { Code: 0, IsTop: !expected, Data: JSON.stringify({ IsTop: value }) }
        : { Code: 0, IsTop: value, Data: {} })
      await env.panel.loadChatAccess()
      assert.equal(env.panel.isPinned, expected)
      assert.equal(env.calls[0].Name, 'Chat.MyChat.Limits')

      env.page.chatDetail = null
      env.request(async () => location === 'data'
        ? { Code: 0, IsTop: !expected, Data: { JobId: 'job', ResumeId: 'resume', IsTop: value } }
        : { Code: 0, IsTop: value, Data: { JobId: 'job', ResumeId: 'resume' } })
      await env.page.selectConversation(env.page.conversations.find(item => item.id === 'a'))
      assert.equal(env.page.chatDetail.isPinned, expected)
      assert.equal(env.calls[1].Content.EnterpriseAccId, 'enterprise')
      assert.equal(env.calls[1].Content.PersonAccId, 'person-a')
    }
  }
  const fallback = environment({ stickTop: true })
  fallback.page.chatDetail = null
  fallback.request(async () => ({ Code: 0, Data: { JobId: 'job', ResumeId: 'resume' } }))
  await fallback.page.selectConversation(fallback.page.conversations.find(item => item.id === 'a'))
  assert.equal(fallback.page.chatDetail.isPinned, true)
  await fallback.panel.loadChatAccess()
  assert.equal(fallback.panel.isPinned, true)
  assert.equal(fallback.panelDef.watch['conversation.stickTop'], undefined)
  console.log('PASS: business pin state overrides stale SDK state; Data/root booleans, numbers and strings match mobile parsing')

  const env = environment(), saving = deferred(), syncing = deferred()
  env.request(() => saving.promise)
  env.stick(() => syncing.promise)
  const inFlight = env.panel.togglePinned()
  await env.panel.togglePinned()
  assert.equal(env.panel.isPinning, true)
  assert.equal(env.calls.length, 1)
  assert.equal(env.calls[0].Name, 'Chat.Chat.Save')
  assert.deepEqual(env.calls[0].Content, { PersonAccId: 'person-a', EnterpriseAccId: 'enterprise', IsTop: true })
  assert.equal(env.panel.isPinned, false)
  assert.equal(env.sticks.length, 0)
  saving.resolve({ Code: 0, Data: '{"Code":"0"}' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.panel.isPinned, true)
  assert.equal(env.page.chatDetail.isPinned, true)
  assert.equal(env.page.chatDetail.conversation.stickTop, true)
  assert.equal(env.page.conversations.map(item => item.id).join(','), 'a,b')
  assert.equal(env.page.rawConversations[1].unreadCount, 2)
  assert.equal(env.page.rawConversations[1].updateTime, 800)
  assert.deepEqual(env.sticks, [{ id: 'a', value: true }])
  assert.equal(env.toasts.length, 0)
  await env.panel.togglePinned()
  assert.equal(env.calls.length, 1)
  syncing.resolve(); await inFlight
  assert.equal(env.panel.isPinning, false)
  assert.equal(env.toasts[0], '会话已置顶')
  assert.equal(env.state.reloads, 1)

  env.request(async () => ({ Code: '0', Data: '' }))
  env.stick(async () => {})
  await env.panel.togglePinned()
  assert.equal(env.calls[1].Content.IsTop, false)
  assert.deepEqual(env.sticks[1], { id: 'a', value: false })
  assert.equal(env.panel.isPinned, false)
  assert.equal(env.page.chatDetail.isPinned, false)
  assert.equal(env.page.conversations.map(item => item.id).join(','), 'b,a')
  assert.equal(env.toasts[1], '已取消置顶')
  assert.deepEqual(env.panel.drafts, { a: 'a draft', b: 'b draft' })
  console.log('PASS: Save precedes SDK sync, clicks share a lock, pin/unpin updates list order and keeps unread counts, message times and drafts')

  for (const data of [undefined, null, '', '  ', {}, '{}', 'null', { Code: 0 }]) {
    const successful = environment()
    successful.request(async () => ({ Code: 0, Data: data }))
    await successful.panel.togglePinned()
    assert.equal(successful.panel.isPinned, true)
    assert.equal(successful.sticks.length, 1)
    assert.equal(successful.toasts[0], '会话已置顶')
  }
  const failures = [
    [null, /业务错误码/], [{}, /业务错误码/],
    [{ Code: '4400002' }, /置顶数量已达上限/],
    [{ Code: 0, Data: { Code: 4400002 } }, /置顶数量已达上限/],
    [{ Code: 0, Data: '{"Code":"4400002"}' }, /置顶数量已达上限/],
    [{ Code: 12 }, /业务错误码：12/], [{ Code: 0, Data: { Code: 13 } }, /数据错误码：13/],
    [{ Code: 0, Data: '{invalid' }, /数据格式不正确/],
    [{ Code: 0, Data: [] }, /数据格式不正确/], [{ Code: 0, Data: 'true' }, /数据格式不正确/]
  ]
  for (const [response, expected] of failures) {
    const failed = environment()
    failed.request(async () => response)
    await failed.panel.togglePinned()
    assert.equal(failed.panel.isPinned, false)
    assert.equal(failed.panel.isPinning, false)
    assert.equal(failed.sticks.length, 0)
    assert.equal(failed.events.length, 0)
    assert.equal(failed.page.conversations.map(item => item.id).join(','), 'b,a')
    assert.match(failed.toasts[0], expected)
  }
  const network = environment()
  network.request(async () => { throw new Error('network failed') })
  await network.panel.togglePinned()
  assert.equal(network.sticks.length, 0)
  assert.match(network.toasts[0], /network failed/)
  network.request(async () => ({ Code: 0 }))
  await network.panel.togglePinned()
  assert.equal(network.panel.isPinned, true)
  console.log('PASS: empty Save data succeeds; both pin-limit codes, invalid data and request errors keep prior state and allow retry')

  for (const failure of ['reject', 'missing-service', 'missing-method']) {
    const partial = environment()
    if (failure === 'reject') partial.stick(async () => { throw new Error('SDK failed') })
    if (failure === 'missing-service') delete partial.nim.V2NIMLocalConversationService
    if (failure === 'missing-method') partial.nim.V2NIMLocalConversationService = {}
    await partial.panel.togglePinned()
    assert.equal(partial.panel.isPinned, true)
    assert.equal(partial.page.chatDetail.isPinned, true)
    assert.equal(partial.page.conversations[0].id, 'a')
    assert.equal(partial.panel.isPinning, false)
    assert.equal(partial.state.reloads, 0)
    assert.equal(partial.toasts[0], '状态已保存，会话列表同步失败')
  }
  console.log('PASS: unavailable or failed SDK sync does not roll back saved business state and explicitly reports partial success')

  for (const flag of ['visible', '_alive', 'accessReady']) {
    const guarded = environment()
    guarded.panel[flag] = false
    await guarded.panel.togglePinned()
    assert.equal(guarded.calls.length, 0)
  }
  for (const flag of ['opening', 'isPinning']) {
    const guarded = environment()
    guarded.panel[flag] = true
    await guarded.panel.togglePinned()
    assert.equal(guarded.calls.length, 0)
  }
  for (const field of ['personAccId', 'enterpriseAccId']) {
    const missing = environment()
    missing.panel[field] = ''
    await missing.panel.togglePinned()
    assert.equal(missing.calls.length, 0)
    assert.match(missing.toasts[0], /会话账号/)
  }
  for (const missingId of [false, true]) {
    const unavailable = environment()
    if (missingId) unavailable.panel.detail.conversationId = ''
    else unavailable.state.loggedIn = false
    await unavailable.panel.togglePinned()
    assert.equal(unavailable.calls.length, 0)
    assert.equal(unavailable.toasts[0], '聊天服务尚未就绪')
  }
  console.log('PASS: hidden, destroyed, opening, busy, denied, missing-account and logged-out conversations cannot save pins')

  for (const phase of ['business', 'sdk']) {
    const abandoned = environment(), response = deferred()
    if (phase === 'business') abandoned.request(() => response.promise)
    else abandoned.stick(() => response.promise)
    const oldOperation = abandoned.panel.togglePinned()
    await new Promise(resolve => setImmediate(resolve))
    const eventCount = abandoned.events.length
    abandoned.panel._alive = false
    abandoned.page.chatDetail = { conversationId: 'b', isPinned: false }
    response.resolve(phase === 'business' ? { Code: 0 } : undefined)
    await oldOperation
    assert.deepEqual(abandoned.sticks, [{ id: 'a', value: true }])
    assert.equal(abandoned.events.length, eventCount)
    assert.equal(abandoned.toasts.length, 0)
    assert.equal(abandoned.page.chatDetail.isPinned, false)
  }
  const other = environment()
  other.page.chatDetail = { conversationId: 'b', isPinned: false }
  other.page.handleConversationPinChanged({ conversationId: 'a', isPinned: true })
  assert.equal(other.page.rawConversations[1].stickTop, true)
  assert.equal(other.page.chatDetail.isPinned, false)
  other.page._conversationPageAlive = false
  other.page.handleConversationPinChanged({ conversationId: 'a', isPinned: false })
  assert.equal(other.page.rawConversations[1].stickTop, true)
  console.log('PASS: late business/SDK completion syncs only the original conversation without changing another panel or showing stale toasts')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
