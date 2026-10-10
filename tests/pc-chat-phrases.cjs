// node tests/pc-chat-phrases.cjs：常用语接口和云信发送均使用内存模拟，不向真实账号发消息。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'module.exports =')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function environment() {
  const calls = [], sends = [], toasts = [], changes = []
  const state = { loggedIn: true, prepares: 0 }
  let request = async () => ({ Code: 0, Data: { Rows: [] } })
  let send = async (message, conversationId) => ({ message: {
    ...message, conversationId, messageClientId: `sent-${sends.length}`, messageType: 0,
    createTime: sends.length, senderId: 'enterprise', isSelf: true
  } })
  const nim = {
    V2NIMUserService: { checkBlock: async accounts => ({ [accounts[0]]: false }) },
    V2NIMMessageCreator: { createTextMessage: text => ({ text }) },
    V2NIMMessageService: { sendMessage: (message, id) => {
      sends.push({ text: message.text, conversationId: id })
      return send(message, id)
    } }
  }
  const context = vm.createContext({ module: { exports: {} }, console: { warn() {} },
    NIM_EMOJIS: [], getNimInstance: () => nim, isNimLoggedIn: () => state.loggedIn,
    uni: { showToast: value => toasts.push(value.title), showModal() {} },
    requestApi: args => { calls.push(args); return request(args) } })
  vm.runInContext(script, context)
  const def = context.module.exports
  const panel = { conversation: { name: '模拟人才', stickTop: false }, detail: { conversationId: 'a' },
    jobId: 'job', resumeId: 'resume', enterpriseAccId: 'enterprise', personAccId: 'a',
    drafts: { a: '尚未发送的草稿', b: '另一个会话的草稿' }, visible: true, opening: false,
    _alive: true, $set: (obj, key, value) => { obj[key] = value },
    $nextTick: fn => Promise.resolve().then(fn), $emit: event => changes.push(event) }
  Object.assign(panel, def.data.call(panel))
  for (const [name, method] of Object.entries(def.methods)) panel[name] = method.bind(panel)
  for (const [name, getter] of Object.entries(def.computed)) {
    Object.defineProperty(panel, name, typeof getter === 'function' ? { get: getter.bind(panel) }
      : { get: getter.get.bind(panel), set: getter.set.bind(panel) })
  }
  panel.prepareConversation = () => { state.prepares++ }
  panel.accessReady = true
  return { panel, calls, sends, toasts, changes, state,
    request: fn => { request = fn }, send: fn => { send = fn } }
}

