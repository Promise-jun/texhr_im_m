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
    isNimConversationSynced: () => true,
    getNimLoginError: () => null,
    getNimInstance: () => ({
      V2NIMLoginService: { getLoginUser: () => 'enterprise-1' },
      V2NIMConversationIdUtil: { p2pConversationId: id => {
        if (state.disallowConversationId) throw new Error('过期外链不应生成云信会话 ID')
        return `p2p-${id}`
      } },
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
      redirectTo: payload => state.redirects.push(payload),
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
    calls: [], toasts: [], modals: [], redirects: [], listedConversations: [],
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
      return { Code: 0, Data: { JobId: 'job-1', ResumeId: 'resume-1', JobName: 'GetSingleChat职位' } }
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
  assert.equal(existing.chatDetail.jobName, 'GetSingleChat职位')
  assert.equal(existing.chatDetail.skipInitialAccess, true)
  assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.Chat.GetSingleChat'])

  // 已有会话优先使用完整的 URL 职位/简历，不受 messageExisted 取值影响。
  for (const messageExisted of [true, false, undefined]) {
    state.calls.length = 0
    const linked = loadPage(makeGlobals(state))
    prepare(linked, 'person-1', {
      messageExisted, jobId: 'job-from-url', resumeId: 'resume-from-url'
    })
    await linked.openRouteConversationAfterLoad()
    assert.equal(linked.chatDetail.jobId, 'job-from-url')
    assert.equal(linked.chatDetail.resumeId, 'resume-from-url')
    assert.equal(linked.chatDetail.initialAccess, null)
    assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.Chat.GetSingleChat'])

    // 再点击其他人才时，使用对应会话的接口数据。
    await linked.selectConversation({ id: 'p2p-other', targetId: 'other', type: 1 })
    assert.equal(linked.chatDetail.jobId, 'job-1')
    assert.equal(linked.chatDetail.resumeId, 'resume-1')
  }

  // URL 参数不完整时，职位与简历仍使用同一份会话数据。
  for (const flags of [{ jobId: 'job-from-url' }, { resumeId: 'resume-from-url' }]) {
    const partial = loadPage(makeGlobals(state))
    prepare(partial, 'person-1', flags)
    await partial.openRouteConversationAfterLoad()
    assert.equal(partial.chatDetail.jobId, 'job-1')
    assert.equal(partial.chatDetail.resumeId, 'resume-1')
  }

  // messageExisted=false 且列表没有会话时，请求 Limits 并使用 URL 的职位/简历。
  state.calls.length = 0
  state.listedConversations = []
  state.requestHandler = async args => {
    assert.equal(args.Name, 'Chat.MyChat.Limits')
    return { Code: 0, Data: { JobId: 'server-job', ResumeId: 'server-resume',
      JobName: '不应显示的顶层职位', Message: { JobName: 'Limits职位' } } }
  }
  const fresh = loadPage(makeGlobals(state))
  prepare(fresh, 'person-2', {
    messageExisted: false, jobId: 'job-from-url', resumeId: 'resume-from-url'
  })
  await fresh.openRouteConversationAfterLoad()
  assert.equal(fresh.selectedId, 'p2p-person-2')
  assert.equal(fresh.chatDetail.jobId, 'job-from-url')
  assert.equal(fresh.chatDetail.resumeId, 'resume-from-url')
  assert.equal(fresh.chatDetail.jobName, 'Limits职位')
  assert.equal(fresh.chatDetail.skipInitialAccess, false)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state.calls)), [{
    type: 'request', Name: 'Chat.MyChat.Limits',
    Content: { JobId: 'job-from-url', ResumeId: 'resume-from-url' }
  }])
  assert.equal(fresh.chatDetail.initialAccess.Data.JobId, 'server-job')

  // messageExisted=true 也以 Limits.Message 判断是否创建，不再直接删除。
  state.calls.length = 0
  const freshWithFlag = loadPage(makeGlobals(state))
  prepare(freshWithFlag, 'person-true', { messageExisted: true, jobId: 'job', resumeId: 'resume' })
  await freshWithFlag.openRouteConversationAfterLoad()
  assert.equal(freshWithFlag.selectedId, 'p2p-person-true')
  assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.MyChat.Limits'])

  // 列表没有会话时先请求 Limits，SuccessStep 优先于 Message，Tips 安全编码后跳转。
  state.calls.length = 0
  state.modals.length = 0
  state.toasts.length = 0
  const tips = '职位已关闭 & 请重新选择？100%'
  const stepName = '立即升级 & 申请？'
  state.requestHandler = async args => {
    assert.equal(args.Name, 'Chat.MyChat.Limits')
    return { Code: 0, Data: JSON.stringify({ SuccessStep: { Tips: tips, StepName: stepName }, Message: '忽略' }) }
  }
  const blocked = loadPage(makeGlobals(state))
  prepare(blocked, 'blocked', { messageExisted: true, jobId: 'job', resumeId: 'resume' })
  await blocked.openRouteConversationAfterLoad()
  assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.MyChat.Limits'])
  assert.equal(state.redirects[0].url, `/pages/ehr/pc/error?tips=${encodeURIComponent(tips)}`
    + `&stepName=${encodeURIComponent(stepName)}`)
  assert.equal(blocked.chatDetail, null)

  // Message 为空时仅调用业务删除并弹窗，不操作云信会话。
  state.calls.length = 0
  state.redirects.length = 0
  state.requestHandler = async args => {
    if (args.Name === 'Chat.MyChat.Limits') return { Code: 0, Data: { Message: '' } }
    assert.equal(args.Name, 'Chat.Chat.Delete')
    assert.deepStrictEqual(JSON.parse(JSON.stringify(args.Content)), {
      EnterpriseAccId: 'enterprise-1', PersonAccId: state.expectedDeletePerson
    })
    return { Code: 0, Data: { Code: 0 } }
  }
  const expired = loadPage(makeGlobals(state))
  prepare(expired, 'person-3', { messageExisted: true, jobId: 'job', resumeId: 'resume' })
  state.expectedDeletePerson = 'person-3'
  state.localConversationService = new Proxy({}, {
    get() { throw new Error('过期外链不应访问云信会话服务') }
  })
  await expired.openRouteConversationAfterLoad()
  assert.equal(expired.selectedId, '')
  assert.equal(expired.chatDetail, null)
  assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.MyChat.Limits', 'Chat.Chat.Delete'])
  assert.equal(state.modals[0].content, '该会话已经过期，请重新在简历页面发起会话!')
  assert.equal(state.redirects.length, 0)
  state.modals[0].success({ confirm: true })
  assert.equal(state.redirects.length, 1)
  assert.equal(state.redirects[0].url, '/pages/ehr/pc/chat')

  // 删除失败时展示错误，不打开聊天，也不显示删除成功提示或跳转。
  state.calls.length = 0
  state.modals.length = 0
  state.toasts.length = 0
  state.redirects.length = 0
  state.requestHandler = async args => args.Name === 'Chat.MyChat.Limits'
    ? { Code: 0, Data: { Message: '' } } : { Code: 0, Data: { Code: 42 } }
  const failedExpired = loadPage(makeGlobals(state))
  prepare(failedExpired, 'person-4', { messageExisted: true, jobId: 'job', resumeId: 'resume' })
  await failedExpired.openRouteConversationAfterLoad()
  assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.MyChat.Limits', 'Chat.Chat.Delete'])
  assert.equal(state.modals.length, 0)
  assert.equal(state.redirects.length, 0)
  assert.match(state.toasts[0].title, /数据错误码：42/)
  assert.equal(failedExpired.chatDetail, null)
  assert.notEqual(failedExpired._routeConversationOpened, true)

  // Limits 的 Code 非 0 且 ErrorMessage 有值时，编码文案并跳转统一错误页。
  state.calls.length = 0
  state.redirects.length = 0
  state.toasts.length = 0
  const limitsErrorMessage = '职位不可用 & 请重新选择？100%'
  state.requestHandler = async () => ({ Code: '1', ErrorMessage: limitsErrorMessage })
  const limitsError = loadPage(makeGlobals(state))
  prepare(limitsError, 'person-limits-error', { jobId: 'job', resumeId: 'resume' })
  await limitsError.openRouteConversationAfterLoad()
  assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.MyChat.Limits'])
  assert.equal(state.redirects[0].url,
    `/pages/ehr/pc/error?tips=${encodeURIComponent(limitsErrorMessage)}`)
  assert.equal(state.toasts.length, 0)
  assert.equal(limitsError.chatDetail, null)
  assert.equal(limitsError._routeConversationOpened, true)

  // 无 ErrorMessage、数据无效及账号不符时均不得删除会话或跳转。
  for (const response of [
    { Code: 1 },
    { Code: 0, Data: 'invalid json' },
    { Code: 0, Data: { Code: 2 } },
    { Code: 0, Data: { PersonAccId: 'other', Message: '' } }
  ]) {
    state.calls.length = 0
		state.redirects.length = 0
    state.requestHandler = async () => response
    const invalid = loadPage(makeGlobals(state))
    prepare(invalid, 'person-invalid', { jobId: 'job', resumeId: 'resume' })
    await invalid.openRouteConversationAfterLoad()
    assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.MyChat.Limits'])
		assert.equal(state.redirects.length, 0)
    assert.equal(invalid.chatDetail, null)
  }

  // Limits 等待期间会话进入列表时，改为打开已有会话，不执行删除。
  state.calls.length = 0
  let resolveLimits
  state.requestHandler = args => args.Name === 'Chat.MyChat.Limits'
    ? new Promise(resolve => { resolveLimits = resolve })
    : Promise.resolve({ Code: 0, Data: { JobId: 'job', ResumeId: 'resume' } })
  const arrived = loadPage(makeGlobals(state))
  prepare(arrived, 'person-arrived', { jobId: 'job', resumeId: 'resume' })
  const opening = arrived.openRouteConversationAfterLoad()
  while (!resolveLimits) await new Promise(resolve => setImmediate(resolve))
  arrived.rawConversations = [{ id: 'p2p-person-arrived', conversationId: 'p2p-person-arrived',
    targetId: 'person-arrived', type: 1 }]
  resolveLimits({ Code: 0, Data: { Message: '' } })
  await opening
  assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.MyChat.Limits', 'Chat.Chat.GetSingleChat'])
  assert.equal(arrived.selectedId, 'p2p-person-arrived')

  // 切换会话或离开页面后，迟到的 Limits 响应不能触发删除或跳转。
  for (const mode of ['switch', 'hide']) {
    state.calls.length = 0
    state.redirects.length = 0
    let resolveStale
    state.requestHandler = () => new Promise(resolve => { resolveStale = resolve })
    const stale = loadPage(makeGlobals(state))
    prepare(stale, 'person-stale', { jobId: 'job', resumeId: 'resume' })
    const pending = stale.openRouteConversationAfterLoad()
    while (!resolveStale) await new Promise(resolve => setImmediate(resolve))
    if (mode === 'switch') stale.cancelOpeningConversation()
    else stale.pageVisible = false
    resolveStale({ Code: 0, Data: { Message: '', SuccessStep: { Tips: '不应跳转' } } })
    await pending
    assert.deepStrictEqual(state.calls.map(call => call.Name), ['Chat.MyChat.Limits'])
    assert.equal(state.redirects.length, 0)
  }

  // 页面隐藏后确认提示时，等页面恢复后重新提示，再跳转到不带参数的地址。
  const hidden = loadPage(makeGlobals(state))
  prepare(hidden, 'person-hidden', { messageExisted: true })
  hidden._expiredRouteNoticePending = true
  hidden.showExpiredRouteNotice()
  hidden.pageVisible = false
  state.modals[0].success({ confirm: true })
  assert.equal(state.redirects.length, 0)
  assert.equal(hidden._expiredRouteNoticePending, true)
  hidden.pageVisible = true
  hidden.showExpiredRouteNotice()
  state.modals[1].success({ confirm: true })
  assert.equal(state.redirects[0].url, '/pages/ehr/pc/chat')

  // 参数不足时不得请求 Limits 或删除会话。
  state.calls.length = 0
  const legacy = loadPage(makeGlobals(state))
  prepare(legacy, 'person-5')
  await legacy.openRouteConversationAfterLoad()
  assert.equal(state.calls.length, 0)
  assert.equal(legacy.chatDetail, null)

  // 未传 messageExisted 且列表无会话时，仍以 Limits 的 Message 判断创建。
  state.requestHandler = async args => {
    assert.equal(args.Name, 'Chat.MyChat.Limits')
    return { Code: 0, Data: { Message: '开始沟通' } }
  }
  const linkedLegacy = loadPage(makeGlobals(state))
  prepare(linkedLegacy, 'person-6', { jobId: 'job-from-url', resumeId: 'resume-from-url' })
  await linkedLegacy.openRouteConversationAfterLoad()
  assert.equal(linkedLegacy.chatDetail.jobId, 'job-from-url')
  assert.equal(linkedLegacy.chatDetail.resumeId, 'resume-from-url')
  assert.equal(state.calls[state.calls.length - 1].Name, 'Chat.MyChat.Limits')

  console.log('pc chat route conversation tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
