// node tests/pc-chat-history-detail.cjs：内存模拟业务接口，验证 PC 历史详情顺序和继续聊天，不操作真实账号。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const requestApiEnvironment = require('./request-api-helper.cjs')
const root = path.resolve(__dirname, '..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const pageSource = source('pages/ehr/pc/chat.vue')
const panelSource = source('components/pc-chat-history-panel/pc-chat-history-panel.vue')
const plain = value => JSON.parse(JSON.stringify(value))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function loadComponent(text, globals) {
  const context = vm.createContext({ module: { exports: {} }, ...globals })
  vm.runInContext(text.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'module.exports ='), context)
  return context.module.exports
}
function instance(def, base) {
  Object.assign(base, def.data.call(base))
  for (const [key, method] of Object.entries(def.methods)) base[key] = method.bind(base)
  for (const [key, getter] of Object.entries(def.computed)) Object.defineProperty(base, key, { get: getter.bind(base) })
  return base
}
function environment() {
  const calls = [], toasts = [], events = [], previews = [], played = [], links = [], sentMessages = [], modals = []
  const state = { loggedIn: true, stopped: 0 }
  let request = async args => args.Name === 'Chat.Chat.GetSingleChat'
    ? { Code: 0, Data: { JobId: 'job-1', ResumeId: 'resume-1', ChatByQRcode: 'qr-code' } }
    : args.Name === 'Chat.Person.GetJobState'
      ? { Code: 0, Data: { State: 1 } }
      : args.Name === 'Chat.ChatButton.Get'
        ? { Code: 0, Data: { JobId: 'job-a' } }
      : { Code: 0, Data: { Rows: [] } }
  let continuePromise = null
  const globals = {
    PcChatPanel: {}, PcChatHistoryPanel: {},
    isNimLoggedIn: () => state.loggedIn,
    notifyNimNotReady: () => toasts.push('聊天服务尚未就绪'),
    getNimInstance: () => ({
      V2NIMLoginService: { getLoginUser: () => 'enterprise' },
      V2NIMMessageCreator: {
        createCustomMessage: (text, attachment) => ({ type: 'custom', text, attachment }),
        createTextMessage: text => ({ type: 'text', text })
      },
      V2NIMMessageService: {
        sendMessage: async (message, conversationId) => {
          sentMessages.push({ message, conversationId })
          return { message: { messageClientId: `sent-${sentMessages.length}` } }
        }
      }
    }),
    normalizeAndSortConversations: rows => rows,
    getHistoryConversationsPage: async () => [],
    getTalentAvatar: () => '/static/default_avatar.png',
    requestApi: args => { calls.push(plain(args)); return request(args) },
    parseNimEmojiText: content => [{ type: 'text', content }],
    audioBubbleWidth: seconds => `${120 + seconds}px`, getAudioMimeType: message => message.mimeType || '',
    createPcAudioPlayer: options => ({
      play: message => { played.push(message); options.onState(message.id, 'playing'); options.onDuration(message.id, 5) },
      destroy: () => { state.stopped++; options.onState('', 'idle') }
    }),
    window: { open: url => { links.push(url); return {} } },
    uni: {
      showToast: value => toasts.push(value.title), previewImage: value => previews.push(value),
      showModal: options => { modals.push(options); if (options.success) options.success({ confirm: true }) }
    }
  }
  Object.assign(globals, requestApiEnvironment(globals.requestApi, { enterprise: true }))
  const serviceContext = vm.createContext(globals)
  vm.runInContext(source('services/chat-history.js').replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), serviceContext)
  globals.getHistoryChatMessages = serviceContext.getHistoryChatMessages
  globals.getHistoryChatJobState = serviceContext.getHistoryChatJobState
  globals.getHistoryChatButton = serviceContext.getHistoryChatButton
  globals.changeHistoryChatJob = serviceContext.changeHistoryChatJob
  const pageDef = loadComponent(pageSource, globals)
  const page = instance(pageDef, { _conversationPageAlive: true, _openConversationRequestId: 0 })
  page.pageVisible = true
  page.activeMainTab = 'history'
  const panelDef = loadComponent(panelSource, globals)
  const mount = () => {
    const panel = instance(panelDef, { detail: page.historyChatDetail, visible: true, opening: false,
      $nextTick: callback => callback(), $set: (obj, key, value) => { obj[key] = value },
      $emit: (event, value) => {
        events.push({ event, value })
        if (event === 'action') page.handleChatAction(value)
        if (event === 'continue') continuePromise = page.continueHistoryChat()
      } })
    panelDef.mounted.call(panel)
    return panel
  }
  return { page, pageDef, panelDef, mount, service: serviceContext, calls, toasts, events, previews, played, links, sentMessages, modals, state,
    get continuePromise() { return continuePromise },
    request: fn => { request = fn } }
}
const conversation = id => ({ id: `p2p-${id}`, targetId: id, type: 1, name: `人才${id}` })

