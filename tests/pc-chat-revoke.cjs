// node tests/pc-chat-revoke.cjs：云信撤回接口为内存模拟，不会操作真实聊天消息。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const panelSource = fs.readFileSync(path.join(root, 'components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function loadComponent(globals) {
  const context = vm.createContext({ module: { exports: {} }, ...globals })
  const script = panelSource.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports =')
  vm.runInContext(script, context)
  return context.module.exports
}

function createEnvironment() {
  const revoked = [], toasts = [], modals = [], events = [], logs = []
  let revoke = async message => { revoked.push(message) }
  const nim = { V2NIMMessageService: { revokeMessage: message => revoke(message) } }
  const globals = {
    NIM_EVENT: {}, NIM_EMOJIS: [],
    getNimInstance: () => nim,
    isNimLoggedIn: () => true,
    formatConversationTime: value => String(value),
    getAudioMimeType: () => '',
    audioDurationSeconds: () => 0,
    audioBubbleWidth: () => '120px',
    createPcAudioPlayer: () => ({}),
    parseNimEmojiText: content => [{ type: 'text', content }],
    markNimConversationRead: async () => {},
    requestApi: async () => ({ Code: 0, Data: {} }),
    window: { innerWidth: 800, innerHeight: 600 },
    console: { error: (...args) => logs.push(args), warn() {}, log() {} },
    uni: {
      showModal: options => modals.push(options),
      showToast: options => toasts.push(options.title)
    }
  }
  const def = loadComponent(globals)
  const base = {
    conversation: { stickTop: false },
    detail: { conversationId: 'conversation-a', jobName: '' },
    jobId: 'job', resumeId: 'resume', personAccId: 'person', enterpriseAccId: 'enterprise',
    drafts: {}, visible: true, opening: false, _alive: true,
    $set: (target, key, value) => { target[key] = value },
    $emit: (event, payload) => events.push({ event, payload }),
    $nextTick: callback => callback()
  }
  Object.assign(base, def.data.call(base))
  for (const [name, method] of Object.entries(def.methods)) base[name] = method.bind(base)
  for (const [name, getter] of Object.entries(def.computed)) {
    Object.defineProperty(base, name, typeof getter === 'function'
      ? { get: getter.bind(base) }
      : { get: getter.get.bind(base), set: getter.set.bind(base) })
  }
  base.accessReady = true
  return { panel: base, nim, revoked, toasts, modals, events, logs,
    revoke: fn => { revoke = fn } }
}

function contextEvent(x, y) {
  const state = { prevented: 0, stopped: 0 }
  return {
    clientX: x, clientY: y,
    preventDefault: () => { state.prevented++ },
    stopPropagation: () => { state.stopped++ },
    state
  }
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve))
}

async function verify() {
  // 模板事件修饰符会在业务判断前阻止浏览器原生右键菜单。
  assert.match(panelSource, /@contextmenu\.prevent\.stop="openMessageContextMenu\(\$event, message\)"/)
  assert.match(panelSource, /@scroll="closeMessageContextMenu"/)
  assert.match(panelSource, /PC 端仅为自己发送、尚未撤回的消息显示右键菜单/)

  const env = createEnvironment()
  const ownMessage = {
    conversationId: 'conversation-a', messageClientId: 'own-1', senderId: 'enterprise',
    isSelf: true, createTime: 100, messageType: 0, text: '待撤回消息'
  }
  const otherMessage = {
    conversationId: 'conversation-a', messageClientId: 'other-1', senderId: 'person',
    isSelf: false, createTime: 101, messageType: 0, text: '收到的消息'
  }
  env.panel.messages = [ownMessage, otherMessage]

  const otherEvent = contextEvent(20, 30)
  env.panel.openMessageContextMenu(otherEvent, { id: 'other-1', direction: 'other' })
  assert.equal(env.panel.messageContextMenu.visible, false)
  assert.deepEqual(otherEvent.state, { prevented: 0, stopped: 0 })

  const ownEvent = contextEvent(790, 590)
  env.panel.openMessageContextMenu(ownEvent, { id: 'own-1', direction: 'self' })
  assert.equal(env.panel.messageContextMenu.visible, true)
  assert.equal(env.panel.messageContextMenu.messageId, 'own-1')
  assert.equal(env.panel.messageContextMenu.left, 696)
  assert.equal(env.panel.messageContextMenu.top, 552)
  assert.deepEqual(ownEvent.state, { prevented: 1, stopped: 1 })

  const pending = deferred()
  env.revoke(async message => { env.revoked.push(message); return pending.promise })
  env.panel.confirmRevokeMessage()
  assert.equal(env.panel.messageContextMenu.visible, false)
  assert.equal(env.modals.length, 1)
  assert.equal(env.modals[0].title, '撤回消息')
  env.modals[0].success({ confirm: true })
  await flush()
  assert.equal(env.panel.messageActionId, 'own-1')
  assert.strictEqual(env.revoked[0], ownMessage)

  await env.panel.revokeMessage(ownMessage)
  assert.equal(env.revoked.length, 1)
  pending.resolve()
  await flush()
  assert.equal(env.panel.messageActionId, '')
  assert.equal(env.panel.messages[0].isRevoked, true)
  assert.equal(env.panel.messages[0].revokedText, '待撤回消息')
  assert.equal(env.panel.displayMessages.find(item => item.id === 'own-1').content, '你撤回了一条消息')
  assert.equal(env.toasts[0], '消息已撤回')
  assert.equal(env.events[0].event, 'changed')
  console.log('PASS: only self messages open the clamped PC context menu; confirmation calls SDK once and updates the message locally')

  const cancelled = createEnvironment()
  cancelled.panel.messages = [ownMessage]
  cancelled.panel.openMessageContextMenu(contextEvent(100, 100), { id: 'own-1', direction: 'self' })
  cancelled.panel.confirmRevokeMessage()
  cancelled.modals[0].success({ confirm: false })
  await flush()
  assert.equal(cancelled.revoked.length, 0)

  const stale = createEnvironment()
  await stale.panel.revokeMessage({ ...ownMessage, conversationId: 'conversation-b' })
  assert.equal(stale.revoked.length, 0)

  const expired = createEnvironment()
  expired.panel.messages = [ownMessage]
  expired.revoke(async () => { throw { data: { Code: 107314 }, message: 'SDK error' } })
  await expired.panel.revokeMessage(ownMessage)
  assert.equal(expired.panel.messages[0].isRevoked, undefined)
  assert.equal(expired.toasts[0], '发送时间超过2分钟的消息，不能被撤回')
  assert.equal(expired.panel.messageActionId, '')

  const unsupported = createEnvironment()
  unsupported.panel.messages = [ownMessage]
  unsupported.nim.V2NIMMessageService = {}
  await unsupported.panel.revokeMessage(ownMessage)
  assert.equal(unsupported.toasts[0], '当前聊天服务不支持撤回消息')
  console.log('PASS: cancel, two-minute expiry, unsupported SDK and retry locks preserve the original message and report the expected result')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
