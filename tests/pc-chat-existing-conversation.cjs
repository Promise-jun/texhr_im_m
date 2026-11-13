// node tests/pc-chat-existing-conversation.cjs：已有会话首次挂载不请求 Limits。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')
const calls = []
const context = vm.createContext({
  module: { exports: {} }, console, NIM_EMOJIS: [],
  requestApi: args => { calls.push(args); return Promise.resolve({ Code: 0, Data: {} }) }
})
vm.runInContext(script, context)
const definition = context.module.exports

function panel(skipInitialAccess) {
  const value = {
    conversation: { name: '人才', stickTop: false },
    detail: { conversationId: 'p2p-person', isPinned: false },
    drafts: {}, jobId: 'job', resumeId: 'resume', personAccId: 'person', enterpriseAccId: 'enterprise',
    initialAccess: null, skipInitialAccess, visible: true, opening: false, skipGreeting: false,
    $set: (target, key, item) => { target[key] = item }, $emit() {}
  }
  Object.assign(value, definition.data.call(value))
  Object.entries(definition.methods).forEach(([name, method]) => { value[name] = method.bind(value) })
  return value
}

const existing = panel(true)
let phraseLoads = 0
let prepares = 0
existing._alive = true
existing.loadCommonPhrases = () => { phraseLoads++ }
existing.prepareConversation = () => { prepares++ }
existing.initializeExistingConversation()
assert.equal(existing.accessReady, true)
assert.equal(phraseLoads, 1)
assert.equal(prepares, 1)
assert.equal(calls.length, 0)
assert.match(source, /if \(this\.skipInitialAccess\) this\.initializeExistingConversation\(\)/)
assert.match(source, /else this\.loadChatAccess\(\)/)
console.log('pc chat existing conversation tests passed')