async function verify() {
  const env = environment(), { panel } = env
  const rows = [
    { Id: 'normal', Msg: '  您好，请介绍一下工作经历。  ', IsTop: false },
    { Id: 'top-a', Msg: '您好，方便沟通吗？', IsTop: true },
    null, { Id: 'blank', Msg: '  ' }, { Id: 'invalid', Msg: 123 },
    { Msg: '收到，谢谢。', IsTop: false },
    { Id: 'top-b', Msg: '欢迎进一步沟通。[大笑]', IsTop: true }
  ]
  env.request(async args => args.Name === 'Chat.MyChat.Limits'
    ? { Code: 0, Data: { JobName: '后端工程师' } } : { Code: 0, Data: { Rows: rows } })
  await panel.loadChatAccess()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(env.calls[0].Name, 'Chat.MyChat.Limits')
  assert.equal(panel.jobName, '后端工程师')
  assert.equal(env.calls[1].Name, 'Chat.CommonLanguage.Get')
  assert.equal(env.calls[1].Content, '')
  assert.equal(env.state.prepares, 1)
  assert.equal(panel.commonPhrases.map(item => item.key).join(','), 'top-a,top-b,normal,phrase-5')
  assert.equal(panel.commonPhrases[2].message, '您好，请介绍一下工作经历。')
  assert.equal(panel.commonPhrasesLoaded, true)
  assert.equal(panel.isLoadingCommonPhrases, false)
  console.log('PASS: entering an allowed conversation loads Msg/Id/IsTop rows; blank content is filtered and pinned order is stable')

  env.request(async args => args.Name === 'Chat.Chat.GetJobList'
    ? { Code: 0, Data: { Rows: [
      { JobId: 7, JobName: '后端工程师', Location: '深圳', Salary: '20-30K' },
      { Id: 'job-8', Name: '前端工程师', Area: '上海', SalaryText: '15-25K' }
    ] } } : { Code: 0, Data: { Rows: [] } })
  panel.emitAction('switch-job', '切换职位')
  await new Promise(resolve => setTimeout(resolve, 0))
  const jobCall = env.calls.find(item => item.Name === 'Chat.Chat.GetJobList')
  assert.deepEqual(jobCall.Content, { Start: 0, pageSize: 50 })
  assert.deepEqual(panel.jobList.map(item => `${item.name}-${item.location}-${item.salary}`), [
    '后端工程师-深圳-20-30K', '前端工程师-上海-15-25K'
  ])
  assert.equal(panel.jobPickerVisible, true)
  panel.closeJobPicker()
  assert.equal(panel.jobPickerVisible, false)
  console.log('PASS: switching jobs requests the first 50 jobs and formats name, location and salary')

  env.request(async args => args.Name === 'Chat.Chat.GetJobList'
    ? { Code: 0, Data: { Rows: [] } } : { Code: 0, Data: { Rows: [] } })
  await panel.loadJobList()
  assert.equal(panel.jobPickerVisible, true)
  assert.equal(panel.jobList.length, 0)
  console.log('PASS: an empty job response keeps the picker open for the publish prompt')

  const loading = environment(), response = deferred()
  loading.request(() => response.promise)
  const loadPromise = loading.panel.loadCommonPhrases()
  loading.panel.togglePhrasePanel()
  await loading.panel.loadCommonPhrases()
  assert.equal(loading.calls.length, 1)
  assert.equal(loading.panel.isLoadingCommonPhrases, true)
  response.resolve({ Code: 0, Data: JSON.stringify({ Rows: [] }) }); await loadPromise
  assert.equal(loading.panel.commonPhrasesLoaded, true)
  loading.panel.togglePhrasePanel(); loading.panel.togglePhrasePanel()
  assert.equal(loading.calls.length, 1)
  loading.panel.toggleEmojiPanel()
  assert.equal(loading.panel.phrasesVisible, false)
  assert.equal(loading.panel.emojiVisible, true)
  loading.panel.togglePhrasePanel()
  assert.equal(loading.panel.emojiVisible, false)
  assert.equal(loading.panel.phrasesVisible, true)
  loading.panel.closeComposerPanels()
  assert.equal(loading.panel.phrasesVisible, false)
  console.log('PASS: concurrent loads share one request, an empty list is cached, and emoji/phrase popovers are mutually exclusive')

  for (const invalidResponse of [null, { Code: 1 }, { Code: 0, Data: {} },
    { Code: 0, Data: { Rows: null } }, { Code: 0, Data: { Code: 1, Rows: [] } },
    { Code: 0, Data: '{invalid json' }]) {
    env.request(async () => invalidResponse)
    await panel.loadCommonPhrases()
    assert.equal(panel.commonPhrasesLoaded, false)
    assert.equal(panel.commonPhrases.length, 0)
    assert.match(panel.commonPhrasesError, /点击重试/)
    assert.equal(panel.isLoadingCommonPhrases, false)
  }
  env.request(async () => { throw new Error('network failed') })
  await panel.loadCommonPhrases()
  assert.match(panel.commonPhrasesError, /点击重试/)
  env.request(async () => ({ Code: 0, Data: { Rows: rows } }))
  await panel.loadCommonPhrases()
  assert.equal(panel.commonPhrasesError, '')
  assert.equal(panel.commonPhrases.length, 4)
  const abandoned = environment(), stale = deferred()
  abandoned.request(() => stale.promise)
  const oldLoad = abandoned.panel.loadCommonPhrases()
  abandoned.panel._alive = false
  stale.resolve({ Code: 0, Data: { Rows: rows } }); await oldLoad
  assert.equal(abandoned.panel.commonPhrases.length, 0)
  await abandoned.panel.loadCommonPhrases()
  assert.equal(abandoned.calls.length, 1)
  console.log('PASS: invalid responses and network errors show retry; retry recovers and destroyed conversations ignore pending responses')

  panel.phrasesVisible = true
  const phrase = panel.commonPhrases[1]
  await panel.sendCommonPhrase(phrase)
  assert.equal(env.sends[0].text, phrase.message)
  assert.equal(env.sends[0].conversationId, 'a')
  assert.equal(panel.messages[0].text, phrase.message)
  assert.equal(panel.phrasesVisible, false)
  assert.equal(panel.draft, '尚未发送的草稿')
  assert.equal(panel.drafts.b, '另一个会话的草稿')
  assert.equal(panel.sendingPhraseKey, '')
  assert.equal(panel.isSending, false)
  assert.equal(env.changes[0], 'changed')
  console.log('PASS: clicking sends the full phrase through NIM, merges its receipt, refreshes the conversation and preserves both drafts')

  const sending = deferred()
  env.send(() => sending.promise)
  panel.phrasesVisible = true
  const inFlight = panel.sendCommonPhrase(phrase)
  assert.equal(panel.isSending, true)
  assert.equal(panel.sendingPhraseKey, phrase.key)
  const duplicate = panel.sendCommonPhrase(phrase)
  const normalWhileSending = panel.sendMessage()
  await new Promise(resolve => setImmediate(resolve)) // 发送前先完成异步黑名单查询。
  assert.equal(env.sends.length, 2)
  await duplicate
  await normalWhileSending
  panel.draft = '发送期间追加的草稿'
  sending.reject(new Error('模拟发送失败，请重试')); await inFlight
  assert.match(env.toasts[0], /模拟发送失败/)
  assert.equal(panel.phrasesVisible, true)
  assert.equal(panel.isSending, false)
  assert.equal(panel.sendingPhraseKey, '')
  assert.equal(panel.draft, '发送期间追加的草稿')
  env.send(async (message, conversationId) => ({ message: {
    ...message, conversationId, messageClientId: 'retry-success', messageType: 0, createTime: 9
  } }))
  await panel.sendCommonPhrase(phrase)
  assert.equal(panel.phrasesVisible, false)
  assert.equal(panel.draft, '发送期间追加的草稿')
  console.log('PASS: phrases and normal messages share the send lock; a failed phrase stays available for retry without changing a draft')

  const sendsBefore = env.sends.length
  for (const flag of ['visible', 'accessReady']) {
    panel[flag] = false
    await panel.sendCommonPhrase(phrase)
    panel[flag] = true
  }
  panel.opening = true; await panel.sendCommonPhrase(phrase); panel.opening = false
  env.state.loggedIn = false; await panel.sendCommonPhrase(phrase); env.state.loggedIn = true
  await panel.sendCommonPhrase(null)
  await panel.sendCommonPhrase({ key: 'empty', message: '  ' })
  assert.equal(env.sends.length, sendsBefore)
  const switching = deferred(), oldDraft = panel.draft
  env.send(() => switching.promise)
  const previousMessages = panel.messages.length, previousChanges = env.changes.length
  const oldSend = panel.sendCommonPhrase(phrase)
  panel._alive = false
  switching.resolve({ message: { text: phrase.message, conversationId: 'a', messageClientId: 'late', createTime: 10 } })
  await oldSend
  assert.equal(panel.messages.length, previousMessages)
  assert.equal(env.changes.length, previousChanges)
  assert.equal(panel.drafts.a, oldDraft)
  assert.equal(panel.drafts.b, '另一个会话的草稿')
  console.log('PASS: hidden, blocked, opening, logged-out and blank sends are ignored; late send receipts cannot affect another conversation')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
