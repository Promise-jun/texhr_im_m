// node tests/pc-chat-block.cjs：使用内存黑名单验证 PC 交互，不修改真实账号的屏蔽状态。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const source = fs.readFileSync(path.join(__dirname, '../components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'module.exports =')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function environment(initialBlocked = false) {
  const calls = [], toasts = [], events = []
  const state = { loggedIn: true, blocked: initialBlocked }
  let check = async accounts => ({ [accounts[0]]: state.blocked })
  let write = async (method, account) => { state.blocked = method === 'add' }
  const nim = { V2NIMUserService: {
    checkBlock: accounts => { calls.push({ method: 'check', accounts: Array.from(accounts) }); return check(accounts) },
    addUserToBlockList: account => { calls.push({ method: 'add', account }); return write('add', account) },
    removeUserFromBlockList: account => { calls.push({ method: 'remove', account }); return write('remove', account) }
  } }
  const context = vm.createContext({ module: { exports: {} }, console: { warn() {} }, NIM_EMOJIS: [],
    getNimInstance: () => nim, isNimLoggedIn: () => state.loggedIn,
    uni: { showToast: value => toasts.push(value) },
    requestApi: () => { throw new Error('屏蔽不应调用业务置顶或保存接口') } })
  vm.runInContext(script, context)
  const def = context.module.exports
  const panel = { conversation: { name: '模拟人才', stickTop: false }, detail: { conversationId: 'a' },
    personAccId: 'person-a', enterpriseAccId: 'enterprise', jobId: 'job', resumeId: 'resume',
    drafts: { a: '保留当前草稿', b: '保留其它会话草稿' }, visible: true, opening: false, _alive: true,
    $emit: (event, payload) => events.push({ event, payload }) }
  Object.assign(panel, def.data.call(panel))
  for (const [name, method] of Object.entries(def.methods)) panel[name] = method.bind(panel)
  for (const [name, getter] of Object.entries(def.computed)) {
    Object.defineProperty(panel, name, typeof getter === 'function' ? { get: getter.bind(panel) }
      : { get: getter.get.bind(panel), set: getter.set.bind(panel) })
  }
  panel.accessReady = true
  return { panel, def, nim, calls, toasts, events, state,
    check: fn => { check = fn }, write: fn => { write = fn } }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

