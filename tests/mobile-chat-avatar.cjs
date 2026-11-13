// node tests/mobile-chat-avatar.cjs: delayed API/SDK responses are simulated in memory.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.resolve(__dirname, '..')
const plain = value => JSON.parse(JSON.stringify(value))
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const profile = (accountId, avatar, gender = 0) => ({ accountId, avatar, gender })
const avatars = vm.createContext({})
vm.runInContext(fs.readFileSync(path.join(root, 'services/talent-avatar.js'), 'utf8').replace(/^export /gm, ''), avatars)

function environment({ loggedIn = true, cached, cloud, request } = {}) {
  const calls = { cached: [], cloud: [], business: [], history: [] }
  const listeners = new Map()
  const state = { loggedIn, accountId: 'person' }
  const nim = {
    V2NIMLoginService: { getLoginUser: () => state.accountId },
    V2NIMConversationIdUtil: { p2pConversationId: id => 'p2p-' + id },
    V2NIMUserService: {
      getUserList: ids => {
        calls.cached.push(plain(ids))
        return cached ? cached(ids) : Promise.resolve([])
      },
      getUserListFromCloud: ids => {
        calls.cloud.push(plain(ids))
        return cloud ? cloud(ids) : Promise.resolve([])
      }
    },
    V2NIMMessageService: { getMessageList: async options => {
      calls.history.push(options)
      return [{ conversationId: options.conversationId, messageClientId: 'history',
        messageType: 0, text: 'hello', createTime: 1, isSelf: false }]
    } }
  }
  const globals = {
    module: { exports: {} }, console: { warn() {}, error() {} }, setTimeout, clearTimeout,
    DEFAULT_TALENT_AVATAR: avatars.getTalentAvatar(), getTalentAvatar: avatars.getTalentAvatar,
    maskPhoneNumbers: text => text, NIM_EMOJIS: [], parseNimEmojiText: text => [{ type: 'text', content: text }],
    NIM_EVENT: { LOGIN_STATUS: 'login', LOGIN_FAILED: 'failed', MESSAGE_RECEIVED: 'messages', MESSAGE_REVOKED: 'revoke' },
    getNimInstance: () => nim, isNimLoggedIn: () => state.loggedIn, getNimLoginError: () => null,
    getExternalReturnUrl: () => '', appendExternalReturnUrl: url => url,
    setActiveConversationId() {}, clearActiveConversationId() {},
    markNimConversationRead: async () => {}, sendNimP2PReadReceipt: async () => {},
    requestApi: args => {
      calls.business.push(args)
      return request ? request(args) : Promise.resolve({ Code: 0, Data: {
        JobId: 'job', ResumeId: 'resume', PersonAccId: 'person', EnterpriseAccId: 'enterprise'
      } })
    },
    uni: { getSystemInfoSync: () => ({}), $on: (name, handler) => listeners.set(name, handler),
      $off: name => listeners.delete(name), showModal() {}, showToast() {}, $emit() {} }
  }
  const context = vm.createContext(globals)
  const loadDefinition = file => {
    const source = fs.readFileSync(path.join(root, file), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
      .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'module.exports =')
    vm.runInContext('(function () {' + source + '\n})()', context)
    return context.module.exports
  }
  const definition = loadDefinition('pages/person/m/chat.vue')
  const createPage = () => {
    const page = { ...definition.data(), $nextTick: callback => Promise.resolve().then(callback) }
    for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)
    page.loadCommonPhrases = () => {}
    page.loadSendResumeStatus = () => {}
    page.scrollToBottom = () => {}
    return page
  }
  const page = createPage()
  return { calls, state, nim, globals, page, createPage, definition, loadDefinition, listeners,
    enter: (options = {}, target = page) => definition.onLoad.call(target, options) }
}

