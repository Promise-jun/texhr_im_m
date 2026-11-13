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

function environment({ loggedIn = true, switchFails = false, singleResponse, limitsResponse } = {}) {
  const calls = [], modals = [], sent = [], historyRequests = [], profiles = [], reads = [], toasts = []
  const listeners = new Map()
  const state = { loggedIn }
  const nim = {
    V2NIMLoginService: { getLoginUser: () => 'person' },
    V2NIMConversationIdUtil: { p2pConversationId: account => `p2p-${account}` },
    V2NIMUserService: { getUserListFromCloud: async accounts => {
      profiles.push(...accounts)
      return accounts.map(accountId => ({ accountId, avatar: `${accountId}.png` }))
    } },
    V2NIMMessageCreator: {
      createTextMessage: text => ({ text, messageType: 0 }),
      createCustomMessage: (text, raw) => ({ text, messageType: 100, attachment: { raw } })
    },
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
        case 'Chat.Chat.GetSingleChat':
          return singleResponse || { Code: 0, Data: {
            JobId: 'old-job', ResumeId: 'resume', PersonAccId: 'person', EnterpriseAccId: 'enterprise',
            CodeNum: '123', IsTop: true, Message: { JobName: '旧职位' }
          } }
        case 'Chat.MyChat.Limits':
          return limitsResponse || { Code: 0, Data: {
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
    enter: async (options = { jobId: 'new-job', resumeId: 'resume', limit: 'true' }) => {
      const loading = definition.onLoad.call(page, options)
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

  // 列表只传双方账号，聊天页获取职位/简历后继续加载历史、资料和实时消息。
  const accounts = { personAccId: ' person ', enterpriseAccId: ' enterprise ' }
  const existing = environment()
  await existing.enter(accounts)
  assertChatReady(existing)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(existing.calls.filter(call =>
    ['Chat.MyChat.Limits', 'Chat.Chat.GetSingleChat'].includes(call.Name)))), [{
    Name: 'Chat.Chat.GetSingleChat', Content: { PersonAccId: 'person', EnterpriseAccId: 'enterprise' }
  }])
  assert.equal(existing.page.jobId, 'old-job')
  assert.equal(existing.page.resumeId, 'resume')
  assert.equal(existing.calls.find(call => call.Name === 'Chat.Person.CheckSendResume').Content.JobId, 'old-job')
  assert.equal(existing.page.codeNum, '123')
  assert.equal(existing.page.isPinned, true)
  assert.equal(existing.modals.length, 0)
  assert.equal(existing.sent.length, 0, '已有会话不重复发送默认招呼语')
  existing.page.checkOtherBlockedBeforeSend = async () => {}
  existing.page.draft = '从聊天列表进入后发送'
  await existing.page.sendMessage()
  const sendLimitCalls = existing.calls.filter(call => call.Name === 'Chat.MyChat.Limits')
  assert.equal(sendLimitCalls.length, 1, '不带 limit 的已有会话发送前仍须请求 Limits')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sendLimitCalls[0].Content)), {
    JobId: 'old-job', ResumeId: 'resume'
  })
  assert.equal(existing.sent.length, 1)
  assert.equal(existing.sent[0].value.text, '从聊天列表进入后发送')
  assert.equal(existing.page.draft, '')

  for (const limitsResponse of [
    { Code: 0, Data: { SuccessStep: { Tips: '请完善简历后再联系企业', StepName: '立即完善' } } },
    { Code: 1, ErrorMessage: '当前不能发送消息' }
  ]) {
    const blocked = environment({ limitsResponse })
    await blocked.enter(accounts)
    blocked.page.checkOtherBlockedBeforeSend = async () => {}
    blocked.page.draft = '受限消息保留草稿'
    await blocked.page.sendMessage()
    assert.equal(blocked.calls.filter(call => call.Name === 'Chat.MyChat.Limits').length, 1)
    assert.equal(blocked.sent.length, 0, '已有会话必须在 Limits 放行后才发送')
    assert.equal(blocked.page.draft, '受限消息保留草稿')
    assert.equal(blocked.page.isSendingMessage, false)
    if (limitsResponse.ErrorMessage) assert.equal(blocked.toasts[0], limitsResponse.ErrorMessage)
    else assert.equal(blocked.modals[0].content, limitsResponse.Data.SuccessStep.Tips)
  }
  await existing.listeners.get('message')([message('existing-live', 3)])
  assert.ok(existing.page.messages.some(item => item.messageClientId === 'existing-live'))

  const existingDelayed = environment({ loggedIn: false })
  await existingDelayed.enter(accounts)
  assert.equal(existingDelayed.historyRequests.length, 0)
  existingDelayed.state.loggedIn = true
  existingDelayed.listeners.get('login')(1)
  await flush()
  assertChatReady(existingDelayed)
  assert.equal(existingDelayed.calls.filter(call => call.Name === 'Chat.Chat.GetSingleChat').length, 1)

  const rootFields = environment({ singleResponse: {
    Code: '0', Data: JSON.stringify({ IsTop: 'true' }), JobId: 'old-job', ResumeId: 'resume'
  } })
  await rootFields.enter({ PersonAccId: 'person', EnterpriseAccId: 'enterprise' })
  assertChatReady(rootFields)
  assert.equal(rootFields.page.jobId, 'old-job')
  assert.equal(rootFields.page.resumeId, 'resume')
  assert.equal(rootFields.page.isPinned, true)

  for (const singleResponse of [{ Code: 9 }, { Code: 0, Data: { Code: 2 } },
    { Code: 0, Data: '{invalid' }, { Code: 0, Data: { JobId: 'old-job' } }]) {
    const failed = environment({ singleResponse })
    await failed.enter(accounts)
    assert.ok(failed.page.historyLoadError)
    assert.equal(failed.historyRequests.length, 0, '会话查询失败不继续初始化')
    assert.equal(failed.page.isCheckingLimits, false)
  }

  for (const limit of ['true', 'false', '']) {
    const limited = environment()
    await limited.enter({ jobId: 'new-job', resumeId: 'resume', limit })
    assertChatReady(limited)
    assert.equal(limited.calls.filter(call => call.Name === 'Chat.MyChat.Limits').length, 1)
    assert.equal(limited.calls.filter(call => call.Name === 'Chat.Chat.GetSingleChat').length, 0)
  }
  console.log('PASS: URL limit controls initialization; existing chats still check Limits before sending and preserve blocked drafts')
  console.log('PASS: mobile chat history and live messages work while the job switch modal is pending, cancelled, confirmed, or fails')
  console.log('PASS: delayed NIM login initializes chat without waiting for the job switch modal')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
