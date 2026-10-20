// node tests/pc-chat-history-detail.cjs：内存模拟业务接口，验证 PC 历史详情顺序和继续聊天，不操作真实账号。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
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
      : args.Name === 'Chat.ChatButton.Get' ? { Code: 0, Data: { JobId: 'job-a' } } : history.promise)
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
  assert.deepStrictEqual(env.calls[2], { Name: 'Chat.Person.GetJobState', Content: { JobId: 'job-a' } })
  assert.deepStrictEqual(env.calls[3], { Name: 'Chat.ChatButton.Get', Content: { JobId: 'job-a', ResumeId: 'resume a' } })
  assert.equal(env.sentMessages[0].message.text, '好久没互动了，我对你简历很感兴趣，快来聊聊~')
  assert.equal(env.sentMessages[0].conversationId, 'p2p-a')
  assert.equal(env.calls.length, 4) // 浏览记录不触发权限、已读或发送接口。
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
    await env.page.continueHistoryChat()
    assert.equal(stateCalls, 1)
    assert.deepStrictEqual(env.calls[0], {
      Name: 'Chat.Person.GetJobState', Content: { JobId: 'job-a' }
    })
    assert.equal(env.page.activeMainTab, 'history')
    assert.equal(env.page.isContinuingHistoryChat, false)
    assert.match(env.toasts[0], state === 3 ? /招满/ : /失效/)
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
    { Name: 'Chat.Person.GetJobState', Content: { JobId: 'job-current' } },
    { Name: 'Chat.ChatButton.Get', Content: { JobId: 'job-current', ResumeId: 'resume-a' } },
    { Name: 'Chat.Chat.ChangeJob', Content: {
      PersonAccId: 'a', EnterpriseAccId: 'enterprise', JobId: 'job-current', IsMessage: true
    } }
  ])
  assert.equal(env.sentMessages.length, 1)
  assert.equal(env.sentMessages[0].conversationId, 'p2p-a')
  assert.deepStrictEqual(JSON.parse(env.sentMessages[0].message.attachment), {
    type: 5,
    data: { JobId: 'job-current', JobName: '新职位', Location: '杭州', Salary: '20K', Tips: '已切换职位' }
  })
  assert.equal(env.page.activeMainTab, 'recent')
  assert.equal(env.page.chatDetail.jobName, '新职位')
  assert.equal(env.page.chatDetail.jobLocation, '杭州')
  assert.equal(env.page.chatDetail.jobSalary, '20K')
  assert.equal(env.page.chatDetail.skipGreeting, true)
}

Promise.resolve().then(verifyFlow).then(verifyFailuresAndRaces).then(verifyContinueJobState)
  .then(verifyContinueJobSwitch).then(() => {
  console.log('pc chat history detail tests passed')
}).catch(error => { console.error(error); process.exitCode = 1 })