async function verify() {
  const access = deferred(), cache = deferred(), cloud = deferred()
  const env = environment({ cached: () => cache.promise, cloud: () => cloud.promise, request: () => access.promise })
  const options = { personAccId: 'person', enterpriseAccId: 'enterprise',
    otherAvatar: encodeURIComponent('https://img.example/company.png?size=80&name=a%20b') }
  const entering = env.enter(options)
  assert.equal(env.page.otherAvatar, 'https://img.example/company.png?size=80&name=a%20b')
  assert.deepStrictEqual(env.calls.cached, [['person', 'enterprise']], 'profile lookup starts before the business response')
  assert.equal(env.calls.history.length, 0, 'profile prefetch does not bypass conversation validation')
  cache.resolve([profile('person', '/cached-self.png'), profile('enterprise', '/cached-other.png')])
  await flush()
  assert.equal(env.page.selfAvatar, '/cached-self.png')
  assert.equal(env.page.otherAvatar, '/cached-other.png')
  assert.deepStrictEqual(env.calls.cloud, [['person', 'enterprise']], 'both profiles refresh in one batch')
  access.resolve({ Code: 0, Data: { JobId: 'job', ResumeId: 'resume', EnterpriseAccId: 'enterprise' } })
  await entering
  assert.equal(env.page.messages.length, 1, 'history appears while cloud profiles are still pending')
  assert.equal(env.calls.cached.length, 1, 'conversation initialization reuses the pending profile lookup')
  cloud.resolve([profile('person', '/fresh-self.png'), profile('enterprise', '/fresh-other.png')])
  await env.page.loadUserProfiles()
  assert.equal(env.page.otherAvatar, '/fresh-other.png')
  assert.equal(env.page.selfAvatar, '/fresh-self.png')
  assert.equal(env.calls.cloud.length, 1, 'completed lookup is also reused within the page')

  const reopenCloud = deferred()
  env.nim.V2NIMUserService.getUserListFromCloud = ids => {
    env.calls.cloud.push(plain(ids))
    return reopenCloud.promise
  }
  const reopened = env.createPage()
  const reopening = env.enter({ ...options, otherAvatar: 'https://img.example/company.png?name=a%20b' }, reopened)
  assert.equal(reopened.otherAvatar, 'https://img.example/company.png?name=a%20b', 'already decoded URLs keep literal escapes')
  await reopening
  assert.equal(reopened.selfAvatar, '/cached-self.png', 'a new page reads the SDK cache again')
  assert.equal(reopened.otherAvatar, '/cached-other.png')
  reopenCloud.resolve([profile('enterprise', '/fresh-other.png')])
  await reopened.loadUserProfiles()
  assert.equal(reopened.otherAvatar, '/fresh-other.png', 'the background response can update a cached image')

  const failing = environment({ cached: async () => [profile('person', '', 2), profile('enterprise', '/usable.png')],
    cloud: async () => { throw new Error('offline') } })
  await failing.enter(options)
  await failing.page.loadUserProfiles()
  assert.equal(failing.page.selfAvatar, '/static/woman_avatar.png')
  assert.equal(failing.page.otherAvatar, '/usable.png', 'refresh failures preserve the usable cached avatar')
  assert.equal(failing.page.messages.length, 1)

  const retry = environment({ cached: async () => { throw new Error('cache unavailable') },
    cloud: async () => [profile('enterprise', '/cloud-only.png')] })
  await retry.enter(options)
  await retry.page.loadUserProfiles()
  assert.equal(retry.page.otherAvatar, '/cloud-only.png', 'a cache read failure still permits cloud fallback')

  const brokenCloud = deferred()
  const broken = environment({ cached: async () => [profile('enterprise', '/broken.png')], cloud: () => brokenCloud.promise })
  await broken.enter(options)
  broken.page.handleAvatarError('other')
  assert.equal(broken.page.otherAvatar, '/static/default_avatar.png')
  brokenCloud.resolve([profile('enterprise', '/broken.png')])
  await broken.page.loadUserProfiles()
  assert.equal(broken.page.otherAvatar, '/static/default_avatar.png', 'refresh must not restore an image that already failed')

  const removed = environment({ cached: async () => [profile('enterprise', '')],
    cloud: async () => [profile('enterprise', '')] })
  await removed.enter(options)
  await removed.page.loadUserProfiles()
  assert.equal(removed.page.otherAvatar, '/static/default_avatar.png', 'clearing the cloud avatar clears the old entry image')

  const late = deferred()
  const unloaded = environment({ cloud: () => late.promise })
  await unloaded.enter(options)
  unloaded.page._chatPageAlive = false
  late.resolve([profile('enterprise', '/too-late.png')])
  await unloaded.page._userProfilesRequest.promise
  assert.notEqual(unloaded.page.otherAvatar, '/too-late.png', 'late responses do not update an unloaded page')

  const firstTarget = deferred(), secondTarget = deferred()
  const switched = environment({ cloud: ids => ids.includes('enterprise') ? firstTarget.promise : secondTarget.promise })
  await switched.enter(options)
  switched.page.enterpriseAccId = 'another'
  const switching = switched.page.loadUserProfiles()
  assert.equal(switched.page.otherAvatar, '/static/default_avatar.png', 'a different account cannot reuse the entry image')
  await flush()
  secondTarget.resolve([profile('another', '/another.png')])
  await switching
  firstTarget.resolve([profile('enterprise', '/obsolete.png')])
  await flush()
  assert.equal(switched.page.otherAvatar, '/another.png', 'an old target response cannot overwrite the active target')

  const delayed = environment({ loggedIn: false, cached: async ids => ids.map(id => profile(id, '/cached-' + id + '.png')) })
  await delayed.enter(options)
  assert.equal(delayed.calls.cached.length, 0)
  delayed.state.loggedIn = true
  delayed.listeners.get('login')(1)
  await flush()
  assert.equal(delayed.page.otherAvatar, '/cached-enterprise.png', 'login completion resumes profile loading')
  assert.equal(delayed.calls.cloud.length, 1)

  const greeting = deferred()
  const limit = environment({ cached: async ids => ids.map(id => profile(id, '/ready-' + id + '.png')),
    request: args => args.Name === 'Chat.ChatButton.Get' ? greeting.promise : Promise.resolve({ Code: 0, Data: {
      JobId: 'job', EnterpriseAccId: 'enterprise', Message: { JobId: 'job' }
    } }) })
  const limitEntering = limit.enter({ jobId: 'job', limit: 'true' })
  await flush()
  assert.equal(limit.page.otherAvatar, '/ready-enterprise.png', 'avatar lookup does not wait for the greeting API')
  assert.equal(limit.calls.history.length, 0)
  greeting.resolve({ Code: 0, Data: { Greetings: '' } })
  limit.page.sendPendingChatGreeting = async () => {}
  await limitEntering

  const navigation = []
  const route = environment()
  route.globals.uni.navigateTo = args => navigation.push(args)
  const listDefinition = route.loadDefinition('pages/person/m/list.vue')
  const list = { ...listDefinition.data() }
  for (const [name, method] of Object.entries(listDefinition.methods)) list[name] = method.bind(list)
  const avatar = 'https://img.example/a.png?token=a%2Fb&size=80#v1'
  await list.openConversation({ id: 'recent', targetId: 'enterprise', avatar })
  const encodedAvatar = navigation[0].url.split('&otherAvatar=')[1]
  assert.equal(decodeURIComponent(encodedAvatar), avatar, 'the entry image URL survives special characters')
  console.log('PASS: cached and list avatars render before slow business/cloud responses; profile refreshes are batched')
  console.log('PASS: lookup reuse, delayed login, greeting latency, cache failures, broken images, cleared avatars and stale responses')
  console.log('PASS: list navigation preserves encoded avatar URLs')
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
