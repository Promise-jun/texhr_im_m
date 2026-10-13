const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')

const context = vm.createContext({
  module: { exports: {} },
  NIM_EMOJIS: [],
  audioBubbleWidth: () => '120px',
  audioDurationSeconds: () => 0,
  clearActiveConversationId() {},
  createPcAudioPlayer() {},
  formatConversationTime: () => '10:20',
  getActiveConversationId: () => '',
  getAudioMimeType: () => '',
  getNimInstance() {},
  isNimLoggedIn: () => true,
  markNimConversationRead: async () => {},
  NIM_EVENT: {},
  parseNimEmojiText: text => [{ type: 'text', content: text }],
  requestApi: async () => ({}),
  setActiveConversationId() {},
  uni: {},
  console: { log() {}, warn() {} }
})
vm.runInContext(script, context)

const definition = context.module.exports
const panel = {
  conversation: { name: '人才', stickTop: false },
  detail: { conversationId: 'p2p-person' },
  enterpriseAccId: 'enterprise',
  personAccId: 'person',
  drafts: {},
  visible: true,
  opening: false,
  $set(object, key, value) { object[key] = value }
}
Object.assign(panel, definition.data.call(panel))
for (const [name, method] of Object.entries(definition.methods)) panel[name] = method.bind(panel)
for (const [name, getter] of Object.entries(definition.computed)) {
  Object.defineProperty(panel, name, typeof getter === 'function' ? { get: getter.bind(panel) }
    : { get: getter.get.bind(panel), set: getter.set.bind(panel) })
}

panel.messages = [{
  messageClientId: 'person-card',
  messageType: 100,
  senderId: 'person',
  createTime: 1,
  attachment: {
    raw: JSON.stringify({
      type: 4,
      data: JSON.stringify({
        Person: {
          PersonName: '智联叶子',
          Gender: 2,
          Age: 24,
          Education: '大专',
          Experience: '应届生',
          JobName: '订珠工',
          Location: '国外'
        }
      })
    })
  }
}]

const card = panel.displayMessages.find(message => message.id === 'person-card')
assert.equal(card.type, 'person-card')
assert.equal(card.direction, 'other')
assert.equal(card.person.name, '智联叶子')
assert.deepEqual(Array.from(card.person.meta), ['女', '24岁', '大专', '应届生'])
assert.equal(card.person.jobName, '订珠工')
assert.equal(card.person.location, '国外')

panel.messages[0].attachment.raw = JSON.stringify({ type: 4, data: { Person: { PersonName: '王先生' } } })
assert.equal(panel.displayMessages.find(message => message.id === 'person-card').type, 'person-card')

panel.messages[0].attachment.raw = JSON.stringify({ type: 4, data: { Person: null } })
assert.equal(panel.displayMessages.find(message => message.id === 'person-card').type, 'text')
panel.messages[0].attachment.raw = JSON.stringify({ type: 4, data: { Person: {} } })
assert.equal(panel.displayMessages.find(message => message.id === 'person-card').type, 'text')
assert.ok(source.includes('/static/pc/icon_job.png'))
assert.ok(source.includes('/static/pc/icon_location.png'))

console.log('PASS: PC custom type=4 Person messages render the person information card and malformed Person payloads fall back to text')
