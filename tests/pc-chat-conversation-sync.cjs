// node tests/pc-chat-conversation-sync.cjs：模拟 SDK 同步和分页，不连接真实账号。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { EventEmitter } = require('events')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const nimSource = read('services/nim.js')
const conversationSource = read('services/conversation.js')
const pageSource = read('pages/ehr/pc/chat.vue')
const flush = () => new Promise(resolve => setImmediate(resolve))
const target = { conversationId: 'p2p-person-1', type: 1, name: '人才一' }
const complete = rows => ({ conversationList: rows, finished: true })

function loadService(source, globals, names) {
  const context = vm.createContext({ module: { exports: {} }, ...globals })
  vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')
    + `\nmodule.exports = { ${names.join(', ')} }`, context)
  return context.module.exports
}

function environment() {
  const state = { status: 0, account: '', requests: [], lookups: [], timers: new Map() }
  const bus = new EventEmitter()
  const login = new EventEmitter()
  const conversations = new EventEmitter()
  const messages = new EventEmitter()
  const status = value => { state.status = value; login.emit('onLoginStatus', value) }
  Object.assign(login, {
    getLoginStatus: () => state.status,
    getLoginUser: () => state.account,
    login: async account => { state.account = account; status(1) },
    logout: async () => status(0)
  })
  conversations.getConversationList = (offset, limit) => new Promise((resolve, reject) => {
    state.requests.push({ offset, limit, resolve, reject })
  })
  const sdk = {
    V2NIMLoginService: login,
    V2NIMLocalConversationService: conversations,
    V2NIMMessageService: messages,
    V2NIMConversationIdUtil: { parseConversationTargetId: id => id.slice(4) },
    destroy: async () => {}
  }
  const quietConsole = { log() {}, warn() {}, error() {} }
  const globals = {
    console: quietConsole,
    uni: {
      $on: (event, listener) => bus.on(event, listener),
      $off: (event, listener) => bus.off(event, listener),
      $emit: (event, payload) => bus.emit(event, payload)
    },
    requestApi: async () => ({ Code: 0, Data: { Sessions: [] } })
  }
  const nim = loadService(nimSource, { ...globals, NIM: { getInstance: () => sdk } }, [
    'NIM_EVENT', 'initNim', 'loginNim', 'logoutNim', 'destroyNim',
    'getNimInstance', 'getNimLoginError', 'isNimLoggedIn', 'isNimConversationSynced'
  ])
  nim.initNim()
  const service = loadService(conversationSource, { ...globals, ...nim }, [
    'getAllNimConversations', 'getAllHistoryConversations', 'normalizeAndSortConversations'
  ])
  function createPage() {
    const context = vm.createContext({
      module: { exports: {} }, ...globals, ...nim, ...service,
      PcChatPanel: {}, PcChatHistoryPanel: {},
      setTimeout: handler => { const id = {}; state.timers.set(id, handler); return id },
      clearTimeout: id => state.timers.delete(id),
      normalizeAndSortConversations: (...args) => {
        const rows = service.normalizeAndSortConversations(...args)
        // 观察真实查找时看到的数据，不依赖页面临时的 console.log / return。
        Object.defineProperty(rows, 'find', { value(predicate) {
          const found = Array.prototype.find.call(this, predicate)
          state.lookups.push({ rows: Array.from(this), found })
          return found
        } })
        return rows
      }
    })
    vm.runInContext(pageSource.match(/<script>([\s\S]*?)<\/script>/)[1]
      .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
      .replace('export default', 'module.exports ='), context)
    const definition = context.module.exports
    const page = definition.data()
    for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)
    for (const [name, getter] of Object.entries(definition.computed)) {
      Object.defineProperty(page, name, { get: getter.bind(page) })
    }
    definition.onLoad.call(page, { personAccId: 'person-1' })
    return {
      page,
      show: () => definition.onShow.call(page),
      hide: () => definition.onHide.call(page),
      unload: () => definition.onUnload.call(page)
    }
  }
  return {
    state, nim, login, conversations, messages, bus, status, createPage,
    loginAccount: () => nim.loginNim('enterprise-1', 'test-token'),
    runTimers: () => {
      const handlers = Array.from(state.timers.values())
      state.timers.clear()
      handlers.forEach(handler => handler())
    }
  }
}

