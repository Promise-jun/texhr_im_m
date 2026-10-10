// node tests/pc-chat-send.cjs：模拟所有消息类型的发送和黑名单回执，不向真实账号发送消息。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const source = fs.readFileSync(path.join(__dirname, '../components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'module.exports =')
const BLOCK_WARNING = '对方在您的黑名单中，无法回复您的消息'
const SEND_BLOCKED = '该人才已屏蔽您的消息，暂不能发送消息'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function environment(blocked = false) {
  const checks = [], sends = [], toasts = [], order = [], events = [], warnings = []
  const state = { blocked, loggedIn: true }
  let check = async accounts => ({ [accounts[0]]: state.blocked })
  let send = async (message, conversationId) => ({ message: { ...message, conversationId,
    messageClientId: `sent-${sends.length}`, createTime: sends.length, isSelf: true } })
  const nim = {
    V2NIMUserService: { checkBlock: accounts => {
      checks.push(Array.from(accounts)); order.push('check'); return check(accounts)
    } },
    V2NIMMessageCreator: { createTextMessage: text => ({ text, messageType: 0 }) },
    V2NIMMessageService: { sendMessage: (message, conversationId) => {
      sends.push({ message, conversationId }); order.push('send'); return send(message, conversationId)
    } }
  }
  const context = vm.createContext({ module: { exports: {} }, NIM_EMOJIS: [],
    getNimInstance: () => nim, isNimLoggedIn: () => state.loggedIn,
    console: { warn: (...args) => warnings.push(args) },
    uni: { showToast: value => { toasts.push(value); order.push('toast') } } })
  vm.runInContext(script, context)
  const def = context.module.exports
  const panel = { conversation: { name: '模拟人才' }, detail: { conversationId: 'a' },
    personAccId: 'talent-a', enterpriseAccId: 'enterprise', drafts: { a: '当前草稿', b: '其它草稿' },
    visible: true, opening: false, _alive: true,
    $set: (obj, key, value) => { obj[key] = value }, $emit: event => events.push(event),
    $nextTick: fn => Promise.resolve().then(fn) }
  Object.assign(panel, def.data.call(panel))
  for (const [name, method] of Object.entries(def.methods)) panel[name] = method.bind(panel)
  for (const [name, getter] of Object.entries(def.computed)) {
    Object.defineProperty(panel, name, typeof getter === 'function' ? { get: getter.bind(panel) }
      : { get: getter.get.bind(panel), set: getter.set.bind(panel) })
  }
  panel.accessReady = true
  panel.messages = [{ conversationId: 'a', messageClientId: 'history', text: '历史消息', createTime: 0 }]
  return { panel, nim, checks, sends, toasts, order, events, warnings, state,
    check: fn => { check = fn }, send: fn => { send = fn } }
}

