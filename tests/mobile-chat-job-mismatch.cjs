// node tests/mobile-chat-job-mismatch.cjs: all API and SDK calls use in-memory data.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../pages/person/m/chat.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')
const flush = () => new Promise(resolve => setImmediate(resolve))
const message = (id, time) => ({
  conversationId: 'p2p-enterprise', messageClientId: id, createTime: time,
  messageType: 0, text: id, isSelf: false
})

function environment({ loggedIn = true, switchFails = false } = {}) {
  const calls = [], modals = [], sent = [], historyRequests = [], profiles = [], reads = [], toasts = []
  const listeners = new Map()
  const state = { loggedIn }
  const nim = {
    V2NIMLoginService: { getLoginUser: () => 'person' },
    V2NIMConversationIdUtil: { p2pConversationId: account => `p2p-${account}` },
    V2NIMUserService: { getUserListFromCloud: async accounts => {
      profiles.push(accounts[0])
      return accounts.map(accountId => ({ accountId, avatar: `${accountId}.png` }))
    } },
    V2NIMMessageCreator: { createCustomMessage: (text, raw) => ({
      text, messageType: 100, attachment: { raw }
    }) },
    V2NIMMessageService: {
      getMessageList: async options => {
        historyRequests.push(options)
        return [message('history', 1)]
      },
      sendMessage: async (value, conversationId) => {
        sent.push({ value, conversationId })
        return { message: { ...value, conversationId, messageClientId: 'switched', createTime: 2, isSelf: true } }
      }
    }
  }
  const context = vm.createContext({
    module: { exports: {} }, console, setTimeout, clearTimeout,
    DEFAULT_TALENT_AVATAR: '/static/preson_avatar.png',
    getTalentAvatar: () => '/static/preson_avatar.png',
    maskPhoneNumbers: value => value, NIM_EMOJIS: [],
    parseNimEmojiText: value => [{ type: 'text', content: value }],
    NIM_EVENT: { LOGIN_STATUS: 'login', LOGIN_FAILED: 'failed', MESSAGE_RECEIVED: 'message', MESSAGE_REVOKED: 'revoke' },
    getNimInstance: () => nim, isNimLoggedIn: () => state.loggedIn,
    getNimLoginError: () => null, getExternalReturnUrl: () => '',
    setActiveConversationId() {}, clearActiveConversationId() {},
    markNimConversationRead: async id => { reads.push(id) },
    sendNimP2PReadReceipt: async () => {},
    requestApi: async args => {
      calls.push(args)
      switch (args.Name) {
        case 'Chat.MyChat.Limits':
          return { Code: 0, Data: {
            JobId: 'old-job', PersonAccId: 'person', EnterpriseAccId: 'enterprise',
            Message: { JobName: '旧职位' }
          } }
        case 'Chat.Chat.ChangeJob':
          return switchFails ? { Code: 9 } : { Code: 0, Data: { Enterprise: { JobId: 'new-job', JobName: '新职位' } } }
        case 'Chat.Person.GetJobState': return { Code: 0, Data: { State: 1 } }
        case 'Chat.CommonLanguage.Get': return { Code: 0, Data: { Rows: [] } }
        case 'Chat.Person.CheckSendResume': return { Code: 0, Data: { IsShow: true } }
        default: throw new Error(`unexpected API: ${args.Name}`)
      }
    },
    uni: {
      getSystemInfoSync: () => ({}),
      $on: (event, handler) => listeners.set(event, handler),
      $off: event => listeners.delete(event),
      showModal: options => modals.push(options),
      showToast: options => toasts.push(options.title),
      showLoading() {}, hideLoading() {}, $emit() {}
    }
  })
  vm.runInContext(script, context)
  const definition = context.module.exports
  const page = { ...definition.data(), $nextTick: callback => Promise.resolve().then(callback) }
  for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)
  return {
    page, calls, modals, sent, historyRequests, profiles, reads, listeners, state, toasts,
    enter: async () => {
      const loading = definition.onLoad.call(page, { jobId: 'new-job', resumeId: 'resume' })
      definition.onShow.call(page)
      await loading
    }
  }
}

function assertChatReady(env) {
  assert.equal(env.page.enterpriseAccId, 'enterprise')
  assert.equal(env.page.conversationId, 'p2p-enterprise')
  assert.equal(env.historyRequests.length, 1, 'history loads without a modal decision and is not reloaded by switching')
  assert.equal(env.historyRequests[0].conversationId, 'p2p-enterprise')
  assert.ok(env.page.messages.some(item => item.messageClientId === 'history'))
  assert.equal(env.page.historyLoadError, '')
  assert.equal(env.page.isCheckingLimits, false)
  assert.equal(env.page.isWaitingForNim, false)
  assert.equal(env.page.isLoadingHistory, false)
  assert.deepStrictEqual(env.profiles.slice().sort(), ['enterprise', 'person'])
  assert.ok(env.reads.includes('p2p-enterprise'))
  assert.ok(env.listeners.has('message'))
}

async function verify() {
  for (const action of ['pending', 'cancel', 'confirm', 'failure']) {
    const env = environment({ switchFails: action === 'failure' })
    await env.enter()
    assert.equal(env.modals.length, 1)
    assert.equal(env.modals[0].confirmText, '立即切换')
    assertChatReady(env)
    assert.equal(env.sent.length, 0, 'mismatched jobs do not send the initial greeting')
    assert.equal(env.calls.filter(call => call.Name === 'Chat.Chat.ChangeJob').length, 0)
    assert.ok(env.calls.some(call => call.Name === 'Chat.CommonLanguage.Get'))
    assert.ok(env.calls.some(call => call.Name === 'Chat.Person.CheckSendResume'))

    if (action !== 'pending') {
      env.modals[0].success({ confirm: action !== 'cancel', cancel: action === 'cancel' })
      await flush()
    }
    assertChatReady(env)
    const switches = env.calls.filter(call => call.Name === 'Chat.Chat.ChangeJob')
    assert.equal(switches.length, ['confirm', 'failure'].includes(action) ? 1 : 0)
    if (action === 'confirm') {
      assert.equal(switches[0].Content.JobId, 'new-job')
      assert.equal(env.sent.length, 1)
      assert.equal(env.sent[0].conversationId, 'p2p-enterprise')
      assert.deepStrictEqual(JSON.parse(env.sent[0].value.attachment.raw), {
        type: 5, data: { JobId: 'new-job', JobName: '新职位' }
      })
    } else {
      assert.equal(env.sent.length, 0)
    }
    if (action === 'failure') assert.match(env.toasts[0], /切换聊天职位失败/)
    await env.listeners.get('message')([message(`live-${action}`, 3), {
      ...message('another-chat', 4), conversationId: 'p2p-another'
    }])
    assert.ok(env.page.messages.some(item => item.messageClientId === `live-${action}`))
    assert.ok(!env.page.messages.some(item => item.messageClientId === 'another-chat'))
  }

  const delayed = environment({ loggedIn: false })
  await delayed.enter()
  assert.equal(delayed.modals.length, 1)
  assert.equal(delayed.page.isWaitingForNim, true)
  assert.equal(delayed.historyRequests.length, 0)
  delayed.state.loggedIn = true
  delayed.listeners.get('login')(1)
  await flush()
  assertChatReady(delayed)
  assert.equal(delayed.sent.length, 0)
  console.log('PASS: mobile chat history and live messages work while the job switch modal is pending, cancelled, confirmed, or fails')
  console.log('PASS: delayed NIM login initializes chat without waiting for the job switch modal')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
