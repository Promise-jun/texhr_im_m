// node tests/pc-conversation-history.cjs：内存模拟接口和云信，不请求真实账号。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const pageSource = fs.readFileSync(path.join(root, 'pages/ehr/pc/chat.vue'), 'utf8')
const serviceSource = fs.readFileSync(path.join(root, 'services/conversation.js'), 'utf8')
const sessions = [
  { Accid: 'person-1', Name: '旧昵称' },
  { Accid: 'person-2', Name: '人才二', ShowTime: '昨天 10:00' },
  { Accid: 'person-1', Name: '人才一', Icon: '/avatar.png', LastMsg: '你好', ShowTime: '09:30' }
]

function environment() {
  const calls = [], listeners = new Map()
  const state = { loggedIn: true, loginError: null, sdkReloads: 0 }
  let request = async () => ({ Code: 0, Data: { Sessions: sessions } })
  const globals = {
    module: { exports: {} }, console: { error() {}, warn() {} }, setTimeout, clearTimeout,
    PcChatPanel: {}, PcChatHistoryPanel: {},
    NIM_EVENT: Object.fromEntries(['LOGIN_STATUS', 'LOGIN_FAILED', 'CONVERSATION_SYNC_STARTED',
      'CONVERSATION_SYNC_FINISHED', 'CONVERSATION_SYNC_FAILED', 'CONVERSATION_CREATED',
      'CONVERSATION_CHANGED', 'CONVERSATION_DELETED', 'TOTAL_UNREAD_COUNT_CHANGED',
      'MESSAGE_RECEIVED'].map(name => [name, name])),
    isNimLoggedIn: () => state.loggedIn,
    getNimLoginError: () => state.loginError,
    getNimInstance: () => ({
      V2NIMLoginService: { getLoginUser: () => 'enterprise-1' },
      V2NIMConversationIdUtil: {
        p2pConversationId: id => `p2p-${id}`, parseConversationTargetId: id => id.slice(4)
      },
      V2NIMLocalConversationService: { getConversationList: async () => {
        state.sdkReloads++
        return { conversationList: [{ conversationId: 'p2p-recent', type: 1, name: '最近人才', unreadCount: 3 }],
          finished: true }
      } }
    }),
    requestApi: args => { calls.push(args); return request(args) },
    uni: {
      $on: (event, listener) => listeners.set(event, listener),
      $off: (event, listener) => {
        if (listeners.get(event) === listener) listeners.delete(event)
      }
    }
  }
  const serviceContext = vm.createContext({ ...globals })
  vm.runInContext(serviceSource.replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), serviceContext)
  for (const name of ['getAllHistoryConversations', 'getAllNimConversations', 'normalizeAndSortConversations']) {
    globals[name] = serviceContext[name]
  }
  const context = vm.createContext(globals)
  vm.runInContext(pageSource.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports ='), context)
  const definition = context.module.exports, page = definition.data()
  for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)
  for (const [name, getter] of Object.entries(definition.computed)) {
    Object.defineProperty(page, name, { get: getter.bind(page) })
  }
  // 不保留登录通知的延时任务；onShow 仍通过真实 service 读取模拟 SDK。
  page.scheduleConversationReload = () => {}
  definition.onLoad.call(page)
  const enter = () => definition.onShow.call(page)
  const unload = () => definition.onUnload.call(page)
  return { calls, state, page, listeners, enter, unload,
    emit: (event, payload) => listeners.get(event)?.(payload),
    request: handler => { request = handler } }
}

