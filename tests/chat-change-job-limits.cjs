// node --unhandled-rejections=strict tests/chat-change-job-limits.cjs
// 内存模拟接口和页面，验证真实请求封装及三种 ChangeJob 入口。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const requestApiEnvironment = require('./request-api-helper.cjs')
const root = path.resolve(__dirname, '..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const LIMITS = 'Chat.MyChat.Limits'
const CHANGE = 'Chat.Chat.ChangeJob'
function environment(enterprise = false) {
  const calls = []
  let transport = args => ({ Code: 0, Data: args.Name === CHANGE ? { Enterprise: { JobId: args.Content.JobId } } : {} })
  const api = requestApiEnvironment(args => { calls.push(plain(args)); return transport(args) }, { enterprise })
  const context = vm.createContext({ ...api, parseNimEmojiText() {}, getTalentAvatar() {} })
  vm.runInContext(source('services/chat-history.js').replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), context)
  return { ...api, calls, change: context.changeHistoryChatJob, request: fn => { transport = fn } }
}
function loadPage(file, globals) {
  const context = vm.createContext({ module: { exports: {} }, UniPopup: {}, PcChatPanel: {}, PcChatHistoryPanel: {}, ...globals })
  vm.runInContext(source(file).match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'module.exports ='), context)
  return context.module.exports
}
function liveChat(enterprise = false) {
  const env = environment(enterprise), steps = [], toasts = []
  const file = enterprise ? 'components/pc-chat-panel/pc-chat-panel.vue' : 'pages/person/m/chat.vue'
  const def = loadPage(file, { ...env, console: { error() {}, warn() {} }, isNimLoggedIn: () => false,
    uni: { showToast: item => toasts.push(item.title), showLoading() {}, hideLoading() {} } })
  const page = { _alive: true, _chatPageAlive: true, visible: true, opening: false, accessReady: true,
    jobId: 'old-job', resumeId: 'resume', personAccId: 'person', enterpriseAccId: 'enterprise',
    conversationId: 'p2p-enterprise', isSwitchingChatJob: false, isSwitchingJob: false,
    handleSuccessStep: step => steps.push(plain(step)), closeJobPicker() {}, $emit() {} }
  const change = () => enterprise ? def.methods.selectJob.call(page, { jobId: 'target-job' })
    : def.methods.changeChatJob.call(page, 'target-job')
  return { ...env, page, change, steps, toasts }
}

async function verifyRequestOrder() {
  for (const enterprise of [false, true]) {
    const env = environment(enterprise), pending = deferred()
    env.request(args => args.Name === LIMITS ? pending.promise : { Code: 0, Data: { Enterprise: { JobId: 'job' } } })
    const changing = env.change('person', 'enterprise', ' job ', enterprise ? ' resume ' : undefined)
    await flush()
    assert.deepStrictEqual(env.calls, [{ Name: LIMITS, Content: enterprise ? { JobId: 'job', ResumeId: 'resume' } : { JobId: 'job' } }])
    pending.resolve({ Code: 0, Data: '{}' })
    await changing
    assert.deepStrictEqual(env.calls[1], { Name: CHANGE, Content: {
      PersonAccId: 'person', EnterpriseAccId: 'enterprise', JobId: 'job', IsMessage: true
    } })
    await env.change('person', 'enterprise', 'job', enterprise ? 'resume' : undefined)
    assert.deepStrictEqual(env.calls.map(call => call.Name), [LIMITS, CHANGE, CHANGE])
  }
  const required = environment(true)
  await assert.rejects(required.change('p', 'e', 'j'), /简历/)
  assert.equal(required.calls.length, 0)
}

