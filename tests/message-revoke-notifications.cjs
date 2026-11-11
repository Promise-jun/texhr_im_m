const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function component(file, globals) {
  const source = read(file).match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports =')
  const context = vm.createContext({ module: { exports: {} }, ...globals })
  vm.runInContext(source, context)
  return context.module.exports
}
function instance(def, base) {
  Object.assign(base, def.data.call(base))
  for (const [name, method] of Object.entries(def.methods)) base[name] = method.bind(base)
  for (const [name, getter] of Object.entries(def.computed || {})) {
    Object.defineProperty(base, name, typeof getter === 'function' ? { get: getter.bind(base) } : { get: getter.get.bind(base), set: getter.set.bind(base) })
  }
  return base
}
const listeners = {}
const sdk = { V2NIMMessageService: { on: (name, fn) => { listeners[name] = fn } },
  V2NIMLoginService: { on() {} }, V2NIMLocalConversationService: { on() {} } }
const events = []
const nimSource = read('services/nim.js').replace(/import[^\n]*\n/g, '').replace(/export /g, '') + '\nmodule.exports = { initNim, NIM_EVENT }'
const nimContext = vm.createContext({ module: { exports: {} }, NIM: { getInstance: () => sdk }, uni: { $emit: (...args) => events.push(args) }, console })
vm.runInContext(nimSource, nimContext)
nimContext.module.exports.initNim()
const eventName = nimContext.module.exports.NIM_EVENT.MESSAGE_REVOKED
const a = { conversationId: 'a', messageClientId: 'client', messageServerId: 'server', senderId: 'other', messageType: 0, text: 'hello', createTime: 100 }
const notice = { messageRefer: { conversationId: 'a', messageClientId: 'client', messageServerId: 'server' } }
listeners.onMessageRevokeNotifications([null, notice])
assert.equal(events.length, 1)
assert.equal(events[0][0], eventName)
assert.equal(events[0][1][0], notice)
const globals = { DEFAULT_TALENT_AVATAR: '', NIM_EVENT: nimContext.module.exports.NIM_EVENT, NIM_EMOJIS: [], console: { log() {}, warn() {}, error() {} },
  parseNimEmojiText: () => [], getAudioMimeType: () => '', audioDurationSeconds: () => 0,
  audioBubbleWidth: () => '', formatConversationTime: () => '' }
const mobileDef = component('pages/person/m/chat.vue', globals)
const mobile = instance(mobileDef, { _chatPageAlive: true, conversationId: 'a', $nextTick: fn => fn() })
mobile.conversationId = 'a'
mobile.messages = [a, { ...a, conversationId: 'a', messageClientId: 'other', messageServerId: 'other' }]
mobile.handleMessageRevoked([{ messageRefer: { ...notice.messageRefer, conversationId: 'b' } }])
assert.equal(mobile.messages[0].isRevoked, undefined)
let mobileAudioStopped = false
mobile.audioPlayingId = 'client'
mobile.destroyAudioPlayer = () => { mobileAudioStopped = true; mobile.audioPlayingId = '' }
mobile.handleMessageRevoked([notice])
assert.equal(mobileAudioStopped, true)
assert.equal(mobile.messages[0].isRevoked, true)
assert.equal(mobile.displayMessages.find(m => m.type === 'revoked').content, '对方撤回了一条消息')
assert.equal(mobile.messages[1].isRevoked, undefined)
mobile.commitMessages([a])
assert.equal(mobile.messages.find(m => m.messageClientId === 'client').isRevoked, true)
mobile.messages = []
mobile.commitMessages([{ ...a, messageClientId: 'different' }])
assert.equal(mobile.messages[0].isRevoked, true, 'server ID matches a delayed history response')
const pcDef = component('components/pc-chat-panel/pc-chat-panel.vue', globals)
const pc = instance(pcDef, { conversation: {}, detail: { conversationId: 'a' }, enterpriseAccId: 'self', _alive: true, $nextTick: fn => fn() })
pc.messages = [a]
let pcAudioStopped = false
pc.audioActiveId = 'client'
pc.stopAudio = () => { pcAudioStopped = true; pc.audioActiveId = '' }
pc.handleMessageRevoked([notice])
assert.equal(pcAudioStopped, true)
assert.equal(pc.messages[0].isRevoked, true)
assert.equal(pc.displayMessages.find(m => m.type === 'revoked').content, '对方撤回了一条消息')
pc.messages = []
pc.mergeMessages([a])
assert.equal(pc.messages[0].isRevoked, true, 'notification arriving before history is retained')
assert.match(read('pages/person/m/chat.vue'), /message.direction === 'self'[^\n]*reEditMessage/)
assert.match(read('components/pc-chat-panel/pc-chat-panel.vue'), /message.direction === 'self'[^\n]*reEditMessage/)
console.log('PASS: SDK recall events update both chat views, filter conversations, and survive delayed history')
