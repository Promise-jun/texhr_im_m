// node tests/mobile-chat-history-detail.cjs：内存模拟业务接口、云信和导航，不发送真实消息。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const detailSource = source('pages/person/m/detail.vue')
const singleDetail = { JobId: 'job &1', ResumeId: 'resume/2', IsTop: true, ChatByQRcode: 'qr' }
const textRow = { Accid: 'enterprise-1', Icon: 'avatar.png', Name: '企业', Msg: '你好[大笑]', MsgType: 1, ShowTime: '昨天 10:00', IsMySend: false }
const availableJob = { JobId: 'selected &3', JobName: '纺织工程师', Location: '金华', Salary: '8-12K' }

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function loadPage(relative, globals) {
  const context = vm.createContext({ ...globals, module: { exports: {} } })
  const script = source(relative).match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports =')
  vm.runInContext(script, context)
  const definition = context.module.exports
  const page = definition.data()
  for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)
  for (const [name, getter] of Object.entries(definition.computed || {})) {
    Object.defineProperty(page, name, { get: getter.bind(page) })
  }
  return { definition, page }
}

function environment() {
  const calls = [], navigation = [], toasts = [], previews = [], players = [], modals = [], sent = [], events = []
  const listeners = new Map()
  const state = { loggedIn: true, account: 'person-1', loginError: null, back: 0, relaunch: '' }
  let request = async args => {
    if (args.Name === 'Chat.Chat.GetSingleChat') return { Code: 0, Data: singleDetail }
    if (args.Name === 'Chat.Person.GetJobState') return { Code: 0, Data: { State: 1 } }
    if (args.Name === 'Chat.ChatButton.Get') return { Code: 0, Data: { JobId: singleDetail.JobId, ToAccId: 'enterprise-1' } }
    if (args.Name === 'Chat.Chat.ChangeJob') return { Code: 0, Data: { Enterprise: { JobId: singleDetail.JobId, JobName: '当前职位' } } }
    if (args.Name === 'Chat.Chat.GetJobList') return { Code: 0, Data: { Rows: [availableJob] } }
    return { Code: 0, Data: { Code: 0, Rows: [textRow] } }
  }
  const globals = {
    console: { error() {}, warn() {} }, setTimeout, clearTimeout,
    UniPopup: {},
    NIM_EVENT: { LOGIN_STATUS: 'login-status', LOGIN_FAILED: 'login-failed' },
    getNimLoginError: () => state.loginError,
    isNimLoggedIn: () => state.loggedIn,
    getNimInstance: () => nim,
    getCurrentPages: () => [{}, {}],
    requestApi: args => { calls.push(plain(args)); events.push(args.Name); return request(args) },
    uni: {
      getSystemInfoSync: () => ({ statusBarHeight: 24 }),
      $on: (event, callback) => listeners.set(event, callback),
      $off: (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event) },
      navigateTo: options => navigation.push(options),
      showModal: options => modals.push(options),
      showToast: options => toasts.push(options),
      showLoading() {}, hideLoading() {},
      navigateBack: () => { state.back++ },
      reLaunch: options => { state.relaunch = options.url },
      previewImage: options => previews.push(options),
      createInnerAudioContext: () => {
        const player = {
          played: 0, stopped: 0, destroyed: 0,
          onEnded(callback) { this.end = callback },
          onError(callback) { this.error = callback },
          play() { this.played++ }, stop() { this.stopped++ }, destroy() { this.destroyed++ }
        }
        players.push(player)
        return player
      }
    }
  }
  let send = async message => ({ message })
  const nim = {
    V2NIMLoginService: { getLoginUser: () => state.account },
    V2NIMConversationIdUtil: { p2pConversationId: id => `p2p-${id}` },
    V2NIMMessageCreator: {
      createCustomMessage: (text, body) => ({ kind: 'custom', text, body }),
      createTextMessage: text => ({ kind: 'text', text })
    },
    V2NIMMessageService: { sendMessage: (message, conversationId) => {
      sent.push({ message, conversationId }); events.push(message.kind)
      return send(message, conversationId)
    } }
  }
  const service = vm.createContext({ ...globals })
  vm.runInContext(source('services/nim-emoji.js').replace(/^export /gm, ''), service)
  vm.runInContext(source('services/chat-history.js').replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), service)
  globals.getHistoryChatDetail = service.getHistoryChatDetail
  globals.getHistoryChatMessages = service.getHistoryChatMessages
  globals.getHistoryChatJobState = service.getHistoryChatJobState
  globals.getHistoryChatButton = service.getHistoryChatButton
  globals.changeHistoryChatJob = service.changeHistoryChatJob
  globals.getHistoryChatJobList = service.getHistoryChatJobList
  const loaded = loadPage('pages/person/m/detail.vue', globals)
  loaded.page.$nextTick = callback => Promise.resolve().then(callback)
  const popup = {
    opened: [], closed: 0,
    open(type) { this.opened.push(type); loaded.page.handleJobPickerChange({ show: true }) },
    close() { this.closed++; loaded.page.handleJobPickerChange({ show: false }) }
  }
  loaded.page.$refs = { jobPicker: popup }
  return {
    ...loaded, globals, service, state, calls, navigation, toasts, previews, players, listeners, modals, sent, events, nim, popup,
    request: handler => { request = handler },
    send: handler => { send = handler },
    emit: (event, payload) => listeners.get(event)?.(payload),
    enter: options => loaded.definition.onLoad.call(loaded.page, options || { Accid: 'enterprise-1' })
  }
}

