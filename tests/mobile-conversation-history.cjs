// node tests/mobile-conversation-history.cjs：接口和云信均为内存模拟，不请求真实账号。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const serviceSource = fs.readFileSync(path.join(root, 'services/conversation.js'), 'utf8')
const pageSource = fs.readFileSync(path.join(root, 'pages/person/m/list.vue'), 'utf8')
const sessions = [
  { Accid: 'enterprise-1', Name: '旧名称', LastMsg: '旧消息' },
  { Accid: 'enterprise-2', Name: '企业二', ShowTime: '昨天 10:00' },
  { Accid: 'enterprise-1', Name: '企业一', LastMsg: '最新消息' },
  { Accid: '' },
  null
]

function environment() {
  const calls = []
  const listeners = new Map()
  const state = { loggedIn: true, accountId: 'person-1', loginError: null, sdkReloads: 0 }
  let request = async () => ({ Code: 0, Data: { Sessions: sessions } })
  const globals = {
    module: { exports: {} },
    console: { error() {}, warn() {} },
    setTimeout,
    clearTimeout,
    NIM_EVENT: {
      LOGIN_STATUS: 'login-status', LOGIN_FAILED: 'login-failed',
      CONVERSATION_SYNC_FINISHED: 'sync-finished', CONVERSATION_SYNC_FAILED: 'sync-failed',
      CONVERSATION_CREATED: 'created', CONVERSATION_CHANGED: 'changed',
      CONVERSATION_DELETED: 'deleted', MESSAGE_RECEIVED: 'message-received'
    },
    getActiveConversationId: () => '',
    getNimLoginError: () => state.loginError,
    isNimLoggedIn: () => state.loggedIn,
    getExternalReturnUrl: options => String(options && options.returnUrl || '').trim(),
    appendExternalReturnUrl: (url, externalReturnUrl) => externalReturnUrl ?
      `${url}${url.includes('?') ? '&' : '?'}returnUrl=${encodeURIComponent(externalReturnUrl)}` : url,
    navigateBackWithExternal: (externalReturnUrl, fallbackUrl = '') => {
      if (externalReturnUrl) return true
      if (fallbackUrl) return true
      return false
    },
    getNimInstance: () => ({
      V2NIMLoginService: { getLoginUser: () => state.accountId },
      V2NIMConversationIdUtil: { p2pConversationId: id => `p2p-${id}` },
      V2NIMLocalConversationService: {
        getConversationList: async () => {
          state.sdkReloads++
          return { conversationList: [], finished: true }
        }
      }
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
  for (const name of ['getHistoryConversationsPage', 'getAllNimConversations',
    'markNimConversationRead', 'normalizeAndSortConversations']) {
    globals[name] = serviceContext[name]
  }
  const pageContext = vm.createContext(globals)
  const script = pageSource.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports =')
  vm.runInContext(script, pageContext)
  const definition = pageContext.module.exports
  const page = definition.data()
  for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)
  // 登录通知的 SDK 定时刷新与历史接口无关，避免测试留下后台定时器。
  page.scheduleConversationReload = () => {}
  return {
    calls, state, page, definition,
    getHistory: globals.getHistoryConversationsPage,
    request: handler => { request = handler },
    emit: (event, payload) => listeners.get(event)?.(payload)
  }
}

async function enter(env) {
  await env.definition.onLoad.call(env.page)
  env.definition.onShow.call(env.page)
}

async function verify() {
  const env = environment()
  await enter(env)
  env.emit('login-status', 1)
  assert.equal(env.calls.length, 0, '进入页面和登录事件不请求历史会话')
  await env.page.switchTab('history')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(env.calls[0])), {
    Name: 'Chat.Chat.GetAllSessions', Content: { accid: 'person-1', start: 1 }
  })
  assert.equal(env.page.historyConversations.length, 2)
  assert.equal(env.page.historyConversations[0].name, '企业一')
  assert.equal(env.page.historyPage, 1)
  env.request(async ({ Content }) => ({ Code: 0, Data: { Sessions: Content.start === 2 ?
    [{ Accid: 'enterprise-2' }, { Accid: 'enterprise-3' }] : [] } }))
  await env.definition.onReachBottom.call(env.page)
  // 生命周期不返回 Promise，等待当前请求完成。
  if (env.page._historyConversationLoadMorePromise) await env.page._historyConversationLoadMorePromise
  assert.equal(env.page.historyPage, 2)
  assert.equal(env.page.historyConversations.length, 3)
  await env.page.loadMoreHistoryConversations()
  assert.equal(env.page.hasMoreHistoryConversations, false)
  assert.deepStrictEqual(env.calls.map(call => call.Content.start), [1, 2, 3])
  await env.page.loadMoreHistoryConversations()
  assert.equal(env.calls.length, 3)

  const refresh = environment()
  const pending = []
  refresh.request(({ Content }) => new Promise(resolve => pending.push({ start: Content.start, resolve })))
  await enter(refresh)
  const first = refresh.page.switchTab('history')
  const second = refresh.page.switchTab('history')
  assert.deepStrictEqual(pending.map(item => item.start), [1, 1])
  pending[1].resolve({ Code: 0, Data: { Sessions: [{ Accid: 'new' }] } })
  await second
  pending[0].resolve({ Code: 0, Data: { Sessions: [{ Accid: 'old' }] } })
  await first
  assert.equal(refresh.page.historyConversations[0].targetId, 'new')
  const oldPage = refresh.page.loadMoreHistoryConversations()
  refresh.page.switchTab('recent')
  const newest = refresh.page.switchTab('history')
  pending[3].resolve({ Code: 0, Data: { Sessions: [{ Accid: 'latest' }] } })
  await newest
  pending[2].resolve({ Code: 0, Data: { Sessions: [{ Accid: 'stale' }] } })
  await oldPage
  assert.equal(refresh.page.historyConversations.length, 1)
  assert.equal(refresh.page.historyConversations[0].targetId, 'latest')
  assert.equal(refresh.page.historyPage, 1)

  const delayed = environment()
  delayed.state.loggedIn = false
  await enter(delayed)
  delayed.page.switchTab('history')
  assert.equal(delayed.calls.length, 0)
  assert.equal(delayed.page.isHistoryLoading, true)
  delayed.state.loggedIn = true
  delayed.emit('login-status', 1)
  await delayed.page.loadHistoryConversations()
  assert.equal(delayed.calls.length, 1)

  const retry = environment()
  await enter(retry)
  retry.request(async () => { throw new Error('网络异常') })
  await retry.page.switchTab('history')
  assert.equal(retry.page.historyLoadError, '网络异常')
  retry.request(async () => ({ Code: 0, Data: { Sessions: sessions } }))
  await retry.page.retryVisibleConversations()
  assert.equal(retry.page.historyLoadError, '')
  retry.request(async () => { throw new Error('加载失败') })
  await retry.page.loadMoreHistoryConversations()
  assert.equal(retry.page.historyLoadMoreError, '加载失败')
  assert.equal(retry.page.historyPage, 1)
  retry.request(async () => ({ Code: 0, Data: { Sessions: [{ Accid: 'enterprise-3' }] } }))
  await retry.page.loadMoreHistoryConversations()
  assert.equal(retry.page.historyPage, 2)
  assert.equal(retry.page.historyLoadMoreError, '')

  const unloaded = environment()
  let resolveUnloaded
  unloaded.request(() => new Promise(resolve => { resolveUnloaded = resolve }))
  await enter(unloaded)
  const request = unloaded.page.switchTab('history')
  unloaded.definition.onUnload.call(unloaded.page)
  resolveUnloaded({ Code: 0, Data: { Sessions: sessions } })
  await request
  assert.equal(unloaded.page.historyConversations.length, 0)
  console.log('mobile conversation history tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
