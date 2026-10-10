// node tests/pc-chat-emoji.cjs：仅验证本地逻辑，SDK 与发送接口均为内存模拟，不使用真实账号。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.resolve(__dirname, '..')

function helpers(file, names) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^export /gm, '')
  const context = vm.createContext({ module: { exports: {} }, setTimeout, clearTimeout })
  vm.runInContext(source + '\nmodule.exports = {' + names.join(',') + '}', context)
  return context.module.exports
}

const emoji = helpers('services/nim-emoji.js', ['NIM_EMOJIS', 'parseNimEmojiText'])
const audio = helpers('services/pc-chat-audio.js', ['getAudioMimeType', 'audioDurationSeconds', 'audioBubbleWidth', 'createPcAudioPlayer'])
const panelSource = fs.readFileSync(path.join(root, 'components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')

function environment() {
  const toasts = [], sends = []
  const nim = {
    V2NIMUserService: { checkBlock: async accounts => ({ [accounts[0]]: false }) },
    V2NIMMessageCreator: { createTextMessage: text => ({ text }) },
    V2NIMMessageService: { sendMessage: async (message, id) => {
      sends.push({ text: message.text, conversationId: id })
      return { message: { ...message, messageType: 0, conversationId: id, messageClientId: 'sent',
        senderId: 'enterprise', isSelf: true, createTime: 1000 } }
    } }
  }
  const context = vm.createContext({ ...emoji, ...audio, module: { exports: {} },
    console: { log() {}, warn() {} }, uni: { showToast: value => toasts.push(value.title) },
    getNimInstance: () => nim, isNimLoggedIn: () => true, formatConversationTime: () => '10:20' })
  const script = panelSource.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'module.exports =')
  vm.runInContext(script, context)
  const def = context.module.exports
  const panel = { conversation: { name: '模拟会话', stickTop: false }, detail: { conversationId: 'a' },
    enterpriseAccId: 'enterprise', personAccId: 'a', drafts: {}, visible: true, opening: false,
    _alive: true, $refs: {}, $set: (object, key, value) => { object[key] = value },
    $emit() {}, $nextTick: fn => Promise.resolve().then(fn) }
  Object.assign(panel, def.data.call(panel))
  for (const [name, fn] of Object.entries(def.methods)) panel[name] = fn.bind(panel)
  for (const [name, getter] of Object.entries(def.computed)) {
    Object.defineProperty(panel, name, typeof getter === 'function' ? { get: getter.bind(panel) }
      : { get: getter.get.bind(panel), set: getter.set.bind(panel) })
  }
  panel.accessReady = true
  return { panel, toasts, sends }
}

async function verify() {
  const { NIM_EMOJIS, parseNimEmojiText } = emoji
  const { panel, toasts, sends } = environment()
  assert.strictEqual(panel.emojis, NIM_EMOJIS)
  assert.equal(new Set(NIM_EMOJIS.map(item => item.key)).size, NIM_EMOJIS.length)
  assert.ok(NIM_EMOJIS.length > 60)
  for (const item of NIM_EMOJIS) {
    assert.match(item.url, /^https:\/\/yx-web-nosdn\.netease\.im\/common\//)
    const segments = parseNimEmojiText(item.key)
    assert.equal(segments.length, 1)
    assert.equal(segments[0].type, 'emoji')
    assert.equal(segments[0].url, item.url)
  }
  console.log('PASS: PC and mobile share the same complete Netease emoji keys and CDN images')

  for (const text of ['', '普通文本', '[未知表情]', '您好[大笑][赞]\n第二行 [未知] <img src=x>']) {
    const segments = parseNimEmojiText(text)
    assert.equal(segments.map(segment => segment.type === 'emoji' ? segment.key : segment.content).join(''), text)
  }
  const original = '您好[大笑][赞]\n[未知表情]'
  panel.mergeMessages([{ conversationId: 'a', messageClientId: 'history', senderId: 'a', createTime: 1,
    messageType: 0, text: original }])
  const row = panel.displayMessages.find(item => item.id === 'history')
  assert.equal(row.type, 'text')
  assert.equal(row.content, original)
  assert.equal(row.segments.filter(item => item.type === 'emoji').length, 2)
  assert.equal(row.segments[row.segments.length - 1].content, '\n[未知表情]')
  assert.ok(!panelSource.includes('v-html'))
  console.log('PASS: received/history messages parse mixed and adjacent emoji while preserving unknown keys, newlines and text')

  panel.draft = '您好'; panel.emojiVisible = true
  panel.appendEmoji(NIM_EMOJIS[0])
  assert.equal(panel.draft, '您好[大笑]')
  assert.equal(panel.emojiVisible, false)
  panel.appendEmoji(null); panel.appendEmoji({})
  assert.equal(panel.draft, '您好[大笑]')
  panel.draft = 'x'.repeat(2000 - NIM_EMOJIS[0].key.length)
  panel.appendEmoji(NIM_EMOJIS[0])
  assert.equal(panel.draft.length, 2000)
  assert.ok(panel.draft.endsWith(NIM_EMOJIS[0].key))
  panel.draft = 'x'.repeat(1999); panel.appendEmoji(NIM_EMOJIS[0])
  assert.equal(panel.draft, 'x'.repeat(1999))
  assert.match(toasts[0], /2000/)
  console.log('PASS: emoji insertion writes a complete key and never truncates it at the composer length limit')

  panel.draft = '您好[大笑][赞]'
  await panel.sendMessage()
  assert.equal(sends.length, 1)
  assert.equal(sends[0].text, '您好[大笑][赞]')
  assert.equal(sends[0].conversationId, 'a')
  assert.equal(panel.draft, '')
  assert.equal(panel.displayMessages.find(item => item.id === 'sent').segments.filter(item => item.type === 'emoji').length, 2)
  console.log('PASS: simulated SDK sending keeps text keys, clears the draft and displays the sent emoji as images')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