async function verifyFlow() {
  const env = environment(), details = deferred(), history = deferred()
  env.page.chatDetail = { conversationId: 'recent', resumeId: 'recent-resume' }
  env.page.selectedId = 'recent'
  env.request(args => args.Name === 'Chat.Chat.GetSingleChat' ? details.promise
    : args.Name === 'Chat.Person.GetJobState' ? { Code: 0, Data: { State: 1 } }
      : args.Name === 'Chat.ChatButton.Get' ? { Code: 0, Data: { JobId: 'job-a' } }
        : args.Name === 'Chat.MyChat.Limits' ? { Code: 0, Data: {} } : history.promise)
  const selecting = env.page.selectConversation(conversation('a'))
  assert.equal(env.calls.length, 1)
  assert.deepStrictEqual(env.calls[0], {
    Name: 'Chat.Chat.GetSingleChat', Content: { PersonAccId: 'a', EnterpriseAccId: 'enterprise' }
  })
  assert.equal(env.page.historyChatDetail, null)
  details.resolve({ Code: 0, Data: { JobId: 'job-a', ResumeId: 'resume a', ChatByQRcode: 'qr-a' } })
  await selecting
  assert.equal(env.page.chatDetail.resumeId, 'recent-resume')
  assert.equal(env.page.selectedId, 'recent')
  const panel = env.mount()
  const loading = panel.loadMessages()
  assert.equal(env.calls.length, 2)
  assert.deepStrictEqual(env.calls[1], { Name: 'Chat.Chat.GetSessionContent',
    Content: { fromAccid: 'enterprise', toAccid: 'a' } })
  panel.continueChat()
  assert.equal(env.page.activeMainTab, 'history')
  const person = { PersonName: '何先生', Gender: 1, Age: 70, Education: '高中', Experience: '9年', Post: '招商业务', Location: '广州' }
  history.resolve({ Code: 0, Data: { Code: 0, Rows: [
    { MsgType: 4, Msg: JSON.stringify({ type: 4, data: JSON.stringify({ Person: person }) }) },
    { MsgType: 1, Msg: '你好[大笑]', IsMySend: false, ShowTime: '昨天 10:00', Icon: '/person.png', Name: '人才' },
    { MsgType: 1, Msg: '回复', IsMySend: 'true', Icon: '/enterprise.png' },
    { MsgType: 2, Msg: 'image.png' }, { MsgType: 2, Msg: { url: 'image2.png' } },
    { MsgType: 3, Msg: { attachment: { url: 'voice', duration: 2501, mimeType: 'audio/amr' } } },
    { MsgType: 5, Msg: { data: { Enterprise: { Tips: '已切换职位' } } } },
    { MsgType: 4, Msg: { Enterprise: { JobId: 'job-old', JobName: '旧职位' } } },
    { MsgType: 4, Msg: 'broken' }, null
  ] } })
  await loading
  assert.equal(panel.loaded, true)
  assert.equal(panel.messages.length, 9)
  assert.deepStrictEqual(plain(panel.messages.map(message => message.type)),
    ['person-card', 'text', 'text', 'image', 'image', 'audio', 'system', 'job-card', 'text'])
  assert.deepStrictEqual(plain(panel.messages[0].person), { name: '何先生', meta: ['男', '70岁', '高中', '9年'], jobName: '招商业务', location: '广州' })
  assert.equal(panel.messages[1].direction, 'other')
  assert.equal(panel.messages[2].direction, 'self')
  assert.equal(panel.messages[5].durationSeconds, 3)
  assert.equal(panel.messages[5].attachment.mimeType, 'audio/amr')
  assert.equal(panel.messages[6].content, '已切换职位')
  assert.ok(!panelSource.includes('人才简历已关联'))
  assert.equal(panel.scrollTarget, 'pc-history-message-bottom')
  panel.stopInitialAutoScroll()
  panel.scrollTarget = 'read-position'
  panel.scrollToBottom()
  assert.equal(panel.scrollTarget, 'read-position')
  panel.previewImage('image2.png')
  assert.deepStrictEqual(plain(env.previews[0]), { current: 'image2.png', urls: ['image.png', 'image2.png'] })
  panel.handleAvatarError('/person.png')
  assert.equal(panel.messageAvatar(panel.messages[1]), '/static/default_avatar.png')
  assert.equal(panel.messageAvatar(panel.messages[2]), '/enterprise.png')
  panel.playAudio(panel.displayMessages[5])
  assert.equal(env.played[0].mimeType, 'audio/amr')
  assert.equal(panel.displayMessages[5].durationSeconds, 5)
  env.panelDef.watch.visible.call(panel, false)
  assert.equal(env.state.stopped, 1)
  panel.viewResume()
  assert.equal(env.links[0], 'https://www.texhr.cn/resumes/?ids=resume%20a')
  panel.opening = true
  panel.continueChat()
  assert.equal(env.page.activeMainTab, 'history')
  panel.opening = false
  env.state.loggedIn = false
  panel.continueChat()
  assert.equal(env.page.activeMainTab, 'history')
  env.state.loggedIn = true
  panel.continueChat()
  await env.continuePromise
  assert.equal(env.page.activeMainTab, 'recent')
  assert.equal(env.page.activeMessageTab, 'all')
  assert.equal(env.page.selectedId, 'p2p-a')
  assert.equal(env.page.activeConversation.targetId, 'a')
  assert.equal(env.page.chatDetail.jobId, 'job-a')
  assert.equal(env.page.chatDetail.resumeId, 'resume a')
  assert.equal(env.page.chatDetail.chatByQRcode, 'qr-a')
  assert.equal(env.page.chatDetail.skipGreeting, true)
  assert.match(source('components/pc-chat-panel/pc-chat-panel.vue'), /hasMessage && !this\.skipGreeting/)
  assert.deepStrictEqual(env.calls[2], { Name: 'Chat.MyChat.Limits', Content: { JobId: 'job-a', ResumeId: 'resume a' } })
  assert.deepStrictEqual(env.calls[3], { Name: 'Chat.Person.GetJobState', Content: { JobId: 'job-a' } })
  assert.deepStrictEqual(env.calls[4], { Name: 'Chat.ChatButton.Get', Content: { JobId: 'job-a', ResumeId: 'resume a' } })
  assert.equal(env.sentMessages[0].message.text, '好久没互动了，我对你简历很感兴趣，快来聊聊~')
  assert.equal(env.sentMessages[0].conversationId, 'p2p-a')
  assert.equal(env.sentMessages[env.sentMessages.length - 1].message.text, '好久没互动了，我对你简历很感兴趣，快来聊聊~')
  assert.deepStrictEqual(env.calls[5], {
    Name: 'Chat.MyChat.Limits', Content: { JobId: 'job-a', ResumeId: 'resume a' }
  })
  assert.equal(env.calls.length, 6)
  env.panelDef.beforeDestroy.call(panel)
}

