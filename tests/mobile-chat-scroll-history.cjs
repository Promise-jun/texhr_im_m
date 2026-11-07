const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pages/person/m/chat.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function verify() {
  const responses = [deferred(), deferred(), deferred()]
  const requests = []
  const anchors = []
  const contentHeights = [1000, 2000, 2000, 3000]
  const nim = {
    V2NIMMessageService: {
      getMessageList: options => {
        requests.push(options)
        return responses[requests.length - 1].promise
      }
    }
  }
  const context = vm.createContext({
    module: { exports: {} },
    console,
    setTimeout,
    clearTimeout,
    maskPhoneNumbers: value => value,
    DEFAULT_TALENT_AVATAR: '/static/preson_avatar.png',
    getTalentAvatar: () => '/static/preson_avatar.png',
    NIM_EVENT: {},
    NIM_EMOJIS: [],
    clearActiveConversationId() {},
    getNimLoginError: () => null,
    getNimInstance: () => nim,
    isNimLoggedIn: () => true,
    markNimConversationRead: async () => {},
    parseNimEmojiText: value => [{ type: 'text', content: value }],
    setActiveConversationId() {},
    getExternalReturnUrl: () => '',
    requestApi: async () => ({}),
    uni: {
      getSystemInfoSync: () => ({}),
      createSelectorQuery: () => {
        let callback
        const query = {
          in() { return this },
          select(selector) {
            assert.equal(selector, '.message-content')
            return { boundingClientRect: handler => { callback = handler } }
          },
          exec() { callback({ height: contentHeights.shift() }) }
        }
        return query
      },
      $on() {},
      $off() {},
      showToast() {}
    }
  })
  vm.runInContext(script, context)

  const definition = context.module.exports
  const page = definition.data()
  for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)
  page.$nextTick = callback => callback()
  page._chatPageAlive = true
  page.conversationId = 'p2p-enterprise-1'
  page.messages = [{ messageClientId: 'current-oldest', createTime: 100 }]
  page.scrollWithAnimation = true
  page.mergeMessages = async (messages, beforeCommit) => {
    if (beforeCommit) beforeCommit()
    page.messages = [...messages, ...page.messages]
  }
  page.scrollToAnchor = (anchor, animated) => anchors.push([anchor, animated])

  const firstLoad = page.handleHistoryRefresh()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].anchorMessage.messageClientId, 'current-oldest')
  assert.equal(page.isLoadingHistory, true)
  assert.equal(page.isRefreshingHistory, true)
  page.handleHistoryRefresh()
  assert.equal(page.isRefreshingHistory, true, 'a duplicate event must not dismiss the active refresh')
  page.handleMessageScroll({ detail: { scrollTop: 101 } })
  assert.equal(page.scrollTop, 0, 'native scroll events must not write back into the scroll command')
  assert.equal(page._messageScrollPosition, 101, 'the current position is tracked separately for restoration')
  assert.equal(requests.length, 1, 'repeated refresh events during one request must load only one page')

  responses[0].resolve(Array.from({ length: 50 }, (_, index) => ({
    messageClientId: `older-${index}`,
    createTime: index
  })))
  await firstLoad
  assert.equal(page.historyExhausted, false)
  assert.equal(page.scrollTop, 1101, 'prepend height must be added to the prior scroll offset')
  assert.equal(page.scrollWithAnimation, false, 'history restoration must not animate the reading position')
  assert.equal(page.isRefreshingHistory, false, 'the refresh indicator must reset after the request')
  assert.equal(anchors.length, 0, 'history prepends must not scroll an anchor to the top')

  page.handleMessageScroll({ detail: { scrollTop: 0 } })
  const secondLoad = page.handleHistoryRefresh()
  assert.equal(requests.length, 2, 'a later pull at the top can load the next page')
  page.handleHistoryRefresh()
  assert.equal(requests.length, 2, 'one pull must not issue overlapping history requests')
  responses[1].resolve(Array.from({ length: 50 }, (_, index) => ({
    messageClientId: `earlier-${index}`,
    createTime: index - 50
  })))
  await secondLoad
  assert.equal(page.scrollTop, 1000, 'the next pull must preserve the current top position after prepending')

  const failedLoad = page.handleHistoryRefresh()
  responses[2].reject(new Error('network error'))
  await failedLoad
  assert.equal(page.isRefreshingHistory, false, 'the refresh indicator must reset after a failed request')
  assert.equal(page.historyLoadError, 'network error')

  const tickQueue = []
  page.scrollToAnchor = definition.methods.scrollToAnchor.bind(page)
  page.$nextTick = callback => tickQueue.push(callback)
  page.scrollToAnchor('message-preserved', false)
  tickQueue.shift()()
  assert.equal(page.scrollIntoView, 'message-preserved')
  tickQueue.shift()()
  assert.equal(page.scrollIntoView, '', 'a completed anchor must not remain as a stale scroll target')

  assert.match(source, /@scroll="handleMessageScroll"/)
  assert.match(source, /@refresherrefresh="handleHistoryRefresh"/)
  assert.match(source, /:refresher-triggered="isRefreshingHistory"/)
  assert.doesNotMatch(source, /@scrolltoupper=/)
  assert.match(source, /:scroll-top="scrollTop"/)
  console.log('mobile chat scroll history tests passed')
}

verify().catch(error => {
  console.error(error)
  process.exitCode = 1
})
