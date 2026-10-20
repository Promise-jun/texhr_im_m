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

function environment(options = {}) {
  const calls = [], sends = [], toasts = [], changes = [], actions = [], modals = [], opened = []
  const state = { loggedIn: true, prepares: 0, historyLoads: 0, browserBack: 0, uniBack: 0 }
  let request = async () => ({ Code: 0, Data: { Rows: [] } })
  let send = async (message, conversationId) => ({ message: {
    ...message, conversationId, messageClientId: `sent-${sends.length}`, messageType: 0,
    createTime: sends.length, senderId: 'enterprise', isSelf: true
  } })
  const nim = {
    V2NIMUserService: { checkBlock: async accounts => ({ [accounts[0]]: false }) },
    V2NIMMessageCreator: {
      createTextMessage: text => ({ text }),
      createCustomMessage: (text, raw) => ({ text, raw, messageType: 100, attachment: { raw } })
    },
    V2NIMMessageService: { sendMessage: (message, id) => {
      sends.push({ text: message.text, raw: message.raw, conversationId: id })
      return send(message, id)
    } }
  }
  const context = vm.createContext({ module: { exports: {} }, console: { warn() {} },
    NIM_EMOJIS: [], getNimInstance: () => nim, isNimLoggedIn: () => state.loggedIn,
    uni: { showToast: value => toasts.push(value.title), showModal: value => modals.push(value),
      navigateBack: () => { state.uniBack++ } },
    ...(options.browser === false ? {} : { window: {
      history: { back: () => { state.browserBack++ } },
      open: (url, target) => { opened.push({ url, target }); return options.popupBlocked ? null : {} }
    } }),
    requestApi: args => { calls.push(args); return request(args) } })
  vm.runInContext(script, context)
  const def = context.module.exports
  const panel = { conversation: { name: '模拟人才', stickTop: false }, detail: { conversationId: 'a' },
    jobId: 'job', resumeId: 'resume', enterpriseAccId: 'enterprise', personAccId: 'a',
    drafts: { a: '尚未发送的草稿', b: '另一个会话的草稿' }, visible: true, opening: false,
    _alive: true, $set: (obj, key, value) => { obj[key] = value },
    $nextTick: fn => Promise.resolve().then(fn), $emit: (event, payload) => {
      if (event === 'action') actions.push(payload)
      else changes.push(event)
    } }
  Object.assign(panel, def.data.call(panel))
  for (const [name, method] of Object.entries(def.methods)) panel[name] = method.bind(panel)
  for (const [name, getter] of Object.entries(def.computed)) {
    Object.defineProperty(panel, name, typeof getter === 'function' ? { get: getter.bind(panel) }
      : { get: getter.get.bind(panel), set: getter.set.bind(panel) })
  }
  panel.loadEarlierMessages = () => { state.historyLoads++ }
  panel.prepareConversation = () => { state.prepares++; panel.loadEarlierMessages(true) }
  panel.accessReady = true
  return { panel, calls, sends, toasts, changes, actions, modals, opened, state, nim,
    request: fn => { request = fn }, send: fn => { send = fn } }
}

