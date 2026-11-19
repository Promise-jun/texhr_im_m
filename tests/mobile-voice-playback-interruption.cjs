const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../pages/person/m/chat.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')

function createPage(conversationId, events) {
  const context = vm.createContext({
    module: { exports: {} },
    console,
    isNimLoggedIn: () => true,
    setInterval: () => 1,
    clearInterval() {},
    uni: { showToast() {} }
  })
  vm.runInContext(script, context)

  const page = {
    conversationId,
    isRecording: false,
    _voiceFinishing: false,
    isSendingMessage: false,
    isTranscribingVoice: false,
    destroyAudioPlayer() { events.push('stop-playback') },
    clearVoiceTimer() {},
    async beginVoiceCapture() { events.push('start-recording') }
  }
  page.startVoiceRecording = context.module.exports.methods.startVoiceRecording.bind(page)
  return page
}

async function verify() {
  const events = []
  await createPage('p2p-enterprise-1', events).startVoiceRecording()
  assert.deepEqual(events, ['stop-playback', 'start-recording'])

  const unavailableEvents = []
  await createPage('', unavailableEvents).startVoiceRecording()
  assert.deepEqual(unavailableEvents, ['stop-playback'], 'pressing to talk must stop playback even when recording cannot start')

  console.log('mobile voice playback interruption tests passed')
}

verify().catch(error => {
  console.error(error)
  process.exitCode = 1
})