async function verify() {
  // 进入默认的最近页签也预加载历史列表，并使用企业云信账号。
  const env = environment()
  let resolveRequest
  env.request(() => new Promise(resolve => { resolveRequest = resolve }))
  env.enter()
  env.emit('LOGIN_STATUS', 1)
  env.enter()
  assert.equal(env.calls.length, 1)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(env.calls[0])), {
    Name: 'Chat.Chat.GetAllSessions', Content: { accid: 'enterprise-1' }
  })
  env.page.switchMainTab('history')
  assert.equal(env.page.visibleIsLoading, true)
  resolveRequest({ Code: 0, Data: JSON.stringify({ Code: 0, Sessions: sessions }) })
  await env.page.loadHistoryConversations()
  assert.equal(env.page.visibleIsLoading, false)
  assert.equal(env.page.visibleConversations.length, 2)
  const first = env.page.visibleConversations[0]
  assert.equal(first.targetId, 'person-1')
  assert.equal(first.name, '人才一')
  assert.equal(first.avatar, '/avatar.png')
  assert.equal(first.message, '你好')
  assert.equal(first.time, '09:30')
  assert.equal(env.page.visibleConversations[1].time, '昨天 10:00')
  // 历史列表不受最近会话的未读筛选、同步失败及实时通知影响。
  env.page.activeMessageTab = 'unread'
  env.emit('CONVERSATION_SYNC_FAILED', new Error('SDK 同步失败'))
  assert.equal(env.page.visibleLoadError, '')
  assert.equal(env.page.visibleConversations.length, 2)
  env.enter()
  env.emit('LOGIN_STATUS', 1)
  await env.page.loadHistoryConversations()
  assert.equal(env.calls.length, 1)
  assert.ok(env.state.sdkReloads > 1)
  env.page.switchMainTab('recent')
  assert.equal(env.page.visibleConversations[0].name, '最近人才')
  assert.equal(env.page.unreadTotal, 3)
  env.unload()
  assert.equal(env.listeners.size, 0)

  // 登录未完成时等待；登录失败停止加载，恢复登录后请求。
  const delayed = environment()
  delayed.state.loggedIn = false
  delayed.enter()
  assert.equal(delayed.calls.length, 0)
  delayed.page.switchMainTab('history')
  assert.equal(delayed.page.visibleIsLoading, true)
  delayed.emit('LOGIN_FAILED', new Error('登录失败'))
  assert.equal(delayed.page.visibleIsLoading, false)
  assert.equal(delayed.page.visibleLoadError, '登录失败')
  delayed.state.loggedIn = true
  delayed.emit('LOGIN_STATUS', 1)
  await delayed.page.loadHistoryConversations()
  assert.equal(delayed.calls.length, 1)
  assert.equal(delayed.page.visibleLoadError, '')
  delayed.unload()

  // 网络或业务失败保留点击重试；重试成功为空也不会反复请求。
  for (const response of [new Error('网络异常'), { Code: 9000002 },
    { Code: 0, Data: { Code: 1 } }, { Code: 0, Data: 'invalid json' }]) {
    const failed = environment()
    failed.request(async () => {
      if (response instanceof Error) throw response
      return response
    })
    failed.enter()
    await failed.page.loadHistoryConversations()
    failed.page.switchMainTab('history')
    assert.ok(failed.page.visibleLoadError)
    assert.equal(failed.page.visibleIsLoading, false)
    failed.request(async () => ({ Code: 0, Data: { Sessions: [] } }))
    await failed.page.retryVisibleConversations()
    assert.equal(failed.calls.length, 2)
    assert.equal(failed.page.visibleLoadError, '')
    assert.equal(failed.page.visibleConversations.length, 0)
    failed.enter()
    failed.emit('LOGIN_STATUS', 1)
    await failed.page.loadHistoryConversations()
    assert.equal(failed.calls.length, 2)
    failed.unload()
  }

  // 卸载时解绑事件，并忽略在途响应。
  const unloaded = environment()
  let resolveUnloaded
  unloaded.request(() => new Promise(resolve => { resolveUnloaded = resolve }))
  unloaded.enter()
  const pending = unloaded.page.loadHistoryConversations()
  unloaded.unload()
  resolveUnloaded({ Code: 0, Data: { Sessions: sessions } })
  await pending
  assert.equal(unloaded.page.historyConversations.length, 0)
  assert.equal(unloaded.listeners.size, 0)
  console.log('pc conversation history tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