async function verifyFailuresAndRaces() {
  for (const response of [{ Code: 1 }, { Code: 0, Data: { JobId: 'j' } },
    { Code: 0, Data: { JobId: 'j', ResumeId: 'r', PersonAccId: 'wrong' } },
    { Code: 0, Data: 'broken' }]) {
    const env = environment()
    env.request(async () => response)
    await env.page.selectConversation(conversation('a'))
    assert.equal(env.page.historyChatDetail, null)
    assert.equal(env.calls.length, 1)
    assert.equal(env.toasts.length, 1)
  }
  const env = environment(), a = deferred(), b = deferred()
  env.request(args => args.Content.PersonAccId === 'a' ? a.promise : b.promise)
  const first = env.page.selectConversation(conversation('a'))
  await env.page.selectConversation(conversation('a'))
  assert.equal(env.calls.length, 1)
  const second = env.page.selectConversation(conversation('b'))
  b.resolve({ Code: 0, Data: { JobId: 'b', ResumeId: 'b' } })
  await second
  a.resolve({ Code: 0, Data: { JobId: 'a', ResumeId: 'a' } })
  await first
  assert.equal(env.page.visibleSelectedId, 'p2p-b')
  assert.equal(env.page.selectedId, '')
  env.page.switchMainTab('recent')
  assert.equal(env.page.visibleSelectedId, '')
  env.page.switchMainTab('history')
  assert.equal(env.page.visibleSelectedId, 'p2p-b')

  for (const cancel of [page => page.switchMainTab('recent'), page => page.cancelOpeningConversation(),
    page => { page._conversationPageAlive = false }]) {
    const stale = environment(), pending = deferred()
    stale.request(() => pending.promise)
    const selecting = stale.page.selectConversation(conversation('a'))
    cancel(stale.page)
    pending.resolve({ Code: 0, Data: { JobId: 'j', ResumeId: 'r' } })
    await selecting
    assert.equal(stale.page.historyChatDetail, null)
  }

  for (const failure of [new Error('网络异常'), { Code: 1 }, { Code: 0, Data: { Code: 2, Rows: [] } },
    { Code: 0, Data: {} }]) {
    const failed = environment()
    await failed.page.selectConversation(conversation('a'))
    failed.request(async () => { if (failure instanceof Error) throw failure; return failure })
    const panel = failed.mount()
    await panel.loadMessages()
    assert.ok(panel.loadError)
    assert.equal(panel.canContinue, false)
    failed.request(async () => ({ Code: 0, Data: { Rows: [] } }))
    await panel.loadMessages()
    assert.equal(panel.loadError, '')
    assert.equal(panel.canContinue, true) // 无聊天记录的合法会话仍可继续。
    const count = failed.calls.length
    await panel.loadMessages()
    assert.equal(failed.calls.length, count)
    failed.panelDef.beforeDestroy.call(panel)
  }
  const destroyed = environment(), pending = deferred()
  await destroyed.page.selectConversation(conversation('a'))
  destroyed.request(() => pending.promise)
  const panel = destroyed.mount(), loading = panel.loadMessages()
  destroyed.panelDef.beforeDestroy.call(panel)
  pending.resolve({ Code: 0, Data: { Rows: [{ MsgType: 1, Msg: '旧会话' }] } })
  await loading
  assert.equal(panel.messages.length, 0)
}