async function verify() {
  // 刷新：登录和同步中的消息通知均不能提前读取列表、执行路由查找。
  const fresh = environment()
  const view = fresh.createPage()
  view.show()
  await fresh.loginAccount()
  assert.equal(fresh.nim.isNimConversationSynced(), false)
  fresh.conversations.emit('onSyncStarted')
  fresh.messages.emit('onReceiveMessages', [{ conversationId: target.conversationId }])
  fresh.runTimers()
  await flush()
  assert.equal(fresh.state.requests.length, 0)
  assert.equal(fresh.state.lookups.length, 0)

  // onSyncFinished 后还必须等待全部分页；目标会话在第二页。
  fresh.conversations.emit('onSyncFinished')
  assert.equal(fresh.state.requests.length, 1)
  assert.equal(fresh.state.lookups.length, 0)
  const pendingRoute = view.page._routeConversationPromise
  fresh.state.requests[0].resolve({ conversationList: [], finished: false, offset: 100 })
  await flush()
  assert.equal(fresh.state.requests[1].offset, 100)
  assert.equal(fresh.state.lookups.length, 0)
  fresh.state.requests[1].resolve(complete([target]))
  await pendingRoute
  assert.equal(fresh.state.lookups.length, 1)
  assert.equal(fresh.state.lookups[0].found.targetId, 'person-1')
  view.unload()
  assert.equal(fresh.bus.eventNames().length, 0)

  // 同步完成后才进入页面，也能通过单例状态正常加载。
  const late = fresh.createPage()
  late.show()
  fresh.state.requests[2].resolve(complete([target]))
  await late.page._routeConversationPromise
  assert.equal(fresh.state.lookups.length, 2)
  late.unload()

  // 同步失败不能误判为空列表；下一次同步成功后恢复。
  const failed = environment()
  const failedView = failed.createPage()
  failedView.show()
  await failed.loginAccount()
  failed.conversations.emit('onSyncFailed', new Error('同步失败'))
  await failedView.page.openRouteConversationAfterLoad()
  assert.equal(failedView.page.loadError, '同步失败')
  assert.equal(failed.state.requests.length, 0)
  assert.equal(failed.state.lookups.length, 0)
  failed.conversations.emit('onSyncStarted')
  failed.conversations.emit('onSyncFinished')
  failed.state.requests[0].reject(new Error('列表读取失败'))
  await failedView.page._routeConversationPromise
  assert.equal(failed.state.lookups.length, 0)
  failed.conversations.emit('onSyncFinished')
  failed.state.requests[1].resolve(complete([target]))
  await failedView.page._routeConversationPromise
  assert.equal(failedView.page.loadError, '')
  assert.equal(failed.state.lookups[0].found.targetId, 'person-1')
  failedView.unload()

  // 列表查询期间发生新一轮同步，必须等同步后的补查结束。
  const resync = environment()
  await resync.loginAccount()
  resync.conversations.emit('onSyncFinished')
  const resyncView = resync.createPage()
  resyncView.show()
  const resyncRoute = resyncView.page._routeConversationPromise
  resync.conversations.emit('onSyncStarted')
  assert.equal(resync.nim.isNimConversationSynced(), false)
  resync.conversations.emit('onSyncFinished')
  resync.state.requests[0].resolve(complete([]))
  await flush()
  assert.equal(resync.state.requests.length, 2)
  assert.equal(resync.state.lookups.length, 0)
  resync.state.requests[1].resolve(complete([target]))
  await resyncRoute
  assert.equal(resync.state.lookups[0].found.targetId, 'person-1')
  resyncView.unload()

  // 同步重新开始且尚未结束时，即使旧查询完成也不执行路由逻辑。
  const interrupted = environment()
  await interrupted.loginAccount()
  interrupted.conversations.emit('onSyncFinished')
  const interruptedView = interrupted.createPage()
  interruptedView.show()
  interrupted.conversations.emit('onSyncStarted')
  interrupted.state.requests[0].resolve(complete([]))
  await interruptedView.page._routeConversationPromise
  assert.equal(interrupted.state.lookups.length, 0)
  interrupted.conversations.emit('onSyncFinished')
  interrupted.state.requests[1].resolve(complete([target]))
  await interruptedView.page._routeConversationPromise
  assert.equal(interrupted.state.lookups[0].found.targetId, 'person-1')
  interruptedView.unload()

  // 页面隐藏/卸载后不执行查找，返回页面时重新读取完整列表。
  for (const action of ['hide', 'unload']) {
    const hidden = environment()
    await hidden.loginAccount()
    hidden.conversations.emit('onSyncFinished')
    const hiddenView = hidden.createPage()
    hiddenView.show()
    const route = hiddenView.page._routeConversationPromise
    hiddenView[action]()
    hidden.state.requests[0].resolve(complete([target]))
    await route
    assert.equal(hidden.state.lookups.length, 0)
    if (action === 'hide') {
      hiddenView.show()
      hidden.state.requests[1].resolve(complete([target]))
      await hiddenView.page._routeConversationPromise
      assert.equal(hidden.state.lookups.length, 1)
      hiddenView.unload()
    }
    assert.equal(hidden.bus.eventNames().length, 0)
  }

  // 同账号复用保留同步状态；切换账号、失败、退出及销毁均清除状态。
  const reset = environment()
  await reset.loginAccount()
  reset.conversations.emit('onSyncFinished')
  await reset.loginAccount()
  assert.equal(reset.nim.isNimConversationSynced(), true)
  await reset.nim.loginNim('enterprise-2', 'test-token')
  assert.equal(reset.nim.isNimConversationSynced(), false)
  reset.conversations.emit('onSyncFinished')
  reset.login.emit('onLoginFailed', new Error('登录失败'))
  assert.equal(reset.nim.isNimConversationSynced(), false)
  reset.conversations.emit('onSyncFinished')
  reset.status(2)
  assert.equal(reset.nim.isNimConversationSynced(), false)
  reset.status(1)
  assert.equal(reset.nim.isNimConversationSynced(), false)
  reset.conversations.emit('onSyncFinished')
  await reset.nim.logoutNim()
  assert.equal(reset.nim.isNimConversationSynced(), false)
  await reset.loginAccount()
  assert.equal(reset.nim.isNimConversationSynced(), false)
  reset.conversations.emit('onSyncFinished')
  await reset.nim.destroyNim()
  assert.equal(reset.nim.isNimConversationSynced(), false)

  console.log('pc chat conversation sync tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