async function verifyService() {
  const env = environment()
  const detail = await env.service.getHistoryChatDetail(' person-1 ', ' enterprise-1 ')
  assert.deepStrictEqual(env.calls[0], {
    Name: 'Chat.Chat.GetSingleChat', Content: { PersonAccId: 'person-1', EnterpriseAccId: 'enterprise-1' }
  })
  assert.deepStrictEqual(plain(detail), { ...singleDetail, PersonAccId: 'person-1', EnterpriseAccId: 'enterprise-1' })
  const messages = await env.service.getHistoryChatMessages(detail.PersonAccId, detail.EnterpriseAccId)
  assert.deepStrictEqual(env.calls[1], {
    Name: 'Chat.Chat.GetSessionContent', Content: { fromAccid: 'person-1', toAccid: 'enterprise-1' }
  })
  assert.equal(messages[0].segments[1].type, 'emoji')
  assert.equal(messages[0].avatar, 'avatar.png')
  assert.equal(messages[0].time, '昨天 10:00')

  env.request(async () => ({ Code: '0', Data: JSON.stringify({ ...singleDetail, PersonAccId: 'server-person', EnterpriseAccId: 'server-enterprise' }) }))
  assert.equal((await env.service.getHistoryChatDetail('person', 'enterprise')).EnterpriseAccId, 'server-enterprise')
  env.request(async () => ({ Code: 0, Data: '{}', JobId: 42, ResumeId: 24 }))
  assert.equal((await env.service.getHistoryChatDetail('person', 'enterprise')).JobId, '42')

  for (const [response, expected] of [
    [{ Code: 9 }, /业务错误码/],
    [{ Code: 0, Data: { Code: 2 } }, /数据错误码/],
    [{ Code: 0, Data: '{invalid' }, /有效 JSON/],
    [{ Code: 0, Data: [] }, /数据格式/],
    [{ Code: 0, Data: { JobId: 'job' } }, /ResumeId/]
  ]) {
    env.request(async () => response)
    await assert.rejects(env.service.getHistoryChatDetail('person', 'enterprise'), expected)
  }
  env.request(async () => ({ Code: 0, Data: { Rows: null } }))
  await assert.rejects(env.service.getHistoryChatMessages('person', 'enterprise'), /Rows/)
  const before = env.calls.length
  await assert.rejects(env.service.getHistoryChatDetail('', 'enterprise'), /账号/)
  await assert.rejects(env.service.getHistoryChatMessages('person', ''), /账号/)
  assert.equal(env.calls.length, before)

  const job = { JobId: 'job-1', JobName: '工程师', status: true }
  const rows = [
    textRow,
    { ...textRow, IsMySend: 'false' },
    { ...textRow, IsMySend: 'true' },
    { MsgType: 2, Msg: 'https://example.test/image.png' },
    { MsgType: 2, Msg: JSON.stringify({ url: 'image-2.png' }) },
    { MsgType: 3, Msg: JSON.stringify({ attachment: { url: 'audio.mp3', duration: 2501 } }) },
    { MsgType: 4, Msg: JSON.stringify({ type: 4, data: JSON.stringify({ Enterprise: job }) }) },
    { MsgType: 5, Msg: { data: job } },
    { MsgType: 2, Msg: { broken: true } },
    { MsgType: 5, Msg: '{invalid' },
    { MsgType: 99, Msg: 'unknown' },
    null
  ]
  env.request(async () => ({ Code: 0, Data: JSON.stringify({ Code: 0, Rows: rows }) }))
  const normalized = await env.service.getHistoryChatMessages('person', 'enterprise')
  assert.equal(normalized.length, 11)
  assert.deepStrictEqual(plain(normalized.map(message => message.type)), [
    'text', 'text', 'text', 'image', 'image', 'audio', 'job-card', 'job-card', 'text', 'text', 'text'
  ])
  assert.equal(normalized[1].direction, 'other')
  assert.equal(normalized[2].direction, 'self')
  assert.equal(normalized[3].avatar, '/static/default_avatar.png')
  assert.equal(normalized[4].url, 'image-2.png')
  assert.equal(normalized[5].durationSeconds, 3)
  assert.deepStrictEqual(plain(normalized[6].job), job)
  assert.equal(normalized[8].content, '[图片]')
  assert.equal(normalized[9].content, '[职位变更]')
  assert.equal(normalized[0].id, 'history-0')
  assert.equal(normalized[1].id, 'history-1') // 同一 Accid 的多条消息不能被去重。
  assert.match(env.service.normalizeHistoryMessage({ ...textRow, ShowTime: '2020-08-13T10:53:00' }, 0).time, /^2020年08月13日 10:53$/)
  assert.equal(env.service.normalizeHistoryMessage({ ...textRow, ShowTime: 'bad date' }, 0).time, 'bad date')
}