async function verify() {
  // 覆盖现有输入入口，以及统一入口对图片、语音、视频、位置、文件和自定义消息的处理。
  for (const kind of ['text', 'emoji', 'phrase', 1, 2, 3, 4, 6, 100]) {
    const env = environment(true), { panel } = env
    panel.blockStatusLoaded = true; panel.isOtherBlocked = false // 菜单缓存不能替代本次查询。
    let content
    if (kind === 'text' || kind === 'emoji') {
      content = kind === 'text' ? '普通消息' : '您好[大笑]'
      panel.draft = content
      assert.equal(await panel.sendMessage(), true)
      assert.equal(panel.draft, '')
    } else if (kind === 'phrase') {
      content = '常用语[赞]'; panel.phrasesVisible = true
      await panel.sendCommonPhrase({ key: 'phrase', message: content })
      assert.equal(panel.phrasesVisible, false)
      assert.equal(panel.draft, '当前草稿')
    } else {
      content = { messageType: kind, attachment: { name: '模拟附件', url: 'mock://attachment' } }
      assert.equal(await panel.sendNimMessage(() => content), true)
      assert.strictEqual(env.sends[0].message, content)
      assert.equal(panel.draft, '当前草稿')
    }
    assert.deepEqual(env.checks, [['talent-a']])
    assert.deepEqual(env.order, ['check', 'toast', 'send'])
    assert.equal(env.toasts[0].title, BLOCK_WARNING)
    assert.equal(env.toasts[0].icon, 'none')
    assert.equal(env.sends.length, 1)
    assert.equal(env.sends[0].conversationId, 'a')
    if (typeof content === 'string') assert.equal(env.sends[0].message.text, content)
    assert.equal(panel.messages.length, 2)
    assert.equal(panel.drafts.b, '其它草稿')
    assert.equal(panel.isSending, false)
    assert.deepEqual(env.events, ['changed'])
  }
  console.log('PASS: all message types query the talent account before sending; own blacklist only warns and never blocks delivery')

  const refreshed = environment(), { panel } = refreshed
  panel.blockStatusLoaded = true; panel.isOtherBlocked = true
  await panel.sendTextMessage('未屏蔽')
  assert.equal(refreshed.toasts.length, 0)
  refreshed.state.blocked = true
  await panel.sendTextMessage('已屏蔽')
  refreshed.state.blocked = false
  await panel.sendTextMessage('取消屏蔽')
  assert.equal(refreshed.checks.length, 3)
  assert.equal(refreshed.sends.length, 3)
  assert.equal(refreshed.toasts.length, 1)
  console.log('PASS: each send refreshes remote state instead of relying on a stale menu cache')

  for (const kind of ['network', 'missingService', 'missingMethod', 'invalid']) {
    const env = environment(true)
    if (kind === 'network') env.check(async () => { throw { code: 102426, message: '查询失败' } })
    if (kind === 'missingService') delete env.nim.V2NIMUserService
    if (kind === 'missingMethod') delete env.nim.V2NIMUserService.checkBlock
    if (kind === 'invalid') env.check(async () => ({ 'talent-a': 'true' }))
    assert.equal(await env.panel.sendMessage(), true)
    assert.equal(env.sends.length, 1)
    assert.equal(env.toasts.length, 0)
    assert.equal(env.warnings.length, 1)
  }
  console.log('PASS: failed or unsupported blacklist queries continue sending, including query errors with code 102426')

  for (const messageType of [0, 1, 2, 3, 4, 6, 100]) {
    for (const code of [102426, '102426']) {
      const env = environment()
      env.send(async () => { throw { code, message: 'SDK 原始错误' } })
      assert.equal(await env.panel.sendNimMessage(() => ({ messageType })), false)
      assert.equal(env.toasts[0].title, SEND_BLOCKED)
      assert.equal(env.panel.messages.length, 1)
      assert.equal(env.panel.draft, '当前草稿')
      assert.equal(env.panel.isSending, false)
      assert.equal(env.events.length, 0)
    }
  }
  for (const error of [{ Code: '102426' }, { errCode: 102426 }, { errorCode: '102426' },
    { data: { code: 102426 } }, { data: { Code: '102426' } },
    { detail: { code: '102426' } }, { detail: { Code: 102426 } }]) {
    const env = environment()
    env.send(async () => { throw error })
    assert.equal(await env.panel.sendMessage(), false)
    assert.equal(env.toasts[0].title, SEND_BLOCKED)
    assert.equal(env.panel.draft, '当前草稿')
  }
  const receipt = environment()
  receipt.send(async () => ({ code: 102426 }))
  assert.equal(await receipt.panel.sendMessage(), false)
  assert.equal(receipt.toasts[0].title, SEND_BLOCKED)
  const phrase = environment(true)
  phrase.panel.phrasesVisible = true
  phrase.send(async () => { throw { code: 102426 } })
  await phrase.panel.sendCommonPhrase({ key: 'phrase', message: '测试常用语' })
  assert.deepEqual(phrase.toasts.map(item => item.title), [BLOCK_WARNING, SEND_BLOCKED])
  assert.equal(phrase.panel.phrasesVisible, true)
  assert.equal(phrase.panel.sendingPhraseKey, '')
  assert.equal(phrase.panel.draft, '当前草稿')
  console.log('PASS: numeric/string 102426 errors and failed receipts show the exact talent-blocked prompt for every message type and preserve failed content')

  for (const error of [new Error('普通网络错误'), { code: 102427 }, null]) {
    const env = environment()
    env.send(async () => { throw error })
    assert.equal(await env.panel.sendMessage(), false)
    assert.equal(env.toasts[0].title, error && error.message || '消息发送失败，请重试')
    assert.equal(env.panel.draft, '当前草稿')
    env.send(async (message, conversationId) => ({ message: { ...message, conversationId, messageClientId: 'retry' } }))
    assert.equal(await env.panel.sendMessage(), true)
    assert.equal(env.panel.draft, '')
    assert.equal(env.checks.length, 2)
  }
  console.log('PASS: other send errors retain their normal prompts and drafts; retry checks again and clears only successfully sent content')

  const pending = environment(true), query = deferred()
  pending.check(() => query.promise)
  const inFlight = pending.panel.sendMessage()
  assert.equal(pending.panel.isSending, true)
  await pending.panel.sendMessage()
  await pending.panel.sendCommonPhrase({ key: 'duplicate', message: '重复发送' })
  await pending.panel.sendNimMessage(() => ({ messageType: 1 }))
  assert.equal(pending.checks.length, 1)
  assert.equal(pending.sends.length, 0)
  pending.panel.draft = '发送期间新输入'
  query.resolve({ 'talent-a': true }); await inFlight
  assert.equal(pending.sends.length, 1)
  assert.equal(pending.sends[0].message.text, '当前草稿')
  assert.equal(pending.panel.draft, '发送期间新输入')
  assert.equal(pending.panel.isSending, false)
  console.log('PASS: the send lock also covers the blacklist query and preserves new input while querying')

  for (const kind of ['destroyed', 'hidden', 'opening', 'denied', 'switched', 'conversationChanged', 'loggedOut']) {
    const env = environment(true), result = deferred()
    env.check(() => result.promise)
    const task = env.panel.sendMessage()
    if (kind === 'destroyed') env.panel._alive = false
    if (kind === 'hidden') env.panel.visible = false
    if (kind === 'opening') env.panel.opening = true
    if (kind === 'denied') env.panel.accessReady = false
    if (kind === 'switched') env.panel.personAccId = 'talent-b'
    if (kind === 'conversationChanged') env.panel.detail = { conversationId: 'b' }
    if (kind === 'loggedOut') env.state.loggedIn = false
    result.resolve({ 'talent-a': true })
    assert.equal(await task, false)
    assert.equal(env.sends.length, 0)
    assert.equal(env.panel.drafts.a, '当前草稿')
    assert.equal(env.toasts.some(item => item.title === BLOCK_WARNING), false)
    if (kind !== 'destroyed') assert.equal(env.panel.isSending, false)
  }
  console.log('PASS: conversations closed or changed during a query cannot send late messages or show stale blacklist warnings')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
