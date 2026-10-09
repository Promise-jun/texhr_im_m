const AUDIO_MIME_TYPES = {
	mp3: 'audio/mpeg', mpeg: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4',
	aac: 'audio/aac', wav: 'audio/wav', amr: 'audio/amr', awb: 'audio/amr-wb',
	ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac'
}

export function getAudioMimeType(attachment = {}) {
	for (const value of [attachment.mimeType, attachment.contentType, attachment.mime]) {
		const mime = String(value || '').trim().toLowerCase()
		if (/^audio\//.test(mime)) return mime
			.replace(/^audio\/(?:m4a|x-m4a|x-mp4)(?=;|$)/, 'audio/mp4')
			.replace(/^audio\/x-wav(?=;|$)/, 'audio/wav').replace(/^audio\/mp3(?=;|$)/, 'audio/mpeg')
	}
	// 云信下载地址可能没有后缀，优先使用附件的 ext/name，最后才从 URL 推断。
	for (const value of [attachment.ext, attachment.name, attachment.url]) {
		const match = String(value || '').toLowerCase().match(/(?:^|\.)(mp3|mpeg|m4a|mp4|aac|wav|amr|awb|ogg|opus|webm|flac)(?:$|[?#])/)
		if (match) return AUDIO_MIME_TYPES[match[1]]
	}
	return ''
}

export function audioDurationSeconds(milliseconds) {
	// V2 云信语音附件 duration 的单位是毫秒；缺失时长由播放后的 metadata 补充。
	const duration = Number(milliseconds)
	return Number.isFinite(duration) && duration > 0 ? Math.ceil(duration / 1000) : 0
}

export function audioBubbleWidth(seconds) {
	const duration = Math.min(60, Math.max(1, Number(seconds) || 1))
	return `${Math.round(120 + (duration - 1) * 180 / 59)}px`
}

export function normalizeAudioUrl(value) {
	let source = String(value || '').trim()
	if (!source) return ''
	if (typeof window === 'undefined') return source
	// HTTPS 页面不能播放 HTTP 混合内容，云信下载链接改用 HTTPS。
	if (window.location.protocol === 'https:') source = source.replace(/^http:\/\//i, 'https://')
	try {
		const url = new window.URL(source, window.location.href)
		return /^(https?:|blob:)$/.test(url.protocol) || /^data:audio\//i.test(source) ? url.href : ''
	} catch (error) {
		return ''
	}
}

function playbackErrorMessage(error, mimeType) {
	if (error && error.name === 'NotAllowedError') return '浏览器阻止了语音播放，请再次点击'
	if (/^audio\/amr(?:-wb)?(?:;|$)/.test(mimeType)) return '当前浏览器不支持 AMR 语音，请转换为 MP3 后播放'
	if (error && (error.name === 'NotSupportedError' || Number(error.code) === 3 || Number(error.code) === 4)) {
		return '当前浏览器无法解码此语音，请使用兼容的音频格式'
	}
	return '语音加载失败，请检查网络后重试'
}

// 每个聊天面板只持有一个播放器；不设置 crossOrigin，避免原本能直播放的链接被 CORS 拦截。
export function createPcAudioPlayer({ onState, onDuration, onError }) {
	let current = null
	const isCurrent = session => current === session
	const isCurrentAudio = (session, audio, attempt) =>
		isCurrent(session) && session.audio === audio && session.attempt === attempt

	function detachAudio(session) {
		const audio = session.audio
		session.audio = null
		session.attempt = null
		if (!audio) return
		audio.onplaying = audio.onwaiting = audio.onstalled = audio.onended = null
		audio.onpause = audio.onerror = audio.onloadedmetadata = null
		audio.pause()
		audio.removeAttribute('src')
		audio.load()
	}

	function destroy() {
		const previous = current
		// 先使旧会话失效，随后 pause/load 引发的事件或 play() 拒绝不会影响新语音。
		current = null
		if (previous) {
			clearTimeout(previous.timer)
			if (previous.controller) previous.controller.abort()
			detachAudio(previous)
			if (previous.objectUrl) window.URL.revokeObjectURL(previous.objectUrl)
		}
		onState('', 'idle')
	}

	function setState(session, state) {
		if (!isCurrent(session)) return
		clearTimeout(session.timer)
		onState(session.message.id, state)
		if (state === 'loading') {
			session.timer = setTimeout(() => fail(session, new Error('Audio loading timeout')), 20000)
		}
	}

	function fail(session, error) {
		if (!isCurrent(session)) return
		const title = playbackErrorMessage(error, session.mimeType)
		destroy()
		onError(title)
	}

	async function retryFromBlob(session, originalError, audio) {
		try {
			if (typeof window.fetch !== 'function' || typeof window.URL.createObjectURL !== 'function') {
				fail(session, originalError)
				return
			}
			if (typeof window.AbortController === 'function') session.controller = new window.AbortController()
			const response = await window.fetch(session.source, { mode: 'cors', credentials: 'omit',
				signal: session.controller ? session.controller.signal : undefined })
			if (!isCurrent(session)) return
			if (!response.ok) throw new Error('Audio request failed')
			const blob = await response.blob()
			if (!isCurrent(session)) return
			if (!blob.size) throw new Error('Empty audio')
			const mime = /^audio\//i.test(blob.type) ? getAudioMimeType({ mimeType: blob.type }) : session.mimeType
			session.mimeType = mime
			// 仅修正 octet-stream 等错误响应类型，不会把 AMR 等不支持的编码伪装成 MP3。
			const playable = mime && blob.type !== mime ? new window.Blob([blob], { type: mime }) : blob
			session.objectUrl = window.URL.createObjectURL(playable)
			// Safari 的播放许可与元素有关，重试沿用点击时的元素，不另建自动播放元素。
			startAudio(session, session.objectUrl, audio)
		} catch (error) {
			// 切消息/切会话时会取消请求，旧响应和旧错误均不再更新界面。
			if (isCurrent(session)) fail(session, error)
		}
	}

	function handleError(session, audio, attempt, error) {
		if (!isCurrentAudio(session, audio, attempt)) return
		const decodeError = error && (error.name === 'NotSupportedError' || Number(error.code) === 3 || Number(error.code) === 4)
		// Safari 等浏览器对附件 MIME 更敏感；仅在解码失败时尝试一次带正确 MIME 的 Blob。
		if (decodeError && !session.retried && !/^audio\/amr/.test(session.mimeType)) {
			session.retried = true
			detachAudio(session)
			setState(session, 'loading')
			retryFromBlob(session, error, audio)
			return
		}
		fail(session, error)
	}

	function startAudio(session, source, previousAudio) {
		const audio = previousAudio || new window.Audio()
		const attempt = {}
		session.audio = audio
		session.attempt = attempt
		audio.preload = 'auto'
		audio.src = source
		// 不添加 source.type：历史附件可能误报 MIME，交给浏览器按实际容器识别编码。
		audio.onloadedmetadata = () => {
			if (isCurrentAudio(session, audio, attempt) && Number.isFinite(audio.duration) && audio.duration > 0) {
				onDuration(session.message.id, Math.ceil(audio.duration))
			}
		}
		audio.onplaying = () => { if (isCurrentAudio(session, audio, attempt)) setState(session, 'playing') }
		audio.onwaiting = audio.onstalled = () => { if (isCurrentAudio(session, audio, attempt)) setState(session, 'loading') }
		audio.onended = () => { if (isCurrentAudio(session, audio, attempt) && audio.ended) destroy() }
		audio.onpause = () => { if (isCurrentAudio(session, audio, attempt) && audio.paused) destroy() }
		audio.onerror = () => { if (audio.error) handleError(session, audio, attempt, audio.error) }
		try {
			// 首次 play 在用户点击栈中调用，兼容 Chrome/Edge/Firefox/Safari 的自动播放限制。
			const result = audio.play()
			if (result && typeof result.catch === 'function') result.catch(error => handleError(session, audio, attempt, error))
		} catch (error) {
			handleError(session, audio, attempt, error)
		}
	}

	return {
		destroy,
		play(message) {
			if (current && current.message.id === message.id) { destroy(); return }
			destroy()
			if (typeof window === 'undefined' || typeof window.Audio !== 'function') {
				onError('当前浏览器不支持音频播放，请使用新版浏览器')
				return
			}
			const source = normalizeAudioUrl(message.url)
			if (!source) { onError('语音地址无效，无法播放'); return }
			const session = { message, source, mimeType: message.mimeType || '', retried: false, audio: null }
			current = session
			setState(session, 'loading')
			try { startAudio(session, source) } catch (error) { fail(session, error) }
		}
	}
}
