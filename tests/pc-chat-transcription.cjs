// node tests/pc-chat-transcription.cjs：内存模拟云信，不使用凭证或真实语音接口。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.resolve(__dirname, '..')
const panelSource = fs.readFileSync(path.join(root, 'components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')
const audioSource = fs.readFileSync(path.join(root, 'services/pc-chat-audio.js'), 'utf8').replace(/^export /gm, '')
const audioContext = vm.createContext({ module: { exports: {} } })
vm.runInContext(audioSource + '\nmodule.exports = { getAudioMimeType, audioDurationSeconds, audioBubbleWidth }', audioContext)
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function environment() {
  const calls = [], toasts = []
  let loggedIn = true, convert = async () => '识别出的文字', plays = 0
  const nim = { V2NIMMessageService: { voiceToText: params => { calls.push(params); return convert(params) } } }
  const globals = {
    module: { exports: {} }, ...audioContext.module.exports,
    NIM_EVENT: {}, NIM_EMOJIS: [], getNimInstance: () => nim, isNimLoggedIn: () => loggedIn,
    getActiveConversationId: () => '', clearActiveConversationId() {},
    formatConversationTime: () => '', parseNimEmojiText: () => [],
    createPcAudioPlayer: () => { plays++; return { play() {}, destroy() {} } },
    uni: { showToast: value => toasts.push(value.title) }, console: { warn() {} }
  }
  const context = vm.createContext(globals)
  vm.runInContext(panelSource.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports ='), context)
  const def = context.module.exports
  const panel = { conversation: {}, detail: { conversationId: 'a' }, enterpriseAccId: 'enterprise',
    drafts: {}, visible: true, opening: false, _alive: true,
    $set: (target, key, value) => { target[key] = value }, $delete: (target, key) => { delete target[key] } }
  Object.assign(panel, def.data.call(panel))
  Object.entries(def.methods).forEach(([key, fn]) => { panel[key] = fn.bind(panel) })
  Object.entries(def.computed).forEach(([key, getter]) => {
    if (typeof getter === 'function') Object.defineProperty(panel, key, { get: getter.bind(panel) })
  })
  panel.accessReady = true
  const audio = (id, attachment = {}) => ({ conversationId: 'a', messageClientId: id, messageType: 2,
    senderId: id === 'self' ? 'enterprise' : 'person', createTime: 100,
    attachment: { url: 'https://example.test/' + id + '.mp3', duration: 2500, ext: 'mp3', ...attachment } })
  panel.messages = [audio('other'), audio('self')]
  const row = (id = 'other') => panel.displayMessages.find(item => item.id === id)
  return { panel, def, nim, calls, toasts, audio, row,
    convert: fn => { convert = fn }, loggedIn: value => { loggedIn = value }, plays: () => plays }
}
async function verify() {
  const env = environment(), first = deferred(), second = deferred()
  env.convert(params => params.voiceUrl.includes('/other.') ? first.promise : second.promise)
  const converting = env.panel.transcribeAudioMessage(env.row())
  assert.equal(env.row().transcription.status, 'loading')
  await env.panel.transcribeAudioMessage(env.row())
  assert.equal(env.calls.length, 1)
  assert.deepEqual({ ...env.calls[0] }, { voiceUrl: 'https://example.test/other.mp3', duration: 2500 })
  const selfConversion = env.panel.transcribeAudioMessage(env.row('self'))
  assert.equal(env.calls.length, 2)
  second.resolve('自己的语音'); await selfConversion
  assert.equal(env.row('self').direction, 'self')
  assert.equal(env.row('self').transcription.text, '自己的语音')
  assert.equal(env.row().transcription.status, 'loading')
  first.resolve('  您好，方便介绍一下工作经历吗？\n<script>原样文本</script>  '); await converting
  assert.equal(env.row().transcription.text, '您好，方便介绍一下工作经历吗？\n<script>原样文本</script>')
  await env.panel.transcribeAudioMessage(env.row())
  assert.equal(env.calls.length, 2)
  assert.equal(env.row().durationSeconds, 3)
  assert.equal(env.plays(), 0)
  env.panel.mergeMessages([{ ...env.panel.messages[0], text: 'SDK 刷新消息' }])
  assert.equal(env.row().transcription.status, 'success')
  console.log('PASS: millisecond SDK parameters, independent incoming/outgoing results, duplicate clicks, result reuse, playback isolation')

  const retry = environment()
  retry.convert(async () => { throw new Error('network') })
  await retry.panel.transcribeAudioMessage(retry.row())
  assert.equal(retry.row().transcription.status, 'error')
  assert.equal(retry.row().transcription.error, '语音转文字失败，请重试')
  retry.convert(async () => '重试成功')
  await retry.panel.transcribeAudioMessage(retry.row())
  assert.equal(retry.calls.length, 2)
  assert.equal(retry.row().transcription.text, '重试成功')
  const empty = environment(); empty.convert(async () => '  ')
  await empty.panel.transcribeAudioMessage(empty.row())
  assert.equal(empty.row().transcription.status, 'error')
  assert.equal(empty.row().transcription.error, '未识别到文字，请重试')
  const unsupported = environment(); delete unsupported.nim.V2NIMMessageService.voiceToText
  await unsupported.panel.transcribeAudioMessage(unsupported.row())
  assert.equal(unsupported.row().transcription.error, '当前聊天服务不支持语音转文字')
  const invalid = environment(); invalid.panel.messages = [invalid.audio('other', { url: '' })]
  await invalid.panel.transcribeAudioMessage(invalid.row())
  assert.equal(invalid.calls.length, 0)
  assert.equal(invalid.row().transcription.error, '语音地址无效，无法转文字')
  console.log('PASS: failed requests can retry; empty recognition, missing URL and unavailable SDK show useful errors')

  for (const change of ['revoke', 'delete', 'replace', 'destroy']) {
    for (const outcome of ['resolve', 'reject']) {
      const stale = environment(), pending = deferred()
      stale.convert(() => pending.promise)
      const task = stale.panel.transcribeAudioMessage(stale.row())
      if (change === 'revoke') stale.panel.mergeMessages([{ ...stale.panel.messages[0], isRevoked: true }])
      if (change === 'delete') stale.panel.mergeMessages([{ ...stale.panel.messages[0], isDelete: true }])
      if (change === 'replace') stale.panel.mergeMessages([stale.audio('other', { url: 'https://example.test/replaced.mp3' })])
      if (change === 'destroy') { stale.panel._alive = false; stale.panel.releaseCurrentConversation() }
      if (outcome === 'resolve') pending.resolve('旧结果')
      else pending.reject(new Error('旧错误'))
      await task
      assert.equal(stale.panel.audioTranscriptions.other, undefined)
    }
  }
  const switched = environment(), old = deferred(), fresh = deferred()
  switched.convert(() => old.promise)
  const oldTask = switched.panel.transcribeAudioMessage(switched.row())
  switched.panel.visible = false; switched.def.watch.visible.call(switched.panel, false)
  assert.equal(switched.panel.audioTranscriptions.other, undefined)
  switched.panel.visible = true; switched.convert(() => fresh.promise)
  const newTask = switched.panel.transcribeAudioMessage(switched.row())
  old.resolve('切换前的结果'); await oldTask
  assert.equal(switched.row().transcription.status, 'loading')
  fresh.resolve('切换后的结果'); await newTask
  assert.equal(switched.row().transcription.text, '切换后的结果')
  console.log('PASS: revoke/delete/replace/destroy discard late success and failure; hiding and retrying isolates old requests')

  for (const [duration, measured, expected] of [['1250', undefined, 1250], [undefined, 4, 4000], [undefined, undefined, 0], [-1, undefined, 0]]) {
    const units = environment()
    units.panel.messages = [units.audio('other', { duration })]
    if (measured) units.panel.audioDurations.other = measured
    await units.panel.transcribeAudioMessage(units.row())
    assert.equal(units.calls[0].duration, expected)
  }
  for (const guard of ['hidden', 'opening', 'no-access', 'offline', 'foreign', 'text', 'revoked']) {
    const blocked = environment()
    if (guard === 'hidden') blocked.panel.visible = false
    if (guard === 'opening') blocked.panel.opening = true
    if (guard === 'no-access') blocked.panel.accessReady = false
    if (guard === 'offline') blocked.loggedIn(false)
    if (guard === 'foreign') blocked.panel.messages[0].conversationId = 'b'
    if (guard === 'text') blocked.panel.messages[0].messageType = 0
    if (guard === 'revoked') blocked.panel.messages[0].isRevoked = true
    await blocked.panel.transcribeAudioMessage(blocked.row())
    assert.equal(blocked.calls.length, 0)
  }
  console.log('PASS: duration fallback and connection/access/message guards')
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
