// node tests/pc-chat-route-conversation.cjs：验证 PC 聊天页通过 personAccId 自动打开已有/新会话。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pages/ehr/pc/chat.vue'), 'utf8')

function loadPage(globals) {
  const context = vm.createContext({ module: { exports: {} }, ...globals })
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

async function verify() {
  const calls = []
  let listedConversations = []
  const globals = {
    PcChatPanel: {}, PcChatHistoryPanel: {},
    NIM_EVENT: {},
    isNimLoggedIn: () => true,
    getNimLoginError: () => null,
    getNimInstance: () => ({
      V2NIMLoginService: { getLoginUser: () => 'enterprise-1' },
      V2NIMConversationIdUtil: { p2pConversationId: id => `p2p-${id}` }
    }),
    getAllNimConversations: async () => listedConversations,
    getAllHistoryConversations: async () => [],
    normalizeAndSortConversations: rows => rows,
    requestApi: async args => {
      calls.push(args)
      return { Code: 0, Data: { JobId: 'job-1', ResumeId: 'resume-1' } }
    },
    uni: { showToast() {}, $on() {}, $off() {} }
  }

  const existing = loadPage(globals)
  existing._conversationPageAlive = true
  existing._openConversationRequestId = 0
  existing.pageVisible = true
  existing.routePersonAccId = 'person-1'
  listedConversations = [{
    conversationId: 'p2p-person-1', id: 'p2p-person-1', targetId: 'person-1', type: 1,
    name: '人才一', avatar: '/avatar.png'
  }]
  await existing.openRouteConversationAfterLoad()
  assert.equal(existing.selectedId, 'p2p-person-1')
  assert.equal(existing.chatDetail.personAccId, 'person-1')
  assert.equal(calls.length, 1)

  const fresh = loadPage(globals)
  fresh._conversationPageAlive = true
  fresh._openConversationRequestId = 0
  fresh.pageVisible = true
  fresh.routePersonAccId = 'person-2'
  listedConversations = []
  calls.length = 0
  await fresh.openRouteConversationAfterLoad()
  assert.equal(fresh.selectedId, 'p2p-person-2')
  assert.equal(fresh.chatDetail.conversationId, 'p2p-person-2')
  assert.equal(fresh.rawConversations.length, 1)
  assert.equal(fresh.rawConversations[0].targetId, 'person-2')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0])), {
    Name: 'Chat.Chat.GetSingleChat',
    Content: { PersonAccId: 'person-2', EnterpriseAccId: 'enterprise-1' }
  })
  console.log('pc chat route conversation tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