async function verifyContinueJobState() {
  for (const state of [2, 3]) {
    const env = environment()
    env.page.historyChatDetail = { conversationId: 'history-a', jobId: 'job-a', resumeId: 'resume-a' }
    let stateCalls = 0
    env.request(async args => {
      if (args.Name === 'Chat.Person.GetJobState') {
        stateCalls++
        return { Code: 0, Data: { State: state } }
      }
      return { Code: 0, Data: { Rows: [] } }
    })
    const continuing = env.page.continueHistoryChat()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(env.page.historyJobPickerVisible, true)
    env.page.cancelHistoryJobPicker()
    await continuing
    assert.equal(stateCalls, 1)
    assert.deepStrictEqual(env.calls[0], { Name: 'Chat.MyChat.Limits', Content: { JobId: 'job-a', ResumeId: 'resume-a' } })
    assert.deepStrictEqual(env.calls[1], {
      Name: 'Chat.Person.GetJobState', Content: { JobId: 'job-a' }
    })
    assert.equal(env.page.activeMainTab, 'history')
    assert.equal(env.page.isContinuingHistoryChat, false)
    assert.equal(env.toasts.length, 0)
    assert.equal(env.sentMessages.length, 0)
  }

  const retry = environment()
  retry.page.historyChatDetail = { conversationId: 'history-a', jobId: 'job-a', resumeId: 'resume-a' }
  let attempts = 0
  retry.request(async args => {
    if (args.Name === 'Chat.ChatButton.Get') return { Code: 0, Data: { JobId: 'job-a' } }
    if (args.Name !== 'Chat.Person.GetJobState') return { Code: 0, Data: { Rows: [] } }
    attempts++
    if (attempts === 1) throw new Error('网络异常')
    return { Code: 0, Data: { State: 1 } }
  })
  await retry.page.continueHistoryChat()
  assert.equal(retry.page.activeMainTab, 'history')
  await retry.page.continueHistoryChat()
  assert.equal(retry.page.activeMainTab, 'recent')
  assert.equal(attempts, 2)
  assert.equal(retry.page.isContinuingHistoryChat, false)
}