async function verifyCacheAndConcurrency() {
  const env = environment(true)
  await env.requestApi({ Name: LIMITS, Content: { JobId: 'job', ResumeId: 'resume' } })
  await env.change('p', 'e', 'job', 'resume')
  assert.deepStrictEqual(env.calls.map(call => call.Name), [LIMITS, CHANGE])
  await env.change('p2', 'e', 'job', 'another-resume')
  await env.change('p', 'e', 'another-job', 'resume')
  assert.equal(env.calls.filter(call => call.Name === LIMITS).length, 3)
  // 每次发送前的普通 Limits 仍需请求，不能被切换前的复用逻辑跳过。
  await env.requestApi({ Name: LIMITS, Content: { JobId: 'job', ResumeId: 'resume' } })
  assert.equal(env.calls.filter(call => call.Name === LIMITS).length, 4)
  const createPayload = env.context.createRequestPayload
  env.context.createRequestPayload = args => ({ ...createPayload(args), Token: 'another-login' })
  await env.change('p', 'e', 'job', 'resume')
  assert.equal(env.calls.filter(call => call.Name === LIMITS).length, 5)

  const person = environment()
  await person.requestApi({ Name: LIMITS, Content: { JobId: 'job', ResumeId: 'own-resume' } })
  await person.change('p', 'e', 'job')
  assert.deepStrictEqual(person.calls.map(call => call.Name), [LIMITS, CHANGE])

  const shared = environment(true), pending = deferred()
  shared.request(args => args.Name === LIMITS ? pending.promise : { Code: 0, Data: {} })
  const ordinary = shared.requestApi({ Name: LIMITS, Content: { JobId: 'job', ResumeId: 'resume' } })
  const checks = [shared.ensureChatLimitsBeforeChangeJob('job', 'resume'), shared.ensureChatLimitsBeforeChangeJob('job', 'resume')]
  await flush()
  assert.equal(shared.calls.length, 1)
  pending.resolve({ Code: 0, Data: {} })
  await Promise.all([ordinary, ...checks])
}

async function verifyFailures() {
  for (const failure of [new Error('网络异常'), { Code: 9, ErrorMessage: '当前不能沟通' },
    { Code: 0, Data: { Code: 8 } }, { Code: 0, Data: '{invalid' }, { Code: 0, Data: [] },
    { Code: 0, Data: { SuccessStep: { Tips: '请先升级' } } }, { Code: 0, SuccessStep: { Tips: '请先完善资料' } }]) {
    const env = environment()
    env.request(() => { if (failure instanceof Error) throw failure; return failure })
    await assert.rejects(env.change('p', 'e', 'job'))
    assert.deepStrictEqual(env.calls.map(call => call.Name), [LIMITS])
    env.request(args => ({ Code: 0, Data: args.Name === CHANGE ? { Enterprise: { JobId: 'job' } } : {} }))
    await env.change('p', 'e', 'job')
    assert.deepStrictEqual(env.calls.map(call => call.Name), [LIMITS, LIMITS, CHANGE])
  }
  const stale = environment(), pending = deferred()
  stale.request(() => pending.promise)
  let current = true
  const changing = stale.change('p', 'e', 'job', undefined, () => current)
  await flush()
  current = false
  pending.resolve({ Code: 0, Data: {} })
  assert.equal(await changing, null)
  assert.deepStrictEqual(stale.calls.map(call => call.Name), [LIMITS])
}

async function verifyLiveChatEntries() {
  for (const enterprise of [false, true]) {
    const env = liveChat(enterprise)
    await env.change()
    assert.deepStrictEqual(env.calls.map(call => call.Name), [LIMITS, CHANGE])
    assert.deepStrictEqual(env.calls[0].Content, { JobId: 'target-job', ResumeId: 'resume' })
    const reused = liveChat(enterprise)
    await reused.requestApi({ Name: LIMITS, Content: { JobId: 'target-job', ResumeId: 'resume' } })
    await reused.change()
    assert.deepStrictEqual(reused.calls.map(call => call.Name), [LIMITS, CHANGE])
    const step = liveChat(enterprise)
    step.request(() => ({ Code: 0, Data: { SuccessStep: { Tips: '请先升级' } } }))
    await step.change()
    assert.deepStrictEqual(step.calls.map(call => call.Name), [LIMITS])
    assert.deepStrictEqual(step.steps, [{ Tips: '请先升级' }])
    const stale = liveChat(enterprise), pending = deferred()
    stale.request(() => pending.promise)
    const changing = stale.change()
    await flush()
    if (enterprise) stale.page.visible = false
    else stale.page._chatPageAlive = false
    pending.resolve({ Code: 0, Data: {} })
    await changing
    assert.deepStrictEqual(stale.calls.map(call => call.Name), [LIMITS])
  }
}