async function verify() {
  const env = environment(), { panel } = env
  panel.messages = [{ conversationId: 'a', messageClientId: 'history', text: '保留聊天记录' }]
  panel.emojiVisible = true
  panel.openMoreMenu()
  assert.equal(panel.blockActionLabel, '查询中...')
  assert.equal(panel.moreMenuVisible, true)
  assert.equal(panel.emojiVisible, false)
  panel.openMoreMenu() // 同一次悬停触发点击/焦点事件不会重复查询。
  await flush()
  assert.deepEqual(env.calls, [{ method: 'check', accounts: ['person-a'] }])
  assert.equal(panel.blockActionLabel, '屏蔽TA')
  await panel.selectMoreAction('block')
  assert.deepEqual(env.calls[1], { method: 'add', account: 'person-a' })
  assert.equal(env.state.blocked, true)
  assert.equal(panel.blockActionLabel, '取消屏蔽')
  assert.equal(panel.moreMenuVisible, false)
  assert.equal(env.toasts[0].title, '屏蔽成功')
  assert.equal(env.toasts[0].icon, 'success')
  panel.openMoreMenu(); await flush()
  await panel.selectMoreAction('block')
  assert.deepEqual(env.calls[3], { method: 'remove', account: 'person-a' })
  assert.equal(env.state.blocked, false)
  assert.equal(panel.blockActionLabel, '屏蔽TA')
  assert.equal(env.toasts[1].title, '取消屏蔽成功')
  assert.deepEqual(panel.drafts, { a: '保留当前草稿', b: '保留其它会话草稿' })
  assert.equal(panel.messages[0].text, '保留聊天记录')
  assert.equal(env.events.length, 0)
  console.log('PASS: menu queries the talent account, block/unblock persists via SDK, labels refresh, and messages/drafts are preserved')

  env.state.blocked = true // 模拟其它客户端更新同一企业的黑名单。
  panel.openMoreMenu(); await flush()
  assert.equal(panel.blockActionLabel, '取消屏蔽')
  panel.selectMoreAction('report', '举报')
  assert.equal(env.events[0].payload.key, 'report')
  assert.equal(env.events[0].payload.personAccId, 'person-a')
  assert.equal(panel.moreMenuVisible, false)
  console.log('PASS: reopening refreshes external blacklist changes and report still uses its original action event')

  const loading = environment(), response = deferred()
  loading.check(() => response.promise)
  loading.panel.openMoreMenu()
  loading.panel.closeComposerPanels(); loading.panel.openMoreMenu()
  await loading.panel.selectMoreAction('block')
  assert.equal(loading.calls.length, 1)
  loading.panel.closeComposerPanels()
  response.resolve({ 'person-a': true }); await flush()
  assert.equal(loading.panel.isCheckingBlockStatus, false)
  assert.equal(loading.panel.blockActionLabel, '取消屏蔽')
  assert.equal(loading.panel.moreMenuVisible, false)
  console.log('PASS: an in-flight query is shared, blocks writes, and cannot reopen a dismissed menu')

  for (const response of [null, {}, { other: true }, { 'person-a': 'true' }]) {
    const invalid = environment()
    invalid.check(async () => response)
    assert.equal(await invalid.panel.loadBlockStatus(), false)
    assert.equal(invalid.panel.blockStatusLoaded, false)
    assert.equal(invalid.panel.blockActionLabel, '重试查询')
    assert.ok(invalid.panel.blockStatusError)
    await invalid.panel.selectMoreAction('block')
    assert.equal(invalid.calls.some(call => call.method !== 'check'), false)
  }
  const retry = environment(true)
  retry.check(async () => { throw new Error('模拟查询失败') })
  await retry.panel.loadBlockStatus()
  assert.equal(retry.panel.blockStatusError, '模拟查询失败')
  retry.check(async () => ({ 'person-a': true }))
  await retry.panel.selectMoreAction('block')
  assert.equal(retry.calls.filter(call => call.method !== 'check').length, 0)
  assert.equal(retry.panel.blockActionLabel, '取消屏蔽')
  assert.equal(retry.panel.blockStatusError, '')
  await retry.panel.selectMoreAction('block')
  assert.equal(retry.calls[retry.calls.length - 1].method, 'remove')
  console.log('PASS: invalid/network responses expose retry; retry only queries and never guesses a blacklist write')

  for (const initialBlocked of [false, true]) {
    const pending = environment(initialBlocked), write = deferred()
    await pending.panel.loadBlockStatus()
    pending.panel.moreMenuVisible = true
    pending.write(() => write.promise)
    const save = pending.panel.selectMoreAction('block')
    assert.equal(pending.panel.blockActionLabel, '处理中...')
    assert.equal(pending.panel.isOtherBlocked, initialBlocked)
    await pending.panel.selectMoreAction('block')
    await pending.panel.loadBlockStatus()
    assert.equal(pending.calls.length, 2)
    write.reject(new Error('模拟保存失败')); await save
    assert.equal(pending.panel.isOtherBlocked, initialBlocked)
    assert.equal(pending.panel.isUpdatingBlockStatus, false)
    assert.equal(pending.panel.moreMenuVisible, true)
    assert.equal(pending.toasts[0].title, '模拟保存失败')
    pending.write(async () => {})
    await pending.panel.selectMoreAction('block')
    assert.equal(pending.panel.isOtherBlocked, !initialBlocked)
  }
  console.log('PASS: pending writes prevent double submission and query races; failed block/unblock retains state and can be retried')

  for (const flag of ['_alive', 'visible', 'accessReady', 'opening', 'isCheckingBlockStatus', 'isUpdatingBlockStatus']) {
    const guarded = environment()
    guarded.panel.blockStatusLoaded = true
    guarded.panel[flag] = ['_alive', 'visible', 'accessReady'].includes(flag) ? false : true
    await guarded.panel.selectMoreAction('block')
    assert.equal(guarded.calls.length, 0)
  }
  for (const kind of ['loggedOut', 'missingAccount', 'missingService', 'missingCheck', 'missingWrite']) {
    const unsupported = environment()
    if (kind === 'loggedOut') unsupported.state.loggedIn = false
    if (kind === 'missingAccount') unsupported.panel.personAccId = ''
    if (kind === 'missingService') delete unsupported.nim.V2NIMUserService
    if (kind === 'missingCheck') delete unsupported.nim.V2NIMUserService.checkBlock
    if (kind === 'missingWrite') {
      await unsupported.panel.loadBlockStatus()
      delete unsupported.nim.V2NIMUserService.addUserToBlockList
    } else {
      assert.equal(await unsupported.panel.loadBlockStatus(), false)
    }
    await unsupported.panel.selectMoreAction('block')
    assert.equal(unsupported.calls.some(call => call.method !== 'check'), false)
    assert.equal(unsupported.panel.isCheckingBlockStatus, false)
    assert.equal(unsupported.panel.isUpdatingBlockStatus, false)
  }
  console.log('PASS: hidden, destroyed, opening, denied, busy, logged-out, missing-account and unsupported SDK actions do not write')

  for (const phase of ['query', 'write']) {
    for (const kind of ['destroyed', 'switched', 'loggedOut', 'hidden']) {
      const stale = environment(), result = deferred()
      if (phase === 'write') await stale.panel.loadBlockStatus()
      stale.check(() => result.promise); stale.write(() => result.promise)
      const task = phase === 'query' ? stale.panel.loadBlockStatus() : stale.panel.selectMoreAction('block')
      if (kind === 'destroyed') stale.panel._alive = false
      if (kind === 'switched') stale.panel.personAccId = 'person-b'
      if (kind === 'loggedOut') {
        stale.state.loggedIn = false
        stale.panel.releaseCurrentConversation = () => {}
        stale.panel.handleLoginStatus(0)
      }
      if (kind === 'hidden') stale.panel.visible = false
      result.resolve(phase === 'query' ? { 'person-a': true } : undefined); await task
      if (kind !== 'hidden') assert.equal(stale.panel.isOtherBlocked, false)
      assert.equal(stale.toasts.length, 0)
    }
  }
  console.log('PASS: late query/write receipts cannot affect a new or destroyed conversation or show stale toasts')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
