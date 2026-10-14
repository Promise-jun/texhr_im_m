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
  for (const name of ['getAllHistoryConversations', 'getAllNimConversations',
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
    getHistory: globals.getAllHistoryConversations,
    request: handler => { request = handler },
    emit: (event, payload) => listeners.get(event)?.(payload)
  }
}

async function enter(env) {
  await env.definition.onLoad.call(env.page)
  env.definition.onShow.call(env.page)
}

async function verify() {
  // 非空响应也只请求一次，不追加 start=1、start=2 的重复分页。
  const service = environment()
  const history = await service.getHistory()
  assert.equal(service.calls.length, 1)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(service.calls[0])), {
    Name: 'Chat.Chat.GetAllSessions', Content: { accid: 'person-1' }
  })
  assert.equal(history.length, 2)
  assert.equal(history[0].id, 'p2p-enterprise-1')
  assert.equal(history[0].name, '企业一')
  assert.equal(history[0].message, '最新消息')
  assert.equal(history[0].isHistory, true)
  assert.equal(history[1].time, '昨天 10:00')

  // onShow 和登录事件重叠时合并在途请求；完成后也不再次拉取。
  const page = environment()
  let resolveRequest
  page.request(() => new Promise(resolve => { resolveRequest = resolve }))
  await enter(page)
  page.emit('login-status', 1)
  page.definition.onShow.call(page.page)
  assert.equal(page.calls.length, 1)
  resolveRequest({ Code: 0, Data: JSON.stringify({ Sessions: sessions }) })
  await page.page.loadHistoryConversations()
  assert.equal(page.page.historyConversations.length, 2)
  assert.equal(page.page.isHistoryLoading, false)
  assert.equal(page.page._historyConversationsLoaded, true)
  page.emit('login-status', 1)
  page.definition.onShow.call(page.page)
  await page.page.loadHistoryConversations()
  assert.equal(page.calls.length, 1)
  assert.ok(page.state.sdkReloads > 1, 'SDK 实时会话仍然刷新')

  // 首次进入尚未登录时，等待登录成功后发起唯一一次请求。
  const delayedLogin = environment()
  delayedLogin.state.loggedIn = false
  await enter(delayedLogin)
  assert.equal(delayedLogin.calls.length, 0)
  assert.equal(delayedLogin.page.isHistoryLoading, true)
  delayedLogin.state.loggedIn = true
  delayedLogin.emit('login-status', 1)
  await delayedLogin.page.loadHistoryConversations()
  delayedLogin.emit('login-status', 1)
  assert.equal(delayedLogin.calls.length, 1)

  // 空列表也属于成功加载，不能因 length=0 重复请求。
  const empty = environment()
  empty.request(async () => ({ Code: 0, Data: { Sessions: [] } }))
  await enter(empty)
  await empty.page.loadHistoryConversations()
  empty.definition.onShow.call(empty.page)
  empty.emit('login-status', 1)
  await empty.page.loadHistoryConversations()
  assert.equal(empty.calls.length, 1)
  assert.equal(empty.page.historyConversations.length, 0)
  assert.equal(empty.page.isHistoryLoading, false)

  // 请求失败不会设置已加载标记，保留历史页的点击重试。
  const retry = environment()
  retry.request(async () => { throw new Error('网络异常') })
  await enter(retry)
  await retry.page.loadHistoryConversations()
  assert.equal(retry.page.historyLoadError, '网络异常')
  assert.equal(retry.page._historyConversationsLoaded, false)
  assert.equal(retry.page.isHistoryLoading, false)
  retry.request(async () => ({ Code: 0, Data: { Sessions: sessions } }))
  retry.page.activeTab = 'history'
  retry.page.retryVisibleConversations()
  await retry.page.loadHistoryConversations()
  assert.equal(retry.calls.length, 2)
  assert.equal(retry.page.historyLoadError, '')
  assert.equal(retry.page._historyConversationsLoaded, true)

  // 页面卸载后不更新数据；重新创建列表页时可以正常请求一次。
  const unloaded = environment()
  let resolveUnloaded
  unloaded.request(() => new Promise(resolve => { resolveUnloaded = resolve }))
  await enter(unloaded)
  const pending = unloaded.page.loadHistoryConversations()
  unloaded.definition.onUnload.call(unloaded.page)
  resolveUnloaded({ Code: 0, Data: { Sessions: sessions } })
  await pending
  assert.equal(unloaded.page.historyConversations.length, 0)
  assert.equal(unloaded.page._historyConversationsLoaded, false)
  const reopened = environment()
  await enter(reopened)
  await reopened.page.loadHistoryConversations()
  assert.equal(reopened.calls.length, 1)

  // 保留业务错误、无效 JSON、未登录和缺少账号的校验。
  for (const [response, expected] of [
    [{ Code: 9000002 }, /业务错误码/],
    [{ Code: 0, Data: { Code: 1 } }, /数据错误码/],
    [{ Code: 0, Data: 'invalid json' }, /有效 JSON/]
  ]) {
    const invalid = environment()
    invalid.request(async () => response)
    await assert.rejects(invalid.getHistory(), expected)
    assert.equal(invalid.calls.length, 1)
  }
  const noLogin = environment()
  noLogin.state.loggedIn = false
  await assert.rejects(noLogin.getHistory(), /尚未登录/)
  assert.equal(noLogin.calls.length, 0)
  const noAccount = environment()
  noAccount.state.accountId = ''
  await assert.rejects(noAccount.getHistory(), /未获取到当前网易云账号/)
  assert.equal(noAccount.calls.length, 0)

  console.log('mobile conversation history tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