async function verifyContinueJobSwitch() {
  const env = environment()
  env.page.historyChatDetail = {
    conversationId: 'p2p-a', jobId: 'job-current', resumeId: 'resume-a',
    personAccId: 'a', enterpriseAccId: 'enterprise', jobName: '旧职位'
  }
  env.request(async args => {
    if (args.Name === 'Chat.Person.GetJobState') return { Code: 0, Data: { State: 1 } }
    if (args.Name === 'Chat.ChatButton.Get') return { Code: 0, Data: { JobId: 'job-other' } }
    if (args.Name === 'Chat.Chat.ChangeJob') return {
      Code: 0, Data: { Enterprise: { JobId: 'job-current', JobName: '新职位', Location: '杭州', Salary: '20K', Tips: '已切换职位' } }
    }
    return { Code: 0, Data: { Rows: [] } }
  })

  await env.page.continueHistoryChat()
  assert.equal(env.modals.length, 1)
  assert.equal(env.modals[0].content, '是否切换聊天职位')
  assert.equal(env.modals[0].confirmText, '立即切换')
  assert.deepStrictEqual(env.calls, [
    { Name: 'Chat.MyChat.Limits', Content: { JobId: 'job-current', ResumeId: 'resume-a' } },
    { Name: 'Chat.Person.GetJobState', Content: { JobId: 'job-current' } },
    { Name: 'Chat.ChatButton.Get', Content: { JobId: 'job-current', ResumeId: 'resume-a' } },
    { Name: 'Chat.Chat.ChangeJob', Content: {
      PersonAccId: 'a', EnterpriseAccId: 'enterprise', JobId: 'job-current', IsMessage: true
    } },
    { Name: 'Chat.MyChat.Limits', Content: { JobId: 'job-current', ResumeId: 'resume-a' } }
  ])
  assert.equal(env.sentMessages.length, 2)
  assert.equal(env.sentMessages[0].conversationId, 'p2p-a')
  assert.deepStrictEqual(JSON.parse(env.sentMessages[0].message.attachment), {
    type: 5,
    data: { JobId: 'job-current', JobName: '新职位', Location: '杭州', Salary: '20K', Tips: '已切换职位' }
  })
  assert.equal(env.sentMessages[1].message.text, '好久没互动了，我对你简历很感兴趣，快来聊聊~')
  assert.equal(env.sentMessages[1].conversationId, 'p2p-a')
  assert.equal(env.page.activeMainTab, 'recent')
  assert.equal(env.page.chatDetail.jobName, '新职位')
  assert.equal(env.page.chatDetail.jobLocation, '杭州')
  assert.equal(env.page.chatDetail.jobSalary, '20K')
  assert.equal(env.page.chatDetail.skipGreeting, true)
}