async function verifyHistoryPages() {
  for (const enterprise of [false, true]) {
    for (const blocked of [false, true]) {
      const env = environment(enterprise), opened = []
      if (blocked) env.request(() => ({ Code: 0, Data: { SuccessStep: { Tips: '请先完成资料' } } }))
      const def = loadPage(enterprise ? 'pages/ehr/pc/chat.vue' : 'pages/person/m/detail.vue', {
        ...env, console: { error() {} }, isNimLoggedIn: () => true,
        changeHistoryChatJob: env.change,
        getHistoryChatJobState: async () => 1,
        getHistoryChatButton: async () => ({ JobId: 'other-job' }),
        uni: { showToast: item => { throw new Error(item.title) } }
      })
      const page = enterprise ? {
        _conversationPageAlive: true, pageVisible: true, activeMainTab: 'history',
        historyChatDetail: { conversationId: 'chat', jobId: 'job', resumeId: 'resume', personAccId: 'p', enterpriseAccId: 'e' },
        confirmContinueJobSwitch: async () => true,
        sendContinueHistoryMessage: async () => true, cancelOpeningConversation() {}
      } : {
        _detailPageAlive: true, canContinueChat: true,
        chatDetail: { JobId: 'job', ResumeId: 'resume', PersonAccId: 'p', EnterpriseAccId: 'e' },
        destroyAudioPlayer() {}, getContinueMessageContext() {}, confirmContinueJobSwitch: async () => true,
        sendContinueChatMessages: async () => true,
        openContinuedChat: async (pending, step) => { opened.push(step) }
      }
      if (enterprise) {
        page.checkContinueHistoryLimits = def.methods.checkContinueHistoryLimits.bind(page)
        page.updateContinueJobDetail = def.methods.updateContinueJobDetail.bind(page)
        page.showContinueChatSuccessStep = def.methods.showContinueChatSuccessStep.bind(page)
        await def.methods.continueHistoryChat.call(page)
        assert.equal(page.activeMainTab, 'recent')
        if (blocked) assert.equal(page.chatDetail.initialAccess.Data.SuccessStep.Tips, '请先完成资料')
      } else {
        await def.methods.continueChat.call(page)
        assert.equal(opened.length, 1)
        if (blocked) assert.equal(opened[0].Tips, '请先完成资料')
      }
      assert.deepStrictEqual(env.calls[0], { Name: LIMITS, Content: enterprise
        ? { JobId: 'job', ResumeId: 'resume' } : { JobId: 'job' } })
      assert.deepStrictEqual(env.calls.map(call => call.Name), blocked ? [LIMITS] : [LIMITS, CHANGE])
    }
  }
}

// 防止悬而未决的 Promise 令 Node 提前退出并被误判为通过。
const timeout = setTimeout(() => { throw new Error('chat change job limits tests timed out') }, 10000)
Promise.resolve().then(verifyRequestOrder).then(verifyCacheAndConcurrency).then(verifyFailures)
  .then(verifyLiveChatEntries).then(verifyHistoryPages).then(() => {
    clearTimeout(timeout)
    console.log('PASS: ChangeJob waits for Limits; successful requests are reused and pending checks are shared')
    console.log('PASS: personal ResumeId is optional; enterprise ResumeId, account/job/resume isolation and send checks are preserved')
    console.log('PASS: failures, SuccessStep and stale pages stop all three ChangeJob entries; failed checks can retry')
    console.log('PASS: actual history pages pass optional/required ResumeId and reuse their own SuccessStep handlers')
  }).catch(error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
