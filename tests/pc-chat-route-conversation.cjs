// node tests/pc-chat-route-conversation.cjs：验证 PC 聊天页通过 personAccId 自动打开/清理会话。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pages/ehr/pc/chat.vue'), 'utf8')

function loadPage(globals) {
  const context = vm.createContext({ module: { exports: {} }, console, ...globals })
  vm.runInContext(source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports ='), context)
  const definition = context.module.exports
  const page = definition.data()
  Object.entries(definition.methods).forEach(([name, method]) => { page[name] = method.bind(page) })
  Object.entries(definition.computed).forEach(([name, getter]) => {
    Object.defineProperty(page, name, { get: getter.bind(page) })
  })
  return page
}

function makeGlobals(state) {
  return {
    PcChatPanel: {}, PcChatHistoryPanel: {}, NIM_EVENT: {},
    isNimLoggedIn: () => true,
    getNimLoginError: () => null,
    getNimInstance: () => ({
      V2NIMLoginService: { getLoginUser: () => 'enterprise-1' },
      V2NIMConversationIdUtil: { p2pConversationId: id => `p2p-${id}` },
      V2NIMLocalConversationService: state.localConversationService
    }),
    getAllNimConversations: async () => state.listedConversations,
    getAllHistoryConversations: async () => [],
    normalizeAndSortConversations: rows => rows,
    requestApi: async args => {
      state.calls.push({ type: 'request', ...args })
      return state.requestHandler(args)
    },
    uni: {
      showToast: payload => state.toasts.push(payload),
      showModal: payload => state.modals.push(payload),
      $on() {}, $off() {}
    }
  }
}

function prepare(page, personAccId, flags = {}) {
  page._conversationPageAlive = true
  page._openConversationRequestId = 0
  page.pageVisible = true
  page.routePersonAccId = personAccId
  page.routeMessageExistedProvided = flags.messageExisted !== undefined
  page.routeMessageExisted = flags.messageExisted === true
  page.routeJobId = flags.jobId || ''
  page.routeResumeId = flags.resumeId || ''
}

async function verify() {
  const state = {
    calls: [], toasts: [], modals: [], listedConversations: [],
    expectedDeletePerson: '',
    localConversationService: {
      pinned: [],
      getStickTopConversationList: async () => state.localConversationService.pinned,
      stickTopConversation: async (conversationId, stickTop) => {
        state.calls.push({ type: 'unpin', conversationId, stickTop })
      },
      deleteConversation: async (conversationId, clearMessage) => {
        state.calls.push({ type: 'nim-delete', conversationId, clearMessage })
      }
    },
    requestHandler: async args => {
      assert.equal(args.Name, 'Chat.Chat.GetSingleChat')
      return { Code: 0, Data: { JobId: 'job-1', ResumeId: 'resume-1' } }
    }
  }
  const globals = makeGlobals(state)

  // 列表已有会话时，沿用 GetSingleChat，不受 messageExisted 分支影响。
  const existing = loadPage(globals)
  prepare(existing, 'person-1', { messageExisted: true })
  state.listedConversations = [{
    conversationId: 'p2p-person-1', id: 'p2p-person-1', targetId: 'person-1', type: 1,
    name: '人才一', avatar: '/avatar.png'
  }]
  await existing.openRouteConversationAfterLoad()
  assert.equal(existing.selectedId, 'p2p-person-1')
  assert.equal(existing.chatDetail.personAccId, 'person-1')
  assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.Chat.GetSingleChat'])

  // messageExisted=false 且列表没有会话时，请求 Limits 并使用 URL 的职位/简历。
  state.calls.length = 0
  state.listedConversations = []
  state.requestHandler = async args => {
    assert.equal(args.Name, 'Chat.MyChat.Limits')
    return { Code: 0, Data: { JobId: 'server-job', ResumeId: 'server-resume' } }
  }
  const fresh = loadPage(makeGlobals(state))
  prepare(fresh, 'person-2', {
    messageExisted: false, jobId: 'job-from-url', resumeId: 'resume-from-url'
  })
  await fresh.openRouteConversationAfterLoad()
  assert.equal(fresh.selectedId, 'p2p-person-2')
  assert.equal(fresh.chatDetail.jobId, 'job-from-url')
  assert.equal(fresh.chatDetail.resumeId, 'resume-from-url')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state.calls)), [{
    type: 'request', Name: 'Chat.MyChat.Limits',
    Content: { JobId: 'job-from-url', ResumeId: 'resume-from-url' }
  }])
  assert.equal(fresh.chatDetail.initialAccess.Data.JobId, 'server-job')

  // messageExisted=true 且列表没有会话时，先调用业务删除，再清理云信会话并弹窗。
  state.calls.length = 0
  state.modals.length = 0
  state.toasts.length = 0
  state.requestHandler = async args => {
    assert.equal(args.Name, 'Chat.Chat.Delete')
    assert.deepStrictEqual(JSON.parse(JSON.stringify(args.Content)), {
      EnterpriseAccId: 'enterprise-1', PersonAccId: state.expectedDeletePerson
    })
    return { Code: 0, Data: { Code: 0 } }
  }
  const expired = loadPage(makeGlobals(state))
  prepare(expired, 'person-3', { messageExisted: true })
  state.expectedDeletePerson = 'person-3'
  state.localConversationService.pinned = []
  await expired.openRouteConversationAfterLoad()
  assert.equal(expired.selectedId, '')
  assert.equal(expired.chatDetail, null)
  assert.deepStrictEqual(state.calls.map(call => call.type || call.Name), [
    'request', 'nim-delete'
  ])
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state.calls[1])), {
    type: 'nim-delete', conversationId: 'p2p-person-3', clearMessage: true
  })
  assert.equal(state.modals[0].content, '该会话已经过期，请重新在简历页面发起会话!')

  // 云信置顶状态必须先取消置顶，再删除会话；其他会话不受影响。
  state.calls.length = 0
  state.modals.length = 0
  state.localConversationService.pinned = [
    { conversationId: 'p2p-person-4' }, { conversationId: 'p2p-other' }
  ]
  const pinnedExpired = loadPage(makeGlobals(state))
  prepare(pinnedExpired, 'person-4', { messageExisted: true })
  state.expectedDeletePerson = 'person-4'
  await pinnedExpired.openRouteConversationAfterLoad()
  assert.deepStrictEqual(state.calls.map(call => call.type || call.Name), [
    'request', 'unpin', 'nim-delete'
  ])
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state.calls[1])), {
    type: 'unpin', conversationId: 'p2p-person-4', stickTop: false
  })
  assert.equal(state.calls[2].conversationId, 'p2p-person-4')

  // 未传 messageExisted 时保留原有 GetSingleChat 逻辑。
  state.calls.length = 0
  state.localConversationService.pinned = []
  state.requestHandler = async args => {
    assert.equal(args.Name, 'Chat.Chat.GetSingleChat')
    return { Code: 0, Data: { JobId: 'job-5', ResumeId: 'resume-5' } }
  }
  const legacy = loadPage(makeGlobals(state))
  prepare(legacy, 'person-5')
  await legacy.openRouteConversationAfterLoad()
  assert.equal(state.calls[0].Name, 'Chat.Chat.GetSingleChat')

  console.log('pc chat route conversation tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
