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
  const jobCardClicks = []
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
    requestApi: async args => {
      calls.push(args)
      if (args.Name === 'Chat.MyChat.Limits') {
        return {
          Code: 0,
          Data: {
            JobId: 'job-7',
            PersonAccId: 'person-1',
            EnterpriseAccId: 'enterprise-2',
            Message: { JobName: '面料采购' }
          }
        }
      }
      if (args.Name === 'Chat.ChatButton.Get') {
        return { Code: 0, Data: { Greetings: '您好，方便聊聊这个职位吗？' } }
      }
      throw new Error(`unexpected API: ${args.Name}`)
    },
    uni: { showModal() {}, showToast() {}, $emit: (event, payload) => jobCardClicks.push({ event, payload }) },
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
        data: JSON.stringify({ Enterprise: { JobId: 'card-job-4', JobName: '招聘顾问', Salary: '4K-6K', status: true, EnterpriseTime: '2026-10-12 10:00' } })
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
  assert.equal(jobCardClicks.length, 1)
  assert.equal(jobCardClicks[0].event, 'chat:job-card-click')
  assert.equal(jobCardClicks[0].payload.jobId, 'card-job-4')
  assert.equal(jobCardClicks[0].payload.job.Salary, '4K-6K')
  page.handleJobCardClick(page.displayMessages[2])
  for (const status of [undefined, null, false, 0, '']) {
    page.handleJobCardClick({ type: 'job-card', job: { JobId: 'expired-job', status } })
  }
  assert.equal(jobCardClicks.length, 1)
  page.handleJobCardClick({ type: 'job-card', job: { JobId: 'card-job-5', status: 1 } })
  assert.equal(jobCardClicks.length, 2)
  assert.equal(jobCardClicks[1].payload.jobId, 'card-job-5')

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
  console.log('PASS: matching jobs send the Limits message as type=4 before the ChatButton Greetings text')
  console.log('PASS: custom type=4/5 job cards, malformed payload fallback, native message isolation, and logo fallback')
  console.log('PASS: active job cards emit job data, and expired job cards do not trigger clicks')
}

verify().catch(error => {
  console.error(error)
  process.exitCode = 1
})