async function verifyDetailFlow() {
  const env = environment()
  const first = deferred(), second = deferred()
  env.request(args => args.Name === 'Chat.Chat.GetSingleChat' ? first.promise : second.promise)
  const entered = env.enter()
  const repeated = env.page.loadHistoryDetail()
  env.emit('login-status', 1)
  assert.equal(env.calls.length, 1)
  assert.equal(env.page.canContinueChat, false)
  first.resolve({ Code: 0, Data: { ...singleDetail, PersonAccId: 'returned-person', EnterpriseAccId: 'returned-enterprise' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.calls.length, 2)
  assert.deepStrictEqual(env.calls[1].Content, { fromAccid: 'returned-person', toAccid: 'returned-enterprise' })
  second.resolve({ Code: 0, Data: { Rows: [] } })
  await Promise.all([entered, repeated])
  assert.equal(env.page.messages.length, 0)
  assert.equal(env.page.canContinueChat, true)
  assert.equal(env.page.scrollTopStyle, 'calc(24px + 88rpx)')
  env.emit('login-status', 1)
  await env.page.loadHistoryDetail()
  assert.equal(env.calls.length, 2) // 成功的空记录也缓存，重复登录通知不重复请求。

  const delayed = environment()
  delayed.state.loggedIn = false
  await delayed.enter({ accid: 'enterprise-1' })
  assert.equal(delayed.calls.length, 0)
  assert.equal(delayed.page.isWaitingForNim, true)
  delayed.emit('login-failed', { message: '连接失败' })
  assert.equal(delayed.page.loadError, '连接失败')
  delayed.state.loggedIn = true
  delayed.emit('login-status', 1)
  await delayed.page.loadHistoryDetail()
  assert.equal(delayed.calls.length, 2)
  assert.equal(delayed.page.loadError, '')

  const missing = environment()
  await missing.enter({})
  missing.page.continueChat()
  assert.equal(missing.calls.length, 0)
  assert.equal(missing.navigation.length, 0)
  assert.match(missing.page.loadError, /对方会话账号/)

  const retry = environment()
  retry.request(async args => {
    if (args.Name === 'Chat.Chat.GetSingleChat') return { Code: 0, Data: singleDetail }
    throw new Error('网络异常')
  })
  await retry.enter()
  assert.equal(retry.page.loadError, '网络异常')
  retry.request(async () => ({ Code: 0, Data: { Rows: [textRow] } }))
  await retry.page.loadHistoryDetail()
  assert.equal(retry.calls.filter(call => call.Name === 'Chat.Chat.GetSingleChat').length, 1)
  assert.equal(retry.calls.filter(call => call.Name === 'Chat.Chat.GetSessionContent').length, 2)
  assert.equal(retry.page.messages.length, 1)
  assert.equal(retry.page.scrollIntoView, 'history-message-bottom')

  for (const stage of ['detail', 'messages']) {
    const unloaded = environment(), pendingResponse = deferred()
    unloaded.request(async args => {
      if (stage === 'messages' && args.Name === 'Chat.Chat.GetSingleChat') return { Code: 0, Data: singleDetail }
      return pendingResponse.promise
    })
    const pending = unloaded.enter()
    await new Promise(resolve => setImmediate(resolve))
    unloaded.definition.onUnload.call(unloaded.page)
    pendingResponse.resolve(stage === 'detail' ? { Code: 0, Data: singleDetail } : { Code: 0, Data: { Rows: [textRow] } })
    await pending
    assert.equal(unloaded.listeners.size, 0)
    assert.equal(unloaded.page.messages.length, 0)
    assert.equal(unloaded.calls.length, stage === 'detail' ? 1 : 2)
    unloaded.page.continueChat()
    assert.equal(unloaded.navigation.length, 0)
  }
}

async function verifyEntryAndMedia() {
  const env = environment()
  const list = loadPage('pages/person/m/list.vue', env.globals).page
  env.state.loggedIn = false
  await list.openConversation({ id: 'history', targetId: 'company &1', isHistory: true })
  assert.equal(env.navigation[0].url, '/pages/person/m/detail?Accid=company%20%261')
  await list.openConversation({ id: 'history', targetId: 'company &1', isHistory: true })
  assert.equal(env.navigation.length, 1)
  assert.equal(env.calls.length, 0)
  env.navigation[0].complete()
  await list.openConversation({ id: 'bad', isHistory: true })
  assert.match(env.toasts[0].title, /对方会话账号/)
  await list.openConversation({ id: 'recent', targetId: 'company' })
  assert.equal(env.toasts[1].title, '聊天服务尚未就绪')
  env.state.loggedIn = true
  await list.openConversation({ id: 'recent', targetId: 'company' })
  assert.equal(env.calls.length, 1)
  assert.equal(env.calls[0].Name, 'Chat.Chat.GetSingleChat')
  assert.equal(env.navigation[1].url, '/pages/person/m/chat?jobId=job%20%261&resumeId=resume%2F2')

  await env.enter()
  env.page.messages = [{ id: 'image-1', type: 'image', url: 'image-1.png' }, { id: 'image-2', type: 'image', url: 'image-2.png' }]
  env.page.previewImage('image-2.png')
  assert.deepStrictEqual(plain(env.previews[0]), { current: 'image-2.png', urls: ['image-1.png', 'image-2.png'] })
  env.page.handleAvatarError({ id: 'image-1' })
  env.page.handleAvatarError({ id: 'image-1' })
  assert.equal(env.page.failedAvatarIds.length, 1)
  const audio = { id: 'audio-1', url: 'audio-1.mp3' }
  env.page.playAudioMessage(audio)
  assert.equal(env.players[0].played, 1)
  env.page.playAudioMessage(audio)
  assert.equal(env.players[0].destroyed, 1)
  assert.equal(env.page.audioPlayingId, '')
  env.page.playAudioMessage(audio)
  env.page.playAudioMessage({ id: 'audio-2', url: 'audio-2.mp3' })
  env.players[1].error() // 已被替换的播放器回调不能影响正在播放的语音。
  assert.equal(env.page.audioPlayingId, 'audio-2')
  env.players[2].end()
  assert.equal(env.page.audioPlayingId, '')
  env.page.playAudioMessage(audio)
  env.definition.onHide.call(env.page)
  assert.equal(env.players[3].stopped, 1)
  assert.equal(env.players[3].destroyed, 1)
  env.page.playAudioMessage(audio)
  env.players[4].error()
  assert.equal(env.toasts[env.toasts.length - 1].title, '语音播放失败，请重试')
  assert.equal(env.page.audioPlayingId, '')
}

async function verifyInitialScroll() {
  const env = environment()
  await env.enter()
  assert.equal(env.page.scrollIntoView, 'history-message-bottom')
  // 图片异步撑高消息区域后，仍定位最新消息。
  env.page.scrollToBottom()
  await Promise.resolve()
  assert.equal(env.page.scrollIntoView, 'history-message-bottom')
  // 用户手动查看历史消息后，图片加载和重复登录通知不再重置阅读位置。
  env.page.stopInitialAutoScroll()
  env.page.scrollIntoView = ''
  env.page.scrollToBottom()
  env.emit('login-status', 1)
  await Promise.resolve()
  assert.equal(env.page.scrollIntoView, '')
  assert.equal(env.calls.length, 2)

  const unloaded = environment()
  await unloaded.enter()
  unloaded.page.scrollToBottom()
  unloaded.definition.onUnload.call(unloaded.page)
  await Promise.resolve()
  assert.equal(unloaded.page.scrollIntoView, '')
}

async function verifyJobState() {
  const env = environment()
  await env.enter()
  assert.equal(env.calls.length, 2) // 进入页面不自动查询职位状态。
  const pendingState = deferred()
  env.request(args => args.Name === 'Chat.Person.GetJobState' ? pendingState.promise
    : Promise.resolve({ Code: 0, Data: { Rows: [availableJob] } }))
  const pending = env.page.continueChat()
  await env.page.continueChat()
  assert.equal(env.calls.length, 3)
  assert.deepStrictEqual(env.calls[2], {
    Name: 'Chat.Person.GetJobState', Content: { JobId: singleDetail.JobId }
  })
  assert.equal(env.page.isContinuingChat, true)
  assert.equal(env.page.jobState, null)
  pendingState.resolve({ Code: 0, Data: { State: 2 } })
  await flush()
  assert.equal(env.page.isJobPickerVisible, true)
  assert.equal(env.page.jobList[0].JobId, availableJob.JobId)
  env.page.closeJobPicker()
  await pending
  assert.equal(env.page.jobState, 2)
  assert.equal(env.page.isContinuingChat, false)
  assert.equal(env.toasts.length, 0)
  assert.equal(env.navigation.length, 0)

  // 再次点击查询最新值，不能缓存上次正常状态；兼容 JSON Data 和字符串状态。
  for (const state of [2, 3]) {
    env.request(async args => ({ Code: '0', Data: JSON.stringify(args.Name === 'Chat.Person.GetJobState'
      ? { State: String(state) } : { Rows: [availableJob] }) }))
    const choosing = env.page.continueChat()
    await flush()
    assert.equal(env.page.jobState, state)
    assert.equal(env.page.isJobPickerVisible, true)
    assert.deepStrictEqual(env.calls[env.calls.length - 1], {
      Name: 'Chat.Chat.GetJobList', Content: { accid: 'enterprise-1', Start: 0, pageSize: 50 }
    })
    env.page.handleJobPickerChange({ show: false }) // 点击遮罩也取消选择。
    await choosing
    assert.equal(env.navigation.length, 0)
    assert.equal(env.sent.length, 0)
  }
  const callCount = env.calls.length
  for (const [response, expected] of [
    [{ Code: 9 }, /业务错误码/],
    [{ Code: 0, Data: { Code: 2 } }, /数据错误码/],
    [{ Code: 0, Data: '{invalid' }, /有效 JSON/],
    [{ Code: 0, Data: { State: 4 } }, /State/],
    [{ Code: 0, Data: {} }, /State/]
  ]) {
    env.request(async () => response)
    await env.page.continueChat()
    assert.equal(env.page.jobState, null)
    assert.equal(env.page.isContinuingChat, false)
    assert.match(env.toasts[env.toasts.length - 1].title, expected)
  }
  assert.equal(env.calls.length, callCount + 5)
  env.request(async () => { throw new Error('网络异常') })
  await env.page.continueChat()
  assert.equal(env.toasts[env.toasts.length - 1].title, '网络异常')
  const beforeInvalid = env.calls.length
  await assert.rejects(env.service.getHistoryChatJobState(''), /职位信息/)
  env.page.isLoading = true
  await env.page.continueChat()
  assert.equal(env.calls.length, beforeInvalid)

  // 离开详情页后到达的成功和失败响应，不更新状态或弹出提示。
  for (const success of [true, false]) {
    const unloaded = environment(), late = deferred()
    await unloaded.enter()
    unloaded.request(() => late.promise)
    const request = unloaded.page.continueChat()
    unloaded.definition.onUnload.call(unloaded.page)
    if (success) late.resolve({ Code: 0, Data: { State: 2 } })
    else late.reject(new Error('late error'))
    await request
    assert.equal(unloaded.page.jobState, null)
    assert.equal(unloaded.toasts.length, 0)
    assert.equal(unloaded.navigation.length, 0)
  }
}

async function verifyContinueService() {
  const env = environment()
  await env.service.getHistoryChatButton(` ${singleDetail.JobId} `, ` ${singleDetail.ResumeId} `)
  assert.deepStrictEqual(env.calls[0], {
    Name: 'Chat.ChatButton.Get', Content: { JobId: singleDetail.JobId, ResumeId: singleDetail.ResumeId }
  })
  env.request(async () => ({ Code: 0, Data: JSON.stringify({ JobId: 42, ToAccId: ' returned ' }) }))
  assert.deepStrictEqual(plain(await env.service.getHistoryChatButton('page-job', 'resume')), { JobId: '42', ToAccId: 'returned' })
  const card = { JobId: singleDetail.JobId, JobName: '当前职位', EnterpriseTime: '职位已变更', Tips: '提示' }
  env.request(async () => ({ Code: 0, Data: { Enterprise: card } }))
  assert.deepStrictEqual(plain(await env.service.changeHistoryChatJob(' person ', ' enterprise ', singleDetail.JobId)), card)
  assert.deepStrictEqual(env.calls[2], {
    Name: 'Chat.Chat.ChangeJob',
    Content: { PersonAccId: 'person', EnterpriseAccId: 'enterprise', JobId: singleDetail.JobId, IsMessage: true }
  })
  env.request(async () => ({ Code: 0, Data: '{}', Enterprise: card }))
  assert.deepStrictEqual(plain(await env.service.changeHistoryChatJob('person', 'enterprise', 'job')), card)
  for (const [response, expected] of [
    [{ Code: 9 }, /业务错误码/],
    [{ Code: 0, Data: { Code: 9 } }, /数据错误码/],
    [{ Code: 0, Data: '{invalid' }, /有效 JSON/],
    [{ Code: 0, Data: [] }, /数据格式/],
    [{ Code: 0, Data: {} }, /JobId/]
  ]) {
    env.request(async () => response)
    await assert.rejects(env.service.getHistoryChatButton('job', 'resume'), expected)
  }
  for (const enterprise of [null, [], 'invalid', undefined]) {
    env.request(async () => ({ Code: 0, Data: { Enterprise: enterprise } }))
    await assert.rejects(env.service.changeHistoryChatJob('person', 'enterprise', 'job'), /Enterprise/)
  }
  const before = env.calls.length
  await assert.rejects(env.service.getHistoryChatButton('', 'resume'), /职位或简历/)
  await assert.rejects(env.service.changeHistoryChatJob('', 'enterprise', 'job'), /所需信息/)
  assert.equal(env.calls.length, before)
}

async function verifyJobListService() {
  const env = environment()
  env.request(async () => ({ Code: '0', Data: JSON.stringify({ Rows: [
    availableJob, { JobId: 42, JobName: ' ' }, null, [], {}, { JobId: ' ' }
  ] }) }))
  const jobs = plain(await env.service.getHistoryChatJobList(' enterprise-1 '))
  assert.deepStrictEqual(env.calls[0], {
    Name: 'Chat.Chat.GetJobList', Content: { accid: 'enterprise-1', Start: 0, pageSize: 50 }
  })
  assert.equal(jobs.length, 2)
  assert.deepStrictEqual(jobs[0], { ...availableJob, key: `job-${availableJob.JobId}-0` })
  assert.deepStrictEqual(jobs[1], { JobId: '42', key: 'job-42-1', JobName: '未命名职位', Location: '-', Salary: '-' })
  for (const [response, expected] of [
    [{ Code: 9 }, /业务错误码/],
    [{ Code: 0, Data: { Code: 9 } }, /数据错误码/],
    [{ Code: 0, Data: '{invalid' }, /有效 JSON/],
    [{ Code: 0, Data: [] }, /数据格式/],
    [{ Code: 0, Data: { Rows: null } }, /Rows/]
  ]) {
    env.request(async () => response)
    await assert.rejects(env.service.getHistoryChatJobList('enterprise-1'), expected)
  }
  env.request(async () => ({ Code: 0, Data: { Rows: [] } }))
  assert.equal((await env.service.getHistoryChatJobList('enterprise-1')).length, 0)
  const before = env.calls.length
  await assert.rejects(env.service.getHistoryChatJobList(' '), /企业会话账号/)
  assert.equal(env.calls.length, before)
}

const flush = () => new Promise(resolve => setImmediate(resolve))
const continuedUrl = `/pages/person/m/chat?jobId=${encodeURIComponent(singleDetail.JobId)}&resumeId=${encodeURIComponent(singleDetail.ResumeId)}&skipGreeting=1`
const selectedUrl = `/pages/person/m/chat?jobId=${encodeURIComponent(availableJob.JobId)}&resumeId=${encodeURIComponent(singleDetail.ResumeId)}&skipGreeting=1`
function jobPickerRequest(args, state = 2) {
  if (args.Name === 'Chat.Person.GetJobState') return Promise.resolve({ Code: 0, Data: { State: state } })
  if (args.Name === 'Chat.Chat.GetJobList') return Promise.resolve({ Code: 0, Data: { Rows: [availableJob] } })
  if (args.Name === 'Chat.Chat.ChangeJob') return Promise.resolve({ Code: 0, Data: {
    Enterprise: { ...availableJob, JobId: args.Content.JobId, EnterpriseTime: '职位已变更', Tips: '保留接口字段' }
  } })
  throw new Error(`unexpected API: ${args.Name}`)
}

async function verifyJobPickerFlow() {
  for (const state of [2, 3]) {
    const env = environment(), list = deferred(), custom = deferred(), text = deferred()
    await env.enter()
    env.request(args => args.Name === 'Chat.Chat.GetJobList' ? list.promise : jobPickerRequest(args, state))
    env.send(message => message.kind === 'custom' ? custom.promise : text.promise)
    const continuing = env.page.continueChat()
    await flush()
    assert.deepStrictEqual(env.popup.opened, ['bottom'])
    assert.equal(env.page.isLoadingJobs, true)
    // 加载中连点继续聊聊/重试/列表，都不能发起额外请求或提前选择。
    await env.page.continueChat()
    await env.page.loadHistoryJobList()
    env.page.selectHistoryChatJob(availableJob)
    assert.equal(env.calls.length, 4)
    assert.equal(env.sent.length, 0)
    list.resolve({ Code: 0, Data: { Rows: [availableJob] } })
    await flush()
    assert.equal(env.page.isLoadingJobs, false)
    env.page.selectHistoryChatJob(env.page.jobList[0])
    env.page.selectHistoryChatJob(env.page.jobList[0])
    await flush()
    assert.equal(env.page.isJobPickerVisible, false)
    assert.equal(env.page.isChoosingJob, false)
    assert.equal(env.modals.length, 0)
    assert.deepStrictEqual(env.calls[4], {
      Name: 'Chat.Chat.ChangeJob', Content: {
        PersonAccId: 'person-1', EnterpriseAccId: 'enterprise-1', JobId: availableJob.JobId, IsMessage: true
      }
    })
    assert.deepStrictEqual(JSON.parse(env.sent[0].message.body), {
      type: 5, data: { ...availableJob, EnterpriseTime: '职位已变更', Tips: '保留接口字段' }
    })
    assert.equal(env.sent[0].conversationId, 'p2p-enterprise-1')
    assert.equal(env.sent.length, 1)
    assert.equal(env.navigation.length, 0)
    await env.page.continueChat()
    custom.resolve({ message: env.sent[0].message })
    await flush()
    assert.equal(env.sent[1].message.text, '我正在求职，请问贵公司还招人吗？')
    assert.equal(env.navigation.length, 0) // 文本回执前不跳转。
    text.resolve({ message: env.sent[1].message })
    await flush()
    assert.deepStrictEqual(env.events.slice(2), [
      'Chat.Person.GetJobState', 'Chat.Chat.GetJobList', 'Chat.Chat.ChangeJob', 'custom', 'text'
    ])
    assert.equal(env.navigation[0].url, selectedUrl)
    assert.equal(env.page.chatDetail.JobId, singleDetail.JobId)
    env.navigation[0].success()
    await continuing
  }
}

async function verifyJobPickerCancellationAndRetry() {
  const env = environment()
  await env.enter()
  let listAttempts = 0
  env.request(args => {
    if (args.Name === 'Chat.Chat.GetJobList' && listAttempts++ === 0) return Promise.reject(new Error('职位列表网络异常'))
    return jobPickerRequest(args)
  })
  const choosing = env.page.continueChat()
  await flush()
  assert.equal(env.page.jobListError, '职位列表网络异常')
  assert.equal(env.page.isContinuingChat, true)
  await env.page.loadHistoryJobList()
  assert.equal(env.page.jobListError, '')
  assert.equal(env.page.jobList.length, 1)
  env.page.closeJobPicker()
  await choosing
  assert.equal(env.page.isContinuingChat, false)
  assert.equal(env.sent.length, 0)
  assert.equal(env.navigation.length, 0)

  // 空列表保留弹窗，关闭后可重新查询；旧请求不能覆盖下一次打开的列表。
  for (const lateError of [false, true]) {
    const late = deferred()
    env.request(args => args.Name === 'Chat.Chat.GetJobList' ? late.promise : jobPickerRequest(args))
    const first = env.page.continueChat()
    await flush()
    env.page.closeJobPicker()
    await first
    env.request(args => args.Name === 'Chat.Chat.GetJobList'
      ? Promise.resolve({ Code: 0, Data: { Rows: [] } }) : jobPickerRequest(args))
    const second = env.page.continueChat()
    await flush()
    if (lateError) late.reject(new Error('迟到错误'))
    else late.resolve({ Code: 0, Data: { Rows: [availableJob] } })
    await flush()
    assert.equal(env.page.jobList.length, 0)
    assert.equal(env.page.jobListError, '')
    assert.equal(env.page.isLoadingJobs, false)
    assert.equal(env.page.isJobPickerVisible, true)
    env.page.closeJobPicker()
    await second
  }

  // 卸载时解除等待，晚到的列表成功/失败响应不能更新页面。
  for (const success of [true, false]) {
    const unloaded = environment(), late = deferred()
    await unloaded.enter()
    unloaded.request(args => args.Name === 'Chat.Chat.GetJobList' ? late.promise : jobPickerRequest(args))
    const continuing = unloaded.page.continueChat()
    await flush()
    unloaded.definition.onUnload.call(unloaded.page)
    await continuing
    if (success) late.resolve({ Code: 0, Data: { Rows: [availableJob] } })
    else late.reject(new Error('迟到错误'))
    await flush()
    assert.equal(unloaded.page.jobList.length, 0)
    assert.equal(unloaded.page.jobListError, '')
    assert.equal(unloaded.sent.length, 0)
    assert.equal(unloaded.toasts.length, 0)
  }

  // 同一职位重试仅补发失败步骤，切换到另一职位时重新发送该职位的卡片。
  for (const stage of ['custom', 'text', 'navigation']) {
    const retry = environment()
    await retry.enter()
    retry.request(jobPickerRequest)
    let failOnce = true
    retry.send(async message => {
      if (message.kind === stage && failOnce) { failOnce = false; throw new Error('发送失败') }
      return { message }
    })
    const first = retry.page.continueChat()
    await flush()
    retry.page.selectHistoryChatJob(retry.page.jobList[0])
    await flush()
    if (stage === 'navigation') retry.navigation[0].fail()
    await first
    const second = retry.page.continueChat()
    await flush()
    retry.page.selectHistoryChatJob(retry.page.jobList[0])
    await flush()
    assert.equal(retry.calls.filter(call => call.Name === 'Chat.Chat.ChangeJob').length, 1)
    assert.equal(retry.sent.filter(item => item.message.kind === 'custom').length, stage === 'custom' ? 2 : 1)
    assert.equal(retry.sent.filter(item => item.message.kind === 'text').length, stage === 'text' ? 2 : 1)
    if (stage === 'navigation') {
      retry.navigation[1].fail()
      await second
      retry.request(args => args.Name === 'Chat.Chat.GetJobList'
        ? Promise.resolve({ Code: 0, Data: { Rows: [{ ...availableJob, JobId: 'another-job' }] } }) : jobPickerRequest(args))
      const third = retry.page.continueChat()
      await flush()
      retry.page.selectHistoryChatJob(retry.page.jobList[0])
      await flush()
      assert.equal(retry.calls.filter(call => call.Name === 'Chat.Chat.ChangeJob').length, 2)
      assert.equal(retry.sent.length, 4)
      assert.match(retry.navigation[2].url, /jobId=another-job/)
      retry.navigation[2].success()
      await third
    } else {
      retry.navigation[0].success()
      await second
    }
  }
}

function mismatchRequest(args) {
  if (args.Name === 'Chat.Person.GetJobState') return Promise.resolve({ Code: 0, Data: { State: 1 } })
  if (args.Name === 'Chat.ChatButton.Get') return Promise.resolve({ Code: 0, Data: { JobId: 'old-job', ToAccId: 'enterprise-1' } })
  if (args.Name === 'Chat.Chat.ChangeJob') return Promise.resolve({ Code: 0, Data: { Enterprise: { JobId: singleDetail.JobId, JobName: '页面职位' } } })
  throw new Error(`unexpected API: ${args.Name}`)
}
function confirmSwitch(env, confirm = true) {
  const modal = env.modals[env.modals.length - 1]
  modal.success({ confirm, cancel: !confirm })
  modal.complete()
}

async function verifyContinueFlow() {
  const matched = environment()
  await matched.enter()
  const first = matched.page.continueChat()
  await flush()
  assert.deepStrictEqual(matched.events.slice(2), ['Chat.Person.GetJobState', 'Chat.ChatButton.Get', 'text'])
  assert.equal(matched.modals.length, 0)
  assert.equal(matched.sent[0].conversationId, 'p2p-enterprise-1')
  assert.equal(matched.sent[0].message.text, '我正在求职，请问贵公司还招人吗？')
  assert.equal(matched.navigation[0].url, continuedUrl)
  assert.equal(matched.page.isContinuingChat, true)
  await matched.page.continueChat()
  assert.equal(matched.sent.length, 1)
  matched.navigation[0].success()
  await first
  await matched.page.continueChat()
  assert.equal(matched.sent.length, 1) // 跳转完成前后的连点均不能重复发送。
  matched.definition.onShow.call(matched.page)
  assert.equal(matched.page.isContinuingChat, false)
  assert.equal(matched.page._pendingContinueChat, null)

  const changed = environment(), customReceipt = deferred()
  await changed.enter()
  changed.request(mismatchRequest)
  changed.send(message => message.kind === 'custom' ? customReceipt.promise : Promise.resolve({ message }))
  const continuing = changed.page.continueChat()
  await flush()
  assert.equal(changed.modals[0].content, '是否切换聊天职位')
  assert.equal(changed.modals[0].confirmText, '立即切换')
  assert.equal(changed.calls.length, 4)
  assert.equal(changed.sent.length, 0)
  await changed.page.continueChat()
  assert.equal(changed.calls.length, 4)
  confirmSwitch(changed)
  await flush()
  assert.deepStrictEqual(changed.calls[4], {
    Name: 'Chat.Chat.ChangeJob', Content: { PersonAccId: 'person-1', EnterpriseAccId: 'enterprise-1', JobId: singleDetail.JobId, IsMessage: true }
  })
  assert.deepStrictEqual(JSON.parse(changed.sent[0].message.body), {
    type: 5, data: { JobId: singleDetail.JobId, JobName: '页面职位' }
  })
  assert.equal(changed.sent.length, 1)
  assert.equal(changed.navigation.length, 0)
  customReceipt.resolve({ message: changed.sent[0].message })
  await flush()
  assert.deepStrictEqual(changed.events.slice(2), ['Chat.Person.GetJobState', 'Chat.ChatButton.Get', 'Chat.Chat.ChangeJob', 'custom', 'text'])
  assert.equal(changed.sent[1].message.text, '我正在求职，请问贵公司还招人吗？')
  assert.equal(changed.sent[1].conversationId, changed.sent[0].conversationId)
  assert.equal(changed.navigation[0].url, continuedUrl)
  changed.navigation[0].success()
  await continuing

  const cancelled = environment()
  await cancelled.enter()
  cancelled.request(mismatchRequest)
  const cancelling = cancelled.page.continueChat()
  await flush()
  confirmSwitch(cancelled, false)
  await cancelling
  assert.equal(cancelled.calls.length, 4)
  assert.equal(cancelled.sent.length, 0)
  assert.equal(cancelled.navigation.length, 0)
  assert.equal(cancelled.page.isContinuingChat, false)

  // 缺少 JobId、接口失败和未登录均不发送消息、不跳转。
  for (const stage of ['button', 'switch', 'login']) {
    const failed = environment()
    await failed.enter()
    failed.request(args => {
      if (stage === 'button' && args.Name === 'Chat.ChatButton.Get') return Promise.resolve({ Code: 0, Data: {} })
      if (stage === 'switch' && args.Name === 'Chat.Chat.ChangeJob') return Promise.resolve({ Code: 9 })
      return mismatchRequest(args)
    })
    if (stage === 'login') failed.state.loggedIn = false
    const failing = failed.page.continueChat()
    await flush()
    if (failed.modals.length) confirmSwitch(failed)
    await failing
    assert.equal(failed.sent.length, 0)
    assert.equal(failed.navigation.length, 0)
    assert.equal(failed.toasts.length, 1)
    assert.equal(failed.page.isContinuingChat, false)
    if (stage === 'login') assert.equal(failed.calls.length, 4) // SDK 未就绪时不切换业务职位。
  }
}

async function verifyContinueRetryAndUnload() {
  // 自定义消息失败保留切换结果；文本失败保留自定义回执；跳转失败保留两条回执。
  for (const stage of ['custom', 'text', 'navigation']) {
    const env = environment()
    await env.enter()
    env.request(mismatchRequest)
    let failOnce = true
    env.send(async message => {
      if (message.kind === stage && failOnce) { failOnce = false; throw new Error('发送失败') }
      return { message }
    })
    const first = env.page.continueChat()
    await flush()
    confirmSwitch(env)
    await flush()
    if (stage === 'navigation') env.navigation[0].fail()
    await first
    assert.equal(env.page.isContinuingChat, false)
    assert.equal(env.calls.filter(call => call.Name === 'Chat.Chat.ChangeJob').length, 1)
    const retry = env.page.continueChat()
    await flush()
    assert.equal(env.modals.length, 1)
    assert.equal(env.calls.filter(call => call.Name === 'Chat.Chat.ChangeJob').length, 1)
    assert.equal(env.sent.filter(item => item.message.kind === 'custom').length, stage === 'custom' ? 2 : 1)
    assert.equal(env.sent.filter(item => item.message.kind === 'text').length, stage === 'text' ? 2 : 1)
    env.navigation[env.navigation.length - 1].success()
    await retry
  }

  for (const stage of ['button', 'modal', 'switch', 'custom', 'text']) {
    const env = environment(), late = deferred()
    await env.enter()
    env.request(args => {
      if ((stage === 'button' && args.Name === 'Chat.ChatButton.Get') ||
        (stage === 'switch' && args.Name === 'Chat.Chat.ChangeJob')) return late.promise
      return mismatchRequest(args)
    })
    env.send(message => message.kind === stage ? late.promise : Promise.resolve({ message }))
    const pending = env.page.continueChat()
    await flush()
    if (stage !== 'button' && stage !== 'modal') { confirmSwitch(env); await flush() }
    env.definition.onUnload.call(env.page)
    const sendsBefore = env.sent.length
    if (stage === 'button') late.resolve({ Code: 0, Data: { JobId: 'old-job' } })
    if (stage === 'switch') late.resolve({ Code: 0, Data: { Enterprise: { JobId: singleDetail.JobId } } })
    if (stage === 'custom' || stage === 'text') late.resolve({ message: {} })
    if (stage === 'modal') confirmSwitch(env) // 已卸载弹窗的迟到确认不能切换或发送。
    await pending
    assert.equal(env.navigation.length, 0)
    assert.equal(env.sent.length, sendsBefore)
    assert.equal(env.toasts.length, 0)
  }
}

async function verify() {
  await verifyService()
  await verifyDetailFlow()
  await verifyEntryAndMedia()
  await verifyInitialScroll()
  await verifyJobState()
  await verifyContinueService()
  await verifyJobListService()
  await verifyJobPickerFlow()
  await verifyJobPickerCancellationAndRetry()
  await verifyContinueFlow()
  await verifyContinueRetryAndUnload()
  console.log('mobile chat history detail tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
