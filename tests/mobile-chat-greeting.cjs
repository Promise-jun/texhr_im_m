const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pages/person/m/chat.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')

async function verify() {
  const calls = []
  const sent = []
  const browserLocation = { href: '' }
  const modals = []
  let limitsSuccessStep = null
  let pageBackCount = 0
  const nim = {
    V2NIMMessageCreator: {
      createCustomMessage: (text, raw) => ({ kind: 'custom', messageType: 100, text, attachment: { raw }, body: raw }),
      createTextMessage: text => ({ kind: 'text', messageType: 0, text })
    },
    V2NIMMessageService: {
      sendMessage: async (message, conversationId) => {
        sent.push({ message, conversationId })
        return {
          message: {
            ...message,
            isSelf: true,
            conversationId,
            messageClientId: `sent-${sent.length}`,
            createTime: sent.length
          }
        }
      }
    }
  }
  const globals = {
    module: { exports: {} },
    NIM_EVENT: { LOGIN_STATUS: 'login-status', LOGIN_FAILED: 'login-failed' },
    NIM_EMOJIS: [],
    clearActiveConversationId() {},
    getNimLoginError: () => null,
    getNimInstance: () => nim,
    isNimLoggedIn: () => true,
    markNimConversationRead: async () => {},
    parseNimEmojiText: text => [{ type: 'text', content: text }],
    setActiveConversationId() {},
    getExternalReturnUrl: options => String(options && options.returnUrl || '').trim(),
    navigateBackWithExternal: (externalReturnUrl, fallbackUrl = '') => {
      if (externalReturnUrl) {
        browserLocation.href = externalReturnUrl
        return true
      }
      pageBackCount += 1
      return true
    },
    requestApi: async args => {
      calls.push(args)
      if (args.Name === 'Chat.MyChat.Limits') {
        return {
          Code: 0,
          Data: {
            JobId: 'job-7',
            CodeNum: '128943',
            PersonAccId: 'person-1',
            EnterpriseAccId: 'enterprise-2',
            Message: { JobName: '面料采购' },
            ...(limitsSuccessStep ? { SuccessStep: limitsSuccessStep } : {})
          }
        }
      }
      if (args.Name === 'Chat.ChatButton.Get') {
        return { Code: 0, Data: { Greetings: '您好，方便聊聊这个职位吗？' } }
      }
      if (args.Name === 'Chat.Person.GetJobState') {
        return { Code: 0, Data: { State: args.Content.JobId === 'active-job' ? 1 : 2 } }
      }
      if (args.Name === 'Chat.Peson.Delivery') {
        return {
          Code: 0,
          Data: {
            Tips: '投递成功，请完善简历',
            ButtonName: '立即完善'
          }
        }
      }
      throw new Error(`unexpected API: ${args.Name}`)
    },
    window: { location: browserLocation },
    uni: {
      getSystemInfoSync: () => ({}),
      $on() {},
      showModal: options => modals.push(options),
      showLoading() {},
      hideLoading() {},
      showToast() {},
      navigateBack: () => { pageBackCount += 1 },
      $emit() {}
    },
    getCurrentPages: () => [{}, {}],
    console
  }
  const context = vm.createContext(globals)
  vm.runInContext(script, context)
  const definition = context.module.exports
  const page = { _chatPageAlive: true, $nextTick: callback => callback() }
  Object.assign(page, definition.data.call(page))
  for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)
  for (const [name, getter] of Object.entries(definition.computed)) {
    Object.defineProperty(page, name, { get: getter.bind(page) })
  }
  page.jobId = 'job-7'
  page.resumeId = 'resume-3'
  page.prepareNimConversation = async () => { page.conversationId = 'p2p-enterprise-2' }
  page.scrollToBottom = () => {}

  await page.loadChatAccess()

  assert.equal(calls.length, 2)
  assert.equal(calls[0].Name, 'Chat.MyChat.Limits')
  assert.equal(calls[1].Name, 'Chat.ChatButton.Get')
  assert.deepEqual(calls[1].Content, { JobId: 'job-7' })
  assert.equal(page.codeNum, '128943')
  page.handleAction({ key: 'company' })
  assert.equal(browserLocation.href, 'https://m.texhr.cn/zp128943/')
  assert.equal(sent.length, 2)
  assert.equal(sent[0].message.kind, 'custom')
  assert.deepEqual(JSON.parse(sent[0].message.body), {
    type: 4,
    data: { JobName: '面料采购' }
  })
  assert.equal(sent[1].message.kind, 'text')
  assert.equal(sent[1].message.text, '您好，方便聊聊这个职位吗？')
  assert.equal(sent[0].conversationId, 'p2p-enterprise-2')
  assert.equal(sent[1].conversationId, 'p2p-enterprise-2')
  assert.equal(page._pendingChatGreeting, null)
  assert.equal(page.displayMessages.find(message => message.id === 'sent-1').type, 'job-card')
  assert.equal(page.displayMessages.find(message => message.id === 'sent-1').direction, 'self')
  assert.equal(page.displayMessages.find(message => message.id === 'sent-2').type, 'text')

  page.messages = [{
    messageClientId: 'custom-4',
    messageType: 100,
    isSelf: false,
    createTime: 1,
    attachment: {
      raw: JSON.stringify({
        type: 4,
        data: JSON.stringify({ Enterprise: { JobId: '82465', JobName: '招聘顾问', Salary: '4K-6K', status: true, EnterpriseTime: '2026-10-12 10:00' } })
      })
    }
  }, {
    messageClientId: 'custom-5',
    messageType: 100,
    isSelf: true,
    createTime: 2,
    attachment: {
      raw: JSON.stringify({
        type: 5,
        data: { JobId: 'card-job-5', JobName: '招聘顾问', status: false, Logo: '/missing-logo.png', EnterpriseTime: '您已将沟通过的职位更换成招聘顾问' }
      })
    }
  }]
  assert.equal(page.displayMessages[0].type, 'time')
  assert.equal(page.displayMessages[1].type, 'job-card')
  assert.equal(page.displayMessages[1].customType, 4)
  assert.equal(page.displayMessages[1].job.JobName, '招聘顾问')
  assert.equal(page.displayMessages[2].type, 'job-card')
  assert.equal(page.displayMessages[2].customType, 5)
  assert.equal(page.displayMessages[2].job.EnterpriseTime, '您已将沟通过的职位更换成招聘顾问')
  assert.equal(page.displayMessages[1].job.EnterpriseTime, '2026-10-12 10:00')

  page.handleJobCardClick(page.displayMessages[1])
  assert.equal(browserLocation.href, 'https://m.texhr.cn/zp128943/82465/')
  page.handleJobCardClick(page.displayMessages[2])
  for (const status of [undefined, null, false, 0, '']) {
    page.handleJobCardClick({ type: 'job-card', job: { JobId: 'expired-job', status } })
  }
  assert.equal(browserLocation.href, 'https://m.texhr.cn/zp128943/82465/')
  page.handleJobCardClick({ type: 'job-card', job: { JobId: 'card-job-5', status: 1 } })
  assert.equal(browserLocation.href, 'https://m.texhr.cn/zp128943/card-job-5/')

  page.handleJobLogoError(page.displayMessages[2])
  page.handleJobLogoError(page.displayMessages[2])
  assert.equal(page.failedJobLogoIds.length, 1)
  assert.equal(page.failedJobLogoIds[0], 'custom-5')
  assert.equal(page.displayMessages[2].job.Logo, '/missing-logo.png')

  page.handleReceiveMessages([{
    conversationId: page.conversationId,
    messageClientId: 'received-card',
    messageType: 100,
    isSelf: false,
    createTime: 3,
    attachment: { raw: JSON.stringify({ type: 5, data: { JobName: '面料采购' } }) }
  }])
  assert.equal(page.displayMessages.find(message => message.id === 'received-card').type, 'job-card')
  assert.equal(page.displayMessages.find(message => message.id === 'received-card').direction, 'other')

  const activeCard = {
    conversationId: page.conversationId,
    messageClientId: 'active-card',
    messageType: 100,
    createTime: 4,
    attachment: { raw: JSON.stringify({ type: 4, data: JSON.stringify({ Enterprise: { JobId: 'active-job', JobName: '有效职位' } }) }) }
  }
  const expiredCard = {
    conversationId: page.conversationId,
    messageClientId: 'expired-card',
    messageType: 100,
    createTime: 5,
    attachment: { raw: JSON.stringify({ type: 5, data: { JobId: 'expired-job', JobName: '失效职位' } }) }
  }
  const mergingJobCards = page.mergeMessages([activeCard, expiredCard])
  assert.equal(page.messages.some(message => message.messageClientId === 'active-card'), false)
  await mergingJobCards
  assert.equal(page.displayMessages.find(message => message.id === 'active-card').job.status, true)
  assert.equal(page.displayMessages.find(message => message.id === 'expired-card').job.status, false)
  assert.deepEqual(calls.slice(-2).map(call => call.Content), [{ JobId: 'active-job' }, { JobId: 'expired-job' }])

  const normalize = vm.runInContext('normalizeNimMessage', context)
  assert.equal(normalize({ messageType: 100, attachment: { type: '5', data: { JobName: '采购' } } }).job.EnterpriseTime,
    undefined)
  for (const messageType of [4, 5]) {
    assert.equal(normalize({ messageType, attachment: { raw: JSON.stringify({ type: 5, data: { JobName: '采购' } }) } }).type, 'text')
  }
  for (const data of [null, [], '{invalid json', { Person: { PersonName: '张先生' } }, { Enterprise: null }]) {
    assert.equal(normalize({ messageType: 100, attachment: { raw: JSON.stringify({ type: 4, data }) } }).type, 'text')
  }
  assert.equal(normalize({ messageType: 100, attachment: { raw: '{invalid json' } }).type, 'text')
  assert.equal(normalize({ messageType: 100, attachment: { raw: JSON.stringify({ type: 6, data: { JobName: '采购' } }) } }).type, 'text')

  // 历史详情已发出求职消息时，URL 标记仅跳过默认招呼语，权限与历史初始化仍执行。
  page.loadCommonPhrases = () => {}
  page.loadSendResumeStatus = () => {}
  const apiCount = calls.length, sentCount = sent.length
  await definition.onLoad.call(page, { jobId: 'job-7', resumeId: 'resume-3', skipGreeting: '1' })
  assert.equal(page._skipInitialChatGreeting, true)
  assert.equal(calls.length, apiCount + 1)
  assert.equal(calls[calls.length - 1].Name, 'Chat.MyChat.Limits')
  assert.equal(sent.length, sentCount)
  // 普通入口保持原有默认消息行为。
  await definition.onLoad.call(page, { jobId: 'job-7', resumeId: 'resume-3' })
  assert.equal(page._skipInitialChatGreeting, false)
  assert.equal(sent.length, sentCount + 2)

  // Limits 返回 SuccessStep 时展示可取消弹窗；取消返回聊天上一页，确定按 StepName 跳转。
  limitsSuccessStep = { Tips: '请先完善简历', StepName: '立即完善' }
  const modalCount = modals.length
  await page.loadChatAccess()
  assert.equal(modals.length, modalCount + 1)
  const successStepModal = modals[modals.length - 1]
  assert.equal(successStepModal.showCancel, true)
  assert.equal(successStepModal.confirmText, '立即完善')
  successStepModal.success({ cancel: true })
  assert.equal(pageBackCount, 1)
  successStepModal.success({ confirm: true })
  assert.equal(browserLocation.href, 'https://m.texhr.cn/person/standardresume/myresume/')
  for (const stepName of ['立即创建', '立即完善', '立即修改', '立即验证']) {
    page.navigateByStep(stepName)
    assert.equal(browserLocation.href, 'https://m.texhr.cn/person/standardresume/myresume/')
  }
  page.navigateByStep('解除')
  assert.equal(browserLocation.href, 'https://m.texhr.cn/person/basicinformation/hidesetview/?url=/person/usercenter/')

  page.personAccId = 'person/report id'
  page.enterpriseAccId = 'enterprise/report id'
  page.handleReportAction()
  assert.equal(browserLocation.href,
    'https://m.texhr.cn/report/ChatReportView?FromAccid=person%2Freport%20id&ToAccid=enterprise%2Freport%20id&reportType=person')

  // 投递成功弹窗确认时复用 SuccessStep 的页面跳转方法，并传入 ButtonName。
  page.sendResumeJob = { jobId: '82465' }
  const deliveryModalCount = modals.length
  await page.confirmSendResume()
  assert.equal(modals.length, deliveryModalCount + 1)
  const deliveryModal = modals[modals.length - 1]
  assert.equal(deliveryModal.showCancel, false)
  assert.equal(deliveryModal.confirmText, '立即完善')
  deliveryModal.success({ confirm: true })
  assert.equal(browserLocation.href, 'https://m.texhr.cn/person/standardresume/myresume/')
  console.log('PASS: matching jobs send the Limits message as type=4 before the ChatButton Greetings text')
  console.log('PASS: history continuation skips duplicate default greetings while normal chat entries still send them')
  console.log('PASS: custom type=4/5 job cards, malformed payload fallback, native message isolation, and logo fallback')
  console.log('PASS: custom job cards wait for GetJobState and map State=1 to status=true')
  console.log('PASS: active job cards open CodeNum/JobId URLs, and expired job cards do not navigate')
  console.log('PASS: Limits CodeNum is saved and used to open the mobile company homepage')
  console.log('PASS: SuccessStep cancel returns to the previous page and confirm routes by StepName')
  console.log('PASS: delivery success confirmation routes through navigateByStep(buttonName)')
}

verify().catch(error => {
  console.error(error)
  process.exitCode = 1
})