function greetingEnvironment(limitsResponse = { Code: 0, Data: { JobId: 'job', Message: { Person: { PersonName: '模拟人才' } } } },
  greetingResponse = { Code: 0, Data: { Greetings: '您好，方便聊聊吗？' } }) {
  const env = environment()
  env.request(async args => {
    if (args.Name === 'Chat.MyChat.Limits') return limitsResponse
    if (args.Name === 'Chat.ChatButton.Get') return greetingResponse
    return { Code: 0, Data: { Rows: [] } }
  })
  return env
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

  const greeting = environment()
  const originalHistory = { messageClientId: 'history', conversationId: 'a', createTime: 0, text: '原有聊天记录' }
  const limitsMessage = { Person: { PersonName: '模拟人才' }, JobId: 'job', JobName: '后端工程师' }
  greeting.panel.messages = [originalHistory]
  greeting.panel._oldestHistoryMessage = originalHistory
  greeting.panel.historyExhausted = true
  greeting.request(async args => {
    if (args.Name === 'Chat.MyChat.Limits') {
      return { Code: 0, Data: { JobId: 'job', Message: limitsMessage } }
    }
    if (args.Name === 'Chat.ChatButton.Get') {
      return { Code: 0, Data: { Greetings: '您好，方便聊聊这个职位吗？' } }
    }
    return { Code: 0, Data: { Rows: [] } }
  })
  await greeting.panel.loadChatAccess()
  await new Promise(resolve => setTimeout(resolve, 0))
  const greetingCall = greeting.calls.find(item => item.Name === 'Chat.ChatButton.Get')
  assert.deepEqual(greetingCall.Content, { ResumeId: 'resume' })
  assert.equal(greeting.sends.length, 2)
  assert.deepEqual(JSON.parse(greeting.sends[0].raw), { type: 4, data: limitsMessage })
  assert.equal(greeting.sends[1].raw, undefined)
  assert.equal(greeting.sends[1].text, '您好，方便聊聊这个职位吗？')
  assert.equal(greeting.sends[0].conversationId, 'a')
  assert.equal(greeting.sends[1].conversationId, 'a')
  assert.equal(greeting.panel.messages.length, 3)
  assert.equal(greeting.panel.messages[0], originalHistory)
  assert.equal(greeting.panel._oldestHistoryMessage, originalHistory)
  assert.equal(greeting.panel.historyExhausted, true)
  assert.equal(greeting.panel.draft, '尚未发送的草稿')
  assert.equal(greeting.state.historyLoads, 1)
  assert.equal(greeting.modals.length, 0)
  console.log('PASS: matching jobs request Greetings by ResumeId and send the type=4 custom message before the text greeting')

  const rootGreeting = greetingEnvironment(
    { Code: 0, Data: '{}', JobId: ' job ', Message: '{"Person":{"PersonName":"字符串内容"}}' },
    { Code: 0, Data: '{}', Greetings: '  原样保留招呼语  ' })
  await rootGreeting.panel.loadChatAccess()
  assert.deepEqual(JSON.parse(rootGreeting.sends[0].raw), {
    type: 4, data: '{"Person":{"PersonName":"字符串内容"}}'
  })
  assert.equal(rootGreeting.sends[1].text, '  原样保留招呼语  ')

  for (const limitsData of [
    { JobId: 'job' }, { JobId: 'job', Message: null }, { JobId: 'job', Message: '' },
    { JobId: 'job', Message: '  ' }, { Message: '无职位' }, { JobId: 'another-job', Message: '职位不一致' },
    { JobId: 'job', Message: '有权限提示', SuccessStep: { Tips: '请完善信息' } },
    { JobId: 'job', Message: '账号不一致', PersonAccId: 'another-person' }
  ]) {
    const ignored = greetingEnvironment({ Code: 0, Data: limitsData })
    await ignored.panel.loadChatAccess()
    assert.equal(ignored.calls.some(item => item.Name === 'Chat.ChatButton.Get'), false)
    assert.equal(ignored.sends.length, 0)
  }
  for (const invalid of [null, { Code: 1 }, { Code: 0, Data: '{invalid json' }, { Code: 0, Data: null },
    { Code: 0, Data: { Code: 1, Greetings: '错误的招呼语' } }, { Code: 0, Data: {} },
    { Code: 0, Data: { Greetings: '  ' } }]) {
    const failed = greetingEnvironment(undefined, invalid)
    await failed.panel.loadChatAccess()
    assert.equal(failed.sends.length, 0)
    assert.equal(failed.panel.accessReady, true)
    assert.equal(failed.panel.accessError, '')
    assert.equal(failed.state.historyLoads, 1)
    assert.equal(failed.toasts.length, 1)
  }
  console.log('PASS: string/root payloads preserve their original content; unmatched jobs, empty Message and failed Greetings requests cannot send greetings')

  const sequence = greetingEnvironment(), customReceipt = deferred()
  sequence.send((message, conversationId) => message.raw ? customReceipt.promise : Promise.resolve({ message: {
    ...message, conversationId, messageClientId: 'greeting-text', createTime: 2
  } }))
  const sequenceLoad = sequence.panel.loadChatAccess()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sequence.sends.length, 1)
  assert.equal(sequence.panel.isSending, true)
  const concurrentGreeting = sequence.panel.sendPendingChatGreeting()
  customReceipt.resolve({ message: {
    conversationId: 'a', messageClientId: 'greeting-custom', createTime: 1, messageType: 100
  } })
  await Promise.all([sequenceLoad, concurrentGreeting])
  assert.equal(sequence.sends.length, 2)
  await sequence.panel.loadChatAccess()
  sequence.panel.handleLoginStatus(1)
  await sequence.panel.sendPendingChatGreeting()
  assert.equal(sequence.sends.length, 2)
  assert.equal(sequence.calls.filter(item => item.Name === 'Chat.ChatButton.Get').length, 1)
  console.log('PASS: the text waits for the custom receipt; concurrent sends, permission rechecks and login events do not duplicate successful greetings')

  const offline = greetingEnvironment()
  offline.state.loggedIn = false
  await offline.panel.loadChatAccess()
  assert.equal(offline.sends.length, 0)
  offline.state.loggedIn = true
  offline.panel.handleLoginStatus(1)
  await offline.panel.sendPendingChatGreeting()
  assert.equal(offline.sends.length, 2)
  assert.equal(offline.calls.filter(item => item.Name === 'Chat.ChatButton.Get').length, 1)

  const busyGreeting = greetingEnvironment(), ordinaryReceipt = deferred()
  busyGreeting.send((message, conversationId) => message.text === '先发普通消息' ? ordinaryReceipt.promise
    : Promise.resolve({ message: { ...message, conversationId, messageClientId: `busy-${busyGreeting.sends.length}` } }))
  const ordinarySend = busyGreeting.panel.sendTextMessage('先发普通消息')
  await new Promise(resolve => setImmediate(resolve))
  await busyGreeting.panel.loadChatAccess()
  assert.equal(busyGreeting.sends.length, 1)
  ordinaryReceipt.resolve({ message: { conversationId: 'a', messageClientId: 'ordinary', text: '先发普通消息' } })
  await ordinarySend
  await busyGreeting.panel.sendPendingChatGreeting()
  assert.equal(busyGreeting.sends.length, 3)
  assert.equal(JSON.parse(busyGreeting.sends[1].raw).type, 4)
  assert.equal(busyGreeting.sends[2].text, '您好，方便聊聊吗？')
  console.log('PASS: greetings wait for NIM login or an occupied send lock and resume without fetching Greetings again')

  for (const failure of ['custom', 'text']) {
    const retry = greetingEnvironment()
    retry.send(async (message, conversationId) => {
      if ((failure === 'custom' && message.raw) || (failure === 'text' && !message.raw)) throw { code: 102426 }
      return { message: { ...message, conversationId, messageClientId: `retry-${retry.sends.length}` } }
    })
    await retry.panel.loadChatAccess()
    assert.equal(retry.sends.length, failure === 'custom' ? 1 : 2)
    assert.equal(retry.toasts[retry.toasts.length - 1], '该人才已屏蔽您的消息，暂不能发送消息')
    retry.send(async (message, conversationId) => ({ message: {
      ...message, conversationId, messageClientId: `retry-${retry.sends.length}`
    } }))
    await retry.panel.sendPendingChatGreeting()
    assert.equal(retry.sends.length, 3)
    assert.equal(retry.sends.filter(item => item.raw).length, failure === 'custom' ? 2 : 1)
    assert.equal(retry.panel.draft, '尚未发送的草稿')
    assert.equal(retry.panel.isSending, false)
  }
  console.log('PASS: a failed custom send stops the text; retrying a failed text does not repeat the successful custom message and preserves the draft')

  const staleCheck = greetingEnvironment(), pendingBlockCheck = deferred()
  staleCheck.nim.V2NIMUserService.checkBlock = () => pendingBlockCheck.promise
  const staleCheckLoad = staleCheck.panel.loadChatAccess()
  await new Promise(resolve => setImmediate(resolve))
  staleCheck.panel.resumeId = 'another-resume'
  pendingBlockCheck.resolve({ a: false })
  await staleCheckLoad
  assert.equal(staleCheck.sends.length, 0)

  const staleGreeting = environment(), pendingGreeting = deferred()
  staleGreeting.request(async args => {
    if (args.Name === 'Chat.MyChat.Limits') {
      return { Code: 0, Data: { JobId: 'job', Message: { JobId: 'job' } } }
    }
    if (args.Name === 'Chat.ChatButton.Get') return pendingGreeting.promise
    return { Code: 0, Data: { Rows: [] } }
  })
  const staleGreetingLoad = staleGreeting.panel.loadChatAccess()
  await new Promise(resolve => setImmediate(resolve))
  staleGreeting.panel.jobId = 'another-job'
  pendingGreeting.resolve({ Code: 0, Data: { Greetings: '迟到的招呼语' } })
  await staleGreetingLoad
  assert.equal(staleGreeting.sends.length, 0)
  assert.equal(staleGreeting.toasts.length, 0)
  console.log('PASS: a late Greetings response cannot send messages after the active job changes')

  const mismatch = environment()
  const historyMessage = { messageClientId: 'history', conversationId: 'a', createTime: 0, text: '原有聊天记录' }
  mismatch.panel.messages = [historyMessage]
  mismatch.panel._oldestHistoryMessage = historyMessage
  mismatch.panel.historyExhausted = true
  mismatch.request(async args => {
    if (args.Name === 'Chat.MyChat.Limits') {
      return { Code: 0, Data: { JobId: 'old-job', JobName: '旧聊天职位' } }
    }
    if (args.Name === 'Chat.Chat.ChangeJob') {
      return { Code: 0, Data: { Enterprise: {
        JobId: 'job', JobName: '页面职位', Tips: '已切换至页面职位'
      } } }
    }
    return { Code: 0, Data: { Rows: [] } }
  })
  await mismatch.panel.loadChatAccess()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(mismatch.modals.length, 1)
  assert.equal(mismatch.modals[0].content, '是否切换聊天职位')
  assert.equal(mismatch.modals[0].confirmText, '立即切换')
  assert.equal(mismatch.state.historyLoads, 1)
  await mismatch.modals[0].success({ cancel: true })
  assert.equal(mismatch.sends.length, 0)
  assert.equal(mismatch.calls.some(item => item.Name === 'Chat.Chat.ChangeJob'), false)
  await mismatch.modals[0].success({ confirm: true })
  const automaticChangeCall = mismatch.calls.find(item => item.Name === 'Chat.Chat.ChangeJob')
  assert.deepEqual(automaticChangeCall.Content, {
    PersonAccId: 'a', EnterpriseAccId: 'enterprise', JobId: 'job', IsMessage: true
  })
  assert.deepEqual(JSON.parse(mismatch.sends[0].raw), {
    type: 5, data: { JobId: 'job', JobName: '页面职位', Tips: '已切换至页面职位' }
  })
  assert.equal(mismatch.sends.length, 1)
  assert.equal(mismatch.sends[0].conversationId, 'a')
  assert.equal(mismatch.panel.messages.length, 2)
  assert.equal(mismatch.panel.messages[0], historyMessage)
  assert.equal(mismatch.panel._oldestHistoryMessage, historyMessage)
  assert.equal(mismatch.panel.historyExhausted, true)
  assert.equal(mismatch.panel.draft, '尚未发送的草稿')
  assert.equal(mismatch.actions[0].previousJobId, 'old-job')
  assert.equal(mismatch.state.historyLoads, 1)
  console.log('PASS: a Limits job mismatch prompts for an immediate switch and only appends the type=5 custom message')

  for (const response of [
    { Code: 0, Data: { JobId: 7 } },
    { Code: 0, Data: '{}', JobId: ' 7 ' },
    { Code: 0, Data: { JobId: null } }
  ]) {
    const matched = environment()
    matched.panel.jobId = '7'
    matched.request(async args => args.Name === 'Chat.MyChat.Limits' ? response : { Code: 0, Data: { Rows: [] } })
    await matched.panel.loadChatAccess()
    assert.equal(matched.modals.length, 0)
    assert.equal(matched.state.historyLoads, 1)
    assert.equal(matched.calls.some(item => item.Name === 'Chat.ChatButton.Get'), false)
    assert.equal(matched.sends.length, 0)
  }

  for (const condition of ['success-step', 'account-mismatch', 'api-failure', 'cancelled', 'stale-job', 'destroyed', 'busy']) {
    const guarded = environment(), pendingSwitch = deferred()
    guarded.request(async args => {
      if (args.Name === 'Chat.MyChat.Limits') return { Code: 0, Data: JSON.stringify({
        JobId: 'old-job',
        ...(condition === 'success-step' ? { SuccessStep: { Tips: '请先完善信息', StepName: '立即完善' } } : {}),
        ...(condition === 'account-mismatch' ? { PersonAccId: 'another-person' } : {})
      }) }
      if (args.Name === 'Chat.Chat.ChangeJob') return condition === 'busy' ? pendingSwitch.promise : { Code: 9 }
      return { Code: 0, Data: { Rows: [] } }
    })
    await guarded.panel.loadChatAccess()
    if (condition === 'success-step') {
      assert.equal(guarded.modals.length, 1)
      assert.equal(guarded.modals[0].confirmText, '立即完善')
      assert.equal(guarded.state.historyLoads, 0)
    } else if (condition === 'account-mismatch') {
      assert.equal(guarded.modals.length, 0)
      assert.equal(guarded.panel.accessError, '沟通账号与当前会话不一致')
      assert.equal(guarded.state.historyLoads, 0)
    } else {
      if (condition === 'destroyed') guarded.panel._alive = false
      if (condition === 'stale-job') guarded.panel.jobId = 'another-job'
      const switching = guarded.modals[0].success({ confirm: condition !== 'cancelled' })
      if (condition === 'busy') {
        await guarded.modals[0].success({ confirm: true })
        assert.equal(guarded.calls.filter(item => item.Name === 'Chat.Chat.ChangeJob').length, 1)
        pendingSwitch.resolve({ Code: 9 })
      }
      await switching
      assert.equal(guarded.state.historyLoads, 1)
    }
    assert.equal(guarded.sends.length, 0)
    assert.equal(guarded.actions.length, 0)
    assert.equal(guarded.calls.filter(item => item.Name === 'Chat.Chat.ChangeJob').length,
      condition === 'api-failure' || condition === 'busy' ? 1 : 0)
  }
  console.log('PASS: SuccessStep and account checks take priority; cancellation, stale prompts, failed requests and repeated clicks cannot send switch messages')

  for (const [index, stepName] of ['升级', '立即升级', '立即开通'].entries()) {
    const upgrade = environment()
    upgrade.request(async args => {
      if (args.Name === 'Chat.MyChat.Limits') {
        const step = { Tips: '直聊数量不足，请升级', StepName: ` ${stepName} ` }
        return index === 1 ? { Code: 0, Data: '{}', SuccessStep: step }
          : { Code: 0, Data: { SuccessStep: step, JobId: 'job', Message: '不能发送招呼消息' } }
      }
      return index === 2 ? { Code: 0, Tips: '申请已提交，请等待联系' }
        : { Code: 0, Data: JSON.stringify({ Tips: '申请已提交，请等待联系' }) }
    })
    await upgrade.panel.loadChatAccess()
    const initial = upgrade.modals[0]
    assert.equal(initial.content, '直聊数量不足，请升级')
    assert.equal(initial.confirmText, stepName)
    assert.equal(upgrade.panel.accessReady, false)
    assert.equal(upgrade.calls.length, 1)
    await initial.success({ cancel: true })
    assert.equal(upgrade.calls.length, 1)
    await initial.success({ confirm: true })
    assert.equal(upgrade.calls[1].Name, 'Enterprise.Service.UpGrade')
    assert.deepEqual(upgrade.calls[1].Content, { Type: 9 })
    assert.equal(upgrade.calls.length, 2)
    const confirmation = upgrade.modals[1]
    assert.equal(confirmation.title, '提示')
    assert.equal(confirmation.content, '申请已提交，请等待联系')
    assert.equal(confirmation.confirmText, '确定')
    assert.equal(confirmation.showCancel, false)
    assert.equal(upgrade.state.browserBack, 0)
    confirmation.success({ cancel: true })
    assert.equal(upgrade.state.browserBack, 0)
    confirmation.success({ confirm: true })
    assert.equal(upgrade.state.browserBack, 1)
    assert.equal(upgrade.state.uniBack, 0)
    assert.equal(upgrade.state.historyLoads, 0)
    assert.equal(upgrade.sends.length, 0)
  }
  console.log('PASS: all three upgrade StepNames request Enterprise.Service.UpGrade Type=9 only after confirmation and return only after confirming Tips')

  const upload = environment()
  upload.request(async () => ({ Code: 0, Data: { SuccessStep: { Tips: '请上传资质', StepName: '立即上传' } } }))
  await upload.panel.loadChatAccess()
  assert.equal(upload.opened.length, 0)
  upload.modals[0].success({ confirm: true })
  assert.deepEqual(upload.opened, [{ url: 'https://www.texhr.cn/ehr/qualification/', target: '_blank' }])
  assert.equal(upload.calls.length, 1)
  assert.equal(upload.state.browserBack, 0)
  const blockedPopup = environment({ popupBlocked: true })
  blockedPopup.panel.navigateByStep('立即上传')
  assert.equal(blockedPopup.toasts[0], '无法打开新窗口，请检查浏览器设置')
  const nativeBack = environment({ browser: false })
  nativeBack.panel.navigateBack()
  assert.equal(nativeBack.state.uniBack, 1)
  console.log('PASS: upload opens qualification in a new window without an upgrade request; blocked popups are reported and non-browser back uses uni navigation')

  for (const response of [null, { Code: 9 }, { Code: 0, Data: '{invalid' }, { Code: 0, Data: [] },
    { Code: 0, Data: { Code: 1, Tips: '不能当作成功' } }, new Error('网络中断')]) {
    const failed = environment()
    failed.request(async () => {
      if (response instanceof Error) throw response
      return response
    })
    await failed.panel.navigateByStep('升级')
    assert.equal(failed.modals.length, 0)
    assert.equal(failed.toasts.length, 1)
    assert.equal(failed.state.browserBack, 0)
    failed.request(async () => ({ Code: 0, Data: { Tips: '重试成功' } }))
    await failed.panel.navigateByStep('立即开通')
    assert.equal(failed.modals[0].content, '重试成功')
  }
  const concurrentUpgrade = environment(), pendingUpgrade = deferred()
  concurrentUpgrade.request(() => pendingUpgrade.promise)
  const upgradeRequest = concurrentUpgrade.panel.navigateByStep('升级')
  const repeatedRequest = concurrentUpgrade.panel.navigateByStep('立即升级')
  assert.equal(concurrentUpgrade.calls.length, 1)
  pendingUpgrade.resolve({ Code: 0, Data: { Tips: '申请成功' } })
  await Promise.all([upgradeRequest, repeatedRequest])
  assert.equal(concurrentUpgrade.modals.length, 1)
  console.log('PASS: failed upgrades cannot navigate and may be retried; concurrent upgrade clicks share one request')

  for (const mutation of [panel => { panel._alive = false }, panel => { panel.visible = false },
    panel => { panel.opening = true }, panel => { panel.detail.conversationId = 'b' },
    panel => { panel.enterpriseAccId = 'another-enterprise' }]) {
    const stale = environment(), pending = deferred()
    stale.request(() => pending.promise)
    const loading = stale.panel.navigateByStep('升级')
    mutation(stale.panel)
    pending.resolve({ Code: 0, Data: { Tips: '迟到的申请成功提示' } })
    await loading
    assert.equal(stale.modals.length, 0)
    assert.equal(stale.toasts.length, 0)
    const staleModal = environment()
    staleModal.request(async () => ({ Code: 0, Data: { Tips: '申请成功' } }))
    await staleModal.panel.navigateByStep('升级')
    mutation(staleModal.panel)
    staleModal.modals[0].success({ confirm: true })
    assert.equal(staleModal.state.browserBack, 0)
  }
  for (const stepName of ['', '其他操作', null]) {
    const ignored = environment()
    ignored.panel.navigateByStep(stepName)
    assert.equal(ignored.calls.length, 0)
    assert.equal(ignored.opened.length, 0)
  }
  console.log('PASS: closed or changed conversations ignore late upgrade responses and modal callbacks; unsupported StepNames cannot trigger unrelated actions')

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
  const callsBeforeSameJob = env.calls.length
  await panel.selectJob({ jobId: 'job', name: '当前职位' })
  assert.equal(env.calls.length, callsBeforeSameJob)
  assert.equal(env.toasts[env.toasts.length - 1], '该职位是当前沟通职位，无需切换')
  panel.closeJobPicker()
  assert.equal(panel.jobPickerVisible, false)
  console.log('PASS: switching jobs requests the first 50 jobs and formats name, location and salary')

  env.request(async args => args.Name === 'Chat.Chat.ChangeJob'
    ? { Code: 0, Data: { Enterprise: {
      JobId: 'job-8', JobName: '前端工程师', Location: '杭州', Salary: '25-35K'
    } } } : { Code: 0, Data: { Rows: [] } })
  await panel.selectJob({ jobId: 'job-8', name: '前端工程师', location: '上海', salary: '15-25K' })
  const changeCall = env.calls.find(item => item.Name === 'Chat.Chat.ChangeJob')
  assert.deepEqual(changeCall.Content, {
    PersonAccId: 'a', EnterpriseAccId: 'enterprise', JobId: 'job-8', IsMessage: true
  })
  const customSend = env.sends.find(item => item.raw)
  assert.deepEqual(JSON.parse(customSend.raw), {
    type: 5, data: { JobId: 'job-8', JobName: '前端工程师', Location: '杭州', Salary: '25-35K' }
  })
  assert.equal(panel.jobName, '前端工程师')
  assert.equal(env.actions[env.actions.length - 1].key, 'job-switched')
  assert.equal(env.actions[env.actions.length - 1].job.location, '杭州')
  console.log('PASS: changing jobs calls ChangeJob and sends the Enterprise in a type=5 custom message')

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
  const phraseSend = env.sends.find(item => item.text === phrase.message)
  assert.equal(phraseSend.text, phrase.message)
  assert.equal(phraseSend.conversationId, 'a')
  assert.equal(panel.messages.some(message => message.text === phrase.message), true)
  assert.equal(panel.phrasesVisible, false)
  assert.equal(panel.draft, '尚未发送的草稿')
  assert.equal(panel.drafts.b, '另一个会话的草稿')
  assert.equal(panel.sendingPhraseKey, '')
  assert.equal(panel.isSending, false)
  assert.equal(env.changes.includes('changed'), true)
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
  assert.equal(env.sends.length, 3)
  await duplicate
  await normalWhileSending
  panel.draft = '发送期间追加的草稿'
  sending.reject(new Error('模拟发送失败，请重试')); await inFlight
  assert.match(env.toasts[env.toasts.length - 1], /模拟发送失败/)
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
