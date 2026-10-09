// Run with Node.js: node tests/pc-chat-audio.cjs. No SDK, credentials or network required.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const source = fs.readFileSync(path.join(__dirname, '../services/pc-chat-audio.js'), 'utf8')
  .replace(/^export /gm, '') + '\nmodule.exports = { getAudioMimeType, audioDurationSeconds, audioBubbleWidth, normalizeAudioUrl, createPcAudioPlayer }'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

function environment() {
  const audios = [], states = [], durations = [], errors = [], requests = [], objects = [], revoked = [], timers = new Map()
  let nextTimer = 0, nextPlay = () => Promise.resolve(), fetchResponse = async () => {
    throw new Error('Fetch unavailable')
  }
  class MockAudio {
    constructor() { audios.push(this); this.pauseCount = 0; this.loadCount = 0 }
    play() { this.paused = false; this.playCount = (this.playCount || 0) + 1; return nextPlay(this) }
    pause() { this.paused = true; this.pauseCount++; if (this.onpause) this.onpause() }
    load() { this.loadCount++; this.error = null; this.ended = false }
    removeAttribute(name) { delete this[name] }
    emit(name) { if (name === 'ended') this.ended = true; if (this['on' + name]) this['on' + name]() }
  }
  class MockBlob {
    constructor(parts, options = {}) {
      this.size = parts.reduce((size, part) => size + (part.size || String(part).length), 0)
      this.type = options.type || ''
    }
  }
  class MockURL extends URL {
    static createObjectURL(blob) { objects.push(blob); return 'blob:audio-' + objects.length }
    static revokeObjectURL(url) { revoked.push(url) }
  }
  class MockAbortController {
    constructor() { this.signal = { aborted: false } }
    abort() { this.signal.aborted = true }
  }
  const window = { Audio: MockAudio, Blob: MockBlob, URL: MockURL, AbortController: MockAbortController,
    location: { protocol: 'https:', href: 'https://example.test/chat' },
    fetch: (url, options) => { requests.push({ url, options }); return fetchResponse() } }
  const context = vm.createContext({ module: { exports: {} }, window,
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer }, clearTimeout: id => timers.delete(id) })
  vm.runInContext(source, context)
  const api = context.module.exports
  const player = api.createPcAudioPlayer({ onState: (id, state) => states.push([id, state]),
    onDuration: (id, seconds) => durations.push([id, seconds]), onError: title => errors.push(title) })
  return { api, player, window, audios, states, durations, errors, requests, objects, revoked, timers,
    playResult: fn => { nextPlay = fn }, fetchResult: fn => { fetchResponse = fn },
    blob: (type = 'application/octet-stream', size = 12) => ({ size, type }) }
}
const message = (id = 'a', mimeType = 'audio/mpeg') => ({ id, mimeType, url: 'https://example.test/' + id })
const last = items => items[items.length - 1]