async function verifyContinueSuccessStep() {
  const env = environment()
  env.page.historyChatDetail = {
    conversationId: 'p2p-a', conversation: conversation('a'), jobId: 'job-1', resumeId: 'resume-1',
    personAccId: 'a', enterpriseAccId: 'enterprise', skipInitialAccess: true
  }
  env.request(async args => args.Name === 'Chat.Person.GetJobState'
    ? { Code: 0, Data: { State: 1 } }
    : args.Name === 'Chat.ChatButton.Get'
      ? { Code: 0, Data: { JobId: 'job-1' } }
      : args.Name === 'Chat.MyChat.Limits'
        ? { Code: 0, Data: { SuccessStep: { Tips: '请先升级', StepName: '立即升级' } } }
        : { Code: 0, Data: {} })
  await env.page.continueHistoryChat()
  assert.equal(env.sentMessages.length, 0)
  assert.deepStrictEqual(env.calls.map(call => call.Name), ['Chat.MyChat.Limits'])
  assert.equal(env.page.activeMainTab, 'recent')
  assert.equal(env.page.chatDetail.skipInitialAccess, false)
  assert.equal(env.page.chatDetail.skipGreeting, true)
  assert.deepStrictEqual(env.page.chatDetail.initialAccess.Data.SuccessStep, {
    Tips: '请先升级', StepName: '立即升级'
  })
  // 使用真实聊天面板消费响应，确保已有会话的 skipInitialAccess 不会吞掉权限提示。
  const panelDef = loadComponent(source('components/pc-chat-panel/pc-chat-panel.vue'), {
    NIM_EMOJIS: [], uni: { showModal: options => env.modals.push(options) }
  })
  const panel = { _alive: true, detail: env.page.chatDetail, conversation: conversation('a'),
    drafts: {}, initialAccess: env.page.chatDetail.initialAccess, $emit() {} }
  Object.assign(panel, panelDef.data.call(panel))
  panel.handleSuccessStep = panelDef.methods.handleSuccessStep.bind(panel)
  await panelDef.methods.loadChatAccess.call(panel)
  assert.equal(panel.accessReady, false)
  assert.equal(env.modals[0].content, '请先升级')
  assert.equal(env.modals[0].confirmText, '立即升级')
}

async function verifyContinueEntryLimits() {
  const env = environment(), limits = deferred()
  env.page.historyChatDetail = { conversationId: 'p2p-a', jobId: 'job-a', resumeId: 'resume-a' }
  env.request(args => args.Name === 'Chat.MyChat.Limits' ? limits.promise
    : args.Name === 'Chat.Person.GetJobState' ? { Code: 0, Data: { State: 1 } }
      : { Code: 0, Data: { JobId: 'job-a' } })
  const continuing = env.page.continueHistoryChat()
  await env.page.continueHistoryChat()
  assert.equal(env.page.isContinuingHistoryChat, true)
  assert.deepStrictEqual(env.calls, [{ Name: 'Chat.MyChat.Limits', Content: { JobId: 'job-a', ResumeId: 'resume-a' } }])
  assert.equal(env.sentMessages.length, 0)
  limits.resolve({ Code: 0, Data: '{}' })
  await continuing
  assert.deepStrictEqual(env.calls.map(call => call.Name), [
    'Chat.MyChat.Limits', 'Chat.Person.GetJobState', 'Chat.ChatButton.Get', 'Chat.MyChat.Limits'
  ])
  assert.equal(env.sentMessages.length, 1)
  assert.equal(env.page.activeMainTab, 'recent')
  assert.equal(env.page.isContinuingHistoryChat, false)

  for (const failure of [new Error('网络异常'), { Code: 1, ErrorMessage: '当前不能沟通' },
    { Code: 0, Data: { Code: 2 } }, { Code: 0, Data: '{invalid' }]) {
    const failed = environment()
    failed.page.historyChatDetail = { conversationId: 'p2p-a', jobId: 'job-a', resumeId: 'resume-a' }
    failed.request(() => { if (failure instanceof Error) throw failure; return failure })
    await failed.page.continueHistoryChat()
    assert.deepStrictEqual(failed.calls.map(call => call.Name), ['Chat.MyChat.Limits'])
    assert.equal(failed.sentMessages.length, 0)
    assert.equal(failed.page.historyJobPickerVisible, false)
    assert.equal(failed.page.activeMainTab, 'history')
    assert.equal(failed.page.isContinuingHistoryChat, false)
    assert.equal(failed.toasts.length + failed.modals.length, 1)
    if (failure.ErrorMessage) assert.equal(failed.modals[0].content, failure.ErrorMessage)
    failed.request(async args => args.Name === 'Chat.Person.GetJobState' ? { Code: 0, Data: { State: 1 } }
      : args.Name === 'Chat.ChatButton.Get' ? { Code: 0, Data: { JobId: 'job-a' } } : { Code: 0, Data: {} })
    await failed.page.continueHistoryChat()
    assert.equal(failed.calls[1].Name, 'Chat.MyChat.Limits')
    assert.equal(failed.sentMessages.length, 1)
    assert.equal(failed.page.activeMainTab, 'recent')
  }

  // 入口校验通过后，发送前仍以最新 Limits 为准。
  const changed = environment()
  changed.page.historyChatDetail = { conversationId: 'p2p-a', jobId: 'job-a', resumeId: 'resume-a' }
  let checks = 0
  changed.request(args => args.Name === 'Chat.Person.GetJobState' ? { Code: 0, Data: { State: 1 } }
    : args.Name === 'Chat.ChatButton.Get' ? { Code: 0, Data: { JobId: 'job-a' } }
      : ++checks === 1 ? { Code: 0, Data: {} } : { Code: 1, ErrorMessage: '沟通权限已变更' })
  await changed.page.continueHistoryChat()
  assert.equal(checks, 2)
  assert.equal(changed.sentMessages.length, 0)
  assert.equal(changed.page.activeMainTab, 'history')
  assert.equal(changed.modals[0].content, '沟通权限已变更')
}

async function verifyContinueEntryRaces() {
  for (const response of [{ Code: 0, Data: {} }, { Code: 1, ErrorMessage: '过期提示' },
    { Code: 0, Data: { SuccessStep: { Tips: '过期权限提示' } } }]) {
    for (const cancel of [page => page.switchMainTab('recent'), page => { page.pageVisible = false },
      page => { page._conversationPageAlive = false }, page => page.cancelContinueHistory(),
      async page => {
        await page.selectConversation(conversation('b'))
        assert.equal(page.historyChatDetail.personAccId, 'b')
      }]) {
      const env = environment(), pending = deferred()
      env.page.historyChatDetail = { conversationId: 'p2p-a', jobId: 'job-a', resumeId: 'resume-a' }
      env.request(args => args.Name === 'Chat.MyChat.Limits' ? pending.promise
        : { Code: 0, Data: { JobId: 'job-b', ResumeId: 'resume-b' } })
      const continuing = env.page.continueHistoryChat()
      await cancel(env.page)
      pending.resolve(response)
      await continuing
      assert.equal(env.calls[0].Name, 'Chat.MyChat.Limits')
      assert.equal(env.calls.some(call => ['Chat.Person.GetJobState', 'Chat.ChatButton.Get', 'Chat.Chat.ChangeJob'].includes(call.Name)), false)
      assert.equal(env.sentMessages.length, 0)
      assert.equal(env.toasts.length + env.modals.length, 0)
      assert.equal(env.page.chatDetail, null)
      assert.equal(env.page.isContinuingHistoryChat, false)
    }
  }
}

const timeout = setTimeout(() => { throw new Error('pc chat history detail tests timed out') }, 10000)
Promise.resolve().then(verifyFlow).then(verifyFailuresAndRaces).then(verifyContinueJobState)
  .then(verifyContinueJobSwitch).then(verifyContinueSuccessStep)
  .then(verifyContinueEntryLimits).then(verifyContinueEntryRaces).then(() => {
  clearTimeout(timeout)
  console.log('pc chat history detail tests passed')
}).catch(error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