async function verify() {
  const normal = environment(), api = normal.api
  for (const duration of [null, undefined, NaN, Infinity, -1, 0, 'invalid']) assert.equal(api.audioDurationSeconds(duration), 0)
  assert.equal(api.audioDurationSeconds(1), 1)
  assert.equal(api.audioDurationSeconds(2500), 3)
  assert.equal(api.audioDurationSeconds('60000'), 60)
  assert.equal(api.audioBubbleWidth(1), '120px')
  assert.equal(api.audioBubbleWidth(30), '208px')
  assert.equal(api.audioBubbleWidth(60), '300px')
  assert.equal(api.audioBubbleWidth(600), '300px')
  assert.equal(api.audioBubbleWidth(-5), '120px')
  assert.equal(api.getAudioMimeType({ ext: 'MP3' }), 'audio/mpeg')
  assert.equal(api.getAudioMimeType({ name: 'recording.M4A', url: '/unknown' }), 'audio/mp4')
  assert.equal(api.getAudioMimeType({ url: 'https://test/voice.webm?token=x' }), 'audio/webm')
  assert.equal(api.getAudioMimeType({ mimeType: 'audio/X-WAV' }), 'audio/wav')
  assert.equal(api.getAudioMimeType({ mimeType: 'audio/x-m4a;codecs=mp4a.40.2' }), 'audio/mp4;codecs=mp4a.40.2')
  assert.equal(api.getAudioMimeType({ mimeType: 'application/octet-stream', contentType: 'audio/ogg' }), 'audio/ogg')
  assert.equal(api.getAudioMimeType({ url: '/unknown' }), '')
  assert.equal(api.normalizeAudioUrl('http://test/voice name.mp3'), 'https://test/voice%20name.mp3')
  assert.equal(api.normalizeAudioUrl('/voice.mp3'), 'https://example.test/voice.mp3')
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,hello', 'file:///voice.mp3']) assert.equal(api.normalizeAudioUrl(url), '')
  console.log('PASS: duration units, bounded proportional widths, MIME aliases/codecs, secure URL normalization')

  normal.player.play(message())
  const first = normal.audios[0]
  assert.deepEqual(last(normal.states), ['a', 'loading'])
  assert.equal(first.crossOrigin, undefined)
  first.duration = 2.4; first.emit('loadedmetadata')
  assert.deepEqual(last(normal.durations), ['a', 3])
  first.emit('playing')
  assert.deepEqual(last(normal.states), ['a', 'playing'])
  assert.equal(normal.timers.size, 0)
  first.emit('waiting')
  assert.deepEqual(last(normal.states), ['a', 'loading'])
  first.emit('playing'); first.emit('ended')
  assert.deepEqual(last(normal.states), ['', 'idle'])
  assert.equal(first.pauseCount, 1)
  assert.equal(first.src, undefined)
  assert.equal(first.onended, null)
  normal.player.play(message()); normal.player.play(message())
  assert.deepEqual(last(normal.states), ['', 'idle'])
  assert.equal(normal.timers.size, 0)
  normal.playResult(() => undefined)
  normal.player.play(message('legacy')); last(normal.audios).emit('playing')
  assert.deepEqual(last(normal.states), ['legacy', 'playing'])
  normal.player.destroy()
  console.log('PASS: loading/playing/end states, metadata duration, click-to-stop, legacy play(), resource cleanup')

  const stale = environment(), pendingPlay = deferred()
  stale.playResult(() => pendingPlay.promise)
  stale.player.play(message('a'))
  const oldError = stale.audios[0].onerror, oldPlaying = stale.audios[0].onplaying
  stale.playResult(() => Promise.resolve())
  stale.player.play(message('b')); last(stale.audios).emit('playing')
  oldError(); oldPlaying(); pendingPlay.reject({ name: 'NotAllowedError' }); await flush()
  assert.deepEqual(last(stale.states), ['b', 'playing'])
  assert.equal(stale.errors.length, 0)
  assert.equal(stale.audios[0].pauseCount, 1)
  stale.player.destroy()
  console.log('PASS: exclusive playback, stale media events and rejected old play promises cannot stop a new message')

  const retry = environment(), fetchResult = deferred(), rejectedPlay = deferred()
  retry.fetchResult(() => fetchResult.promise); retry.playResult(() => rejectedPlay.promise)
  retry.player.play(message())
  const failedAudio = retry.audios[0]
  failedAudio.error = { code: 4 }; failedAudio.emit('error')
  rejectedPlay.reject({ name: 'NotSupportedError' }); await flush()
  assert.equal(retry.requests.length, 1)
  assert.equal(retry.requests[0].options.credentials, 'omit')
  retry.playResult(() => Promise.resolve())
  fetchResult.resolve({ ok: true, blob: async () => retry.blob() }); await flush()
  assert.equal(retry.audios.length, 1)
  assert.equal(retry.audios[0].playCount, 2)
  assert.equal(retry.objects[0].type, 'audio/mpeg')
  last(retry.audios).emit('playing'); last(retry.audios).emit('ended')
  assert.equal(retry.revoked[0], 'blob:audio-1')
  assert.equal(retry.errors.length, 0)
  console.log('PASS: one MIME-correction retry for duplicate error/rejection, Blob playback, object URL revocation')

  const reused = environment(), oldPlay = deferred()
  reused.playResult(() => oldPlay.promise)
  reused.fetchResult(async () => ({ ok: true, blob: async () => reused.blob() }))
  reused.player.play(message())
  const oldCallback = reused.audios[0].onplaying
  reused.playResult(() => Promise.resolve())
  reused.audios[0].error = { code: 4 }; reused.audios[0].emit('error'); await flush()
  assert.equal(reused.audios.length, 1)
  reused.audios[0].emit('playing')
  oldPlay.reject({ name: 'NotSupportedError' }); oldCallback(); await flush()
  reused.audios[0].onpause(); reused.audios[0].onended(); reused.audios[0].onerror()
  assert.deepEqual(last(reused.states), ['a', 'playing'])
  assert.equal(reused.errors.length, 0)
  reused.player.destroy()
  console.log('PASS: Safari retry reuses the clicked element; stale attempt promises and queued media events are ignored')

  for (const abortAvailable of [true, false]) {
    const cancel = environment(), delayed = deferred()
    if (!abortAvailable) delete cancel.window.AbortController
    cancel.fetchResult(() => delayed.promise)
    cancel.player.play(message())
    cancel.audios[0].error = { code: 3 }; cancel.audios[0].emit('error')
    cancel.player.destroy()
    if (abortAvailable) assert.equal(cancel.requests[0].options.signal.aborted, true)
    cancel.player.play(message('b')); last(cancel.audios).emit('playing')
    delayed.resolve({ ok: true, blob: async () => cancel.blob() }); await flush()
    assert.equal(cancel.objects.length, 0)
    assert.equal(cancel.audios.length, 2)
    assert.deepEqual(last(cancel.states), ['b', 'playing'])
    assert.equal(cancel.errors.length, 0)
    cancel.player.destroy()
  }
  const bodyCancel = environment(), body = deferred()
  bodyCancel.fetchResult(async () => ({ ok: true, blob: () => body.promise }))
  bodyCancel.player.play(message()); bodyCancel.audios[0].error = { code: 4 }; bodyCancel.audios[0].emit('error')
  await flush(); bodyCancel.player.destroy(); body.resolve(bodyCancel.blob()); await flush()
  assert.equal(bodyCancel.objects.length, 0)
  console.log('PASS: abort and stale response/body protection, including browsers without AbortController')

  const blocked = environment()
  blocked.playResult(() => Promise.reject({ name: 'NotAllowedError' }))
  blocked.player.play(message()); await flush()
  assert.match(blocked.errors[0], /再次点击/)
  assert.deepEqual(last(blocked.states), ['', 'idle'])
  assert.equal(blocked.timers.size, 0)
  const amr = environment()
  amr.player.play(message('amr', 'audio/amr'))
  amr.audios[0].error = { code: 4 }; amr.audios[0].emit('error')
  assert.match(amr.errors[0], /AMR/)
  assert.equal(amr.requests.length, 0)
  const network = environment()
  network.player.play(message()); network.audios[0].error = { code: 2 }; network.audios[0].emit('error')
  assert.match(network.errors[0], /网络/)
  const unsupported = environment()
  unsupported.fetchResult(async () => ({ ok: true, blob: async () => unsupported.blob('audio/webm') }))
  unsupported.player.play(message('webm', 'audio/webm'))
  unsupported.audios[0].error = { code: 4 }; unsupported.audios[0].emit('error'); await flush()
  last(unsupported.audios).error = { code: 4 }; last(unsupported.audios).emit('error')
  assert.match(unsupported.errors[0], /无法解码/)
  assert.equal(unsupported.requests.length, 1)
  assert.equal(unsupported.revoked.length, 1)
  for (const response of [{ ok: false }, { ok: true, blob: async () => ({ type: 'audio/mpeg', size: 0 }) }]) {
    const badResource = environment()
    badResource.fetchResult(async () => response)
    badResource.player.play(message()); badResource.audios[0].error = { code: 4 }; badResource.audios[0].emit('error')
    await flush()
    assert.match(badResource.errors[0], /网络/)
    assert.equal(badResource.objects.length, 0)
  }
  const timeout = environment()
  timeout.player.play(message()); last(Array.from(timeout.timers.values()))()
  assert.match(timeout.errors[0], /重试/)
  assert.equal(timeout.timers.size, 0)
  const unavailable = environment(); delete unavailable.window.Audio
  unavailable.player.play(message()); assert.match(unavailable.errors[0], /新版浏览器/)
  const invalid = environment()
  invalid.player.play({ id: 'empty', url: '' }); assert.match(invalid.errors[0], /地址无效/)
  assert.equal(invalid.audios.length, 0)
  console.log('PASS: autoplay restrictions, unsupported formats, bounded retry, network/timeout errors and missing audio URLs')
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
