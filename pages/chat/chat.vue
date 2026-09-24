<template>
	<view class="chat-page">
		<view class="fixed-header" :style="{ paddingTop: `${statusBarHeight}px` }">
			<view class="navigation-bar">
				<view class="back-button" aria-label="返回" @click="navigateBack">
					<text class="back-icon"></text>
				</view>
				<text class="navigation-title">聊天详情</text>
			</view>

			<view class="action-menu">
				<view v-for="action in actions" :key="action.key" class="action-item" @click="handleAction(action)">
					<view class="action-icon-wrap">
						<image :src="action.iconUrl" mode="aspectFit" :style="action.style"></image>
						<text v-if="action.key === 'pin' && isPinned" class="action-dot"></text>
					</view>
					<text class="action-label">{{ action.key === 'pin' && isPinned ? '取消置顶' : action.label }}</text>
				</view>
			</view>
		</view>

		<scroll-view class="message-scroll" :class="{ 'message-scroll--panel': activePanel }"
			:style="{ top: scrollTopStyle }" scroll-y :scroll-into-view="scrollIntoView"
			:scroll-with-animation="scrollWithAnimation" :upper-threshold="80" @scrolltoupper="loadEarlierMessages"
			@click="closePanel">
			<view class="message-content">
				<view class="load-status" :class="{ 'load-status--error': historyLoadError }" @click="retryChatLoad">
					<text v-if="isCheckingLimits">正在检查沟通状态...</text>
					<text v-else-if="isWaitingForNim">正在连接聊天服务...</text>
					<text v-else-if="isLoadingHistory">正在加载更早消息...</text>
					<text v-else-if="historyLoadError">{{ historyLoadError }}，点击重试</text>
					<text v-else-if="historyExhausted && messages.length">没有更早的消息了</text>
					<text v-else-if="messages.length">下滑加载更多消息</text>
				</view>

				<view v-if="!isChatLoading && !historyLoadError && !displayMessages.length" class="empty-state">
					暂无聊天消息
				</view>

				<template v-for="message in displayMessages">
					<view v-if="message.type === 'time'" :id="messageAnchor(message.id)" :key="message.id"
						class="time-divider">
						{{ message.content }}
					</view>
					<view v-else-if="message.type === 'system'" :id="messageAnchor(message.id)" :key="message.id"
						class="system-message">
						{{ message.content }}
					</view>
					<view v-else :id="messageAnchor(message.id)" :key="message.id" class="message-row"
						:class="message.direction">
						<image :src="message.direction === 'self' ? selfAvatar : otherAvatar" class="message-avatar"
							mode="aspectFill" @error="handleAvatarError(message.direction)"></image>
						<view class="message-bubble"
							:class="{ 'message-bubble--image': message.type === 'image', 'message-bubble--audio': message.type === 'audio' }"
							@click.stop="message.type === 'audio' && playAudioMessage(message)">
							<image v-if="message.type === 'image'" :src="message.url" class="message-image"
								mode="widthFix" @click.stop="previewImage(message.url)"></image>
							<view v-else-if="message.type === 'audio'" class="audio-message-content">
								<text class="audio-message-icon">{{ audioPlayingId === message.id ? '❚❚' : '▶' }}</text>
								<text class="audio-message-duration">{{ message.durationSeconds }}"</text>
							</view>
							<view v-else class="message-text">
								<block v-for="(segment, segmentIndex) in message.segments" :key="segmentIndex">
									<image v-if="segment.type === 'emoji'" :src="segment.url" :aria-label="segment.key"
										class="message-emoji" mode="aspectFit"></image>
									<text v-else class="message-text-copy">{{ segment.content }}</text>
								</block>
							</view>
						</view>
					</view>
				</template>

				<view id="message-bottom" class="message-bottom"></view>
			</view>
		</scroll-view>

		<view class="composer">
			<view class="composer-main">
				<image v-if="isVoiceMode || activePanel === 'phrases'" src="../../static/icon_key.png"
					class="phrase-icon" mode="aspectFit" @click="handleKeyboardButton"></image>
				<button v-else class="phrase-button" @click="togglePanel('phrases')">常用语</button>
				<input v-if="!isVoiceMode" v-model.trim="draft" class="message-input" :focus="inputFocused"
					confirm-type="send" cursor-spacing="18" maxlength="500" placeholder="输入消息" @focus="handleInputFocus"
					@confirm="sendMessage" />
				<image v-if="!isVoiceMode" src="../../static/icon_audio_btn.png" class="round-button" mode="aspectFit"
					@click="enterVoiceMode"></image>
				<button v-else class="voice-button" @touchstart.stop.prevent="startVoiceRecording"
					@touchmove.stop.prevent="updateVoiceRecordingGesture" @touchend.stop.prevent="finishVoiceRecording"
					@touchcancel.stop.prevent="cancelVoiceRecording">按住 说话</button>
				<image src="../../static/icon_emoji.png" class="round-button" @click="togglePanel('emoji')"></image>
				<button v-if="!isVoiceMode && draft" class="send-button" :disabled="isSendingMessage"
					@click="sendMessage">
					{{ isSendingMessage ? '发送中' : '发送' }}
				</button>
				<image v-else src="../../static/icon_add.png" class="round-button" @click="togglePanel('more')"></image>
			</view>

			<view v-if="activePanel" class="extension-panel"
				:class="{ 'extension-panel--phrases': activePanel === 'phrases' }">
				<view v-if="activePanel === 'phrases'" class="phrase-panel">
					<scroll-view scroll-y class="phrase-list">
						<view v-if="isLoadingCommonPhrases" class="phrase-status">常用语加载中...</view>
						<view v-else-if="commonPhrasesError" class="phrase-status phrase-status--error"
							@click="loadCommonPhrases">
							{{ commonPhrasesError }}
						</view>
						<view v-else-if="!commonPhrases.length" class="phrase-status">暂无常用语</view>
						<view v-for="phrase in commonPhrases" :key="phrase.key" class="phrase-item"
							@click="usePhrase(phrase.message)">
							<text class="phrase-message">{{ phrase.message }}</text>
							<view v-if="isEditingCommonPhrases" class="phrase-item-actions">
								<image src="../../static/icon_edit.png" class="phrase-item-action-icon" mode="aspectFit"
									@click.stop="handleCommonPhraseAction('edit', phrase)"></image>
								<image src="../../static/icon_close.png" class="phrase-item-action-icon"
									:class="{ 'phrase-item-action-icon--disabled': deletingCommonPhraseId === phrase.id }"
									mode="aspectFit" @click.stop="handleCommonPhraseAction('delete', phrase)"></image>
							</view>
						</view>
					</scroll-view>
					<view class="phrase-actions">
						<view class="phrase-add" @click="openQuickReplyModal">
							<image src="../../static/icon_common_add.png" class="phrase-add-icon" mode="aspectFit">
							</image>
							<text>新增</text>
						</view>
						<image src="../../static/icon_setting.png" class="phrase-setting-icon" mode="aspectFit"
							@click="toggleCommonPhraseEditing"></image>
					</view>
				</view>

				<view v-else-if="activePanel === 'emoji'" class="emoji-list">
					<view v-for="emoji in emojis" :key="emoji.key" class="emoji-item" @click="appendEmoji(emoji)">
						<image :src="emoji.url" :aria-label="emoji.key" class="emoji-image" mode="aspectFit"></image>
					</view>
				</view>

				<view v-else class="more-list">
					<view v-for="item in moreActions" :key="item.key" class="more-item" @click="handleMoreAction(item)">
						<image :src="item.iconUrl" class="more-icon" mode="aspectFill"></image>
						<text>{{ item.label }}</text>
					</view>
				</view>
			</view>
		</view>

		<!-- 录音时遮罩整个聊天页，手指移动到左右区域即可切换取消/转文字意图。 -->
		<view v-if="isRecording" class="voice-record-mask" @touchmove.stop.prevent="updateVoiceRecordingGesture"
			@touchend.stop.prevent="finishVoiceRecording" @touchcancel.stop.prevent="cancelVoiceRecording">
			<view class="voice-record-card">
				<view class="voice-wave" :class="{ 'voice-wave--warning': recordingCountdown > 0 }">
					<text v-for="bar in voiceWaveBars" :key="bar" class="voice-wave-bar"
						:style="{ animationDelay: `${(bar % 7) * -0.09}s` }"></text>
				</view>
				<text class="voice-record-status">{{ recordingStatusText }}</text>
				<text v-if="recordingCountdown > 0" class="voice-record-countdown">还剩 {{ recordingCountdown }} 秒</text>
			</view>
			<view class="voice-record-actions">
				<view class="voice-record-action" :class="{ 'voice-record-action--active': recordingGesture === 'cancel' }">
					<text>取消</text>
				</view>
				<view class="voice-record-action" :class="{ 'voice-record-action--active': recordingGesture === 'transcribe' }">
					<text>滑到这里 转文字</text>
				</view>
			</view>
		</view>

		<!-- 转文字结果只保留可编辑文本和两个发送动作，不叠加翻译/表情入口。 -->
		<view v-if="showVoiceTextEditor" class="voice-text-mask" @click.stop>
			<view class="voice-text-close" @click="discardPendingVoice">×</view>
			<view class="voice-text-editor-wrap">
				<textarea v-model="transcribedText" class="voice-text-editor" maxlength="500"
					placeholder="语音转文字结果" />
			</view>
			<view class="voice-text-footer">
				<view class="voice-text-action voice-text-action--audio" @click="sendPendingVoice">
					<text>发送原语音</text>
				</view>
				<view class="voice-text-action voice-text-action--text" @click="sendTranscribedText">
					<text>发送</text>
				</view>
			</view>
		</view>

		<view v-if="showQuickReplyModal" class="quick-reply-mask" @click="closeQuickReplyModal">
			<view class="quick-reply-dialog" @click.stop>
				<view class="quick-reply-header">
					<text class="quick-reply-title">快速回复</text>
					<text class="quick-reply-close" @click="closeQuickReplyModal">×</text>
				</view>
				<view class="quick-reply-body">
					<textarea v-model="quickReplyText" class="quick-reply-input" maxlength="300"
						placeholder="可输入300字，可输入您常用回复，请不要填写QQ、微信等联系方式或广告，否则系统将封禁您的账号。"
						placeholder-class="quick-reply-placeholder" />
					<text class="quick-reply-count">{{ quickReplyText.length }}/300</text>
				</view>
				<view class="quick-reply-footer">
					<view class="quick-reply-button" :class="{ 'quick-reply-button--disabled': isSavingCommonPhrase }"
						@click="saveCommonPhrase">
						{{ isSavingCommonPhrase ? '保存中...' : '保存' }}
					</view>
					<view class="quick-reply-button" @click="sendQuickReply">发送</view>
				</view>
			</view>
		</view>

		<view v-if="showSendResumeModal" class="send-resume-mask" @click="closeSendResumeModal">
			<view class="send-resume-dialog" @click.stop>
				<view class="send-resume-content">
					<text class="send-resume-title">确认发送</text>
					<text class="send-resume-tip">你的简历将发送给企业</text>
					<view class="send-resume-job">
						<view class="send-resume-job-item send-resume-job-item--name">
							<image src="/static/icon_send_resume_job.png" class="send-resume-job-icon" mode="aspectFill"
								style="width: 22rpx; height: 20rpx;"></image>
							<text class="send-resume-job-text">{{ sendResumeJob.jobName || '-' }}</text>
						</view>
						<view class="send-resume-job-item">
							<image src="/static/icon_send_resume_location.png" class="send-resume-job-icon"
								mode="aspectFill" style="width: 20rpx; height: 24rpx;"></image>
							<text class="send-resume-job-text">{{ sendResumeJob.location || '-' }}</text>
						</view>
						<view class="send-resume-job-item">
							<image src="/static/icon_send_resume_salary.png" class="send-resume-job-icon"
								mode="aspectFill" style="width: 24rpx; height: 24rpx;"></image>
							<text class="send-resume-job-text">{{ sendResumeJob.salary || '-' }}</text>
						</view>
					</view>
				</view>
				<view class="send-resume-actions">
					<view class="send-resume-button send-resume-button--cancel" @click="closeSendResumeModal">取消</view>
					<view class="send-resume-button send-resume-button--confirm" @click="confirmSendResume">发送</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import {
		requestApi
	} from '../../services/request'
	import {
		NIM_EVENT,
		clearActiveConversationId,
		getNimLoginError,
		getNimInstance,
		isNimLoggedIn,
		setActiveConversationId
	} from '../../services/nim'
	import {
		markNimConversationRead
	} from '../../services/conversation'
	import {
		NIM_EMOJIS,
		parseNimEmojiText
	} from '../../services/nim-emoji'

	const CHAT_LIMITS_API = 'Chat.MyChat.Limits'
	const CHAT_SAVE_API = 'Chat.Chat.Save'
	const CHECK_SEND_RESUME_API = 'Chat.Person.CheckSendResume'
	const GET_SEND_RESUME_JOB_API = 'Chat.Chat.GetJob'
	// 接口文档中的方法名为 Chat.Peson.Delivery（Peson 为文档原始拼写）。
	const DELIVERY_RESUME_API = 'Chat.Peson.Delivery'
	const COMMON_LANGUAGE_GET_API = 'Chat.CommonLanguage.Get'
	const COMMON_LANGUAGE_SAVE_API = 'Chat.CommonLanguage.Save'
	const COMMON_LANGUAGE_DELETE_API = 'Chat.CommonLanguage.Del'
	const HISTORY_PAGE_SIZE = 50
	const TIME_DIVIDER_INTERVAL = 5 * 60 * 1000
	// 云信图片消息的业务上限：超过 25 MB 时不进入压缩和上传流程。
	const MAX_IMAGE_SIZE = 25 * 1024 * 1024
	// 图片压缩质量：H5 Canvas 与 App/小程序原生压缩统一使用 80%。
	const IMAGE_COMPRESS_QUALITY = 80
	// H5 Canvas 压缩时限制长边，避免超大分辨率图片占用过多内存和流量。
	const H5_IMAGE_MAX_EDGE = 1920
	// 语音最多录制 60 秒，最后 10 秒在录音卡片上显示倒计时。
	const MAX_VOICE_DURATION = 60 * 1000
	const VOICE_COUNTDOWN_DURATION = 10 * 1000
	const MIN_VOICE_DURATION = 1000
	const DEFAULT_AVATAR = '/static/default_avatar.png'
	const MAN_AVATAR = '/static/man_avatar.png'
	const WOMAN_AVATAR = '/static/woman_avatar.png'

	const MESSAGE_TYPE_LABELS = Object.freeze({
		2: '[语音]',
		3: '[视频]',
		4: '[位置]',
		5: '[通知消息]',
		6: '[文件]',
		7: '[音视频通话]',
		10: '[提示消息]',
		11: '[机器人消息]',
		12: '[通话消息]',
		100: '[自定义消息]'
	})

	function parseResponseData(data, errorMessage = '接口返回的数据格式不正确') {
		if (typeof data !== 'string') return data || {}
		if (!data.trim()) return {}

		try {
			return JSON.parse(data) || {}
		} catch (error) {
			throw new Error(errorMessage)
		}
	}

	function getMessageId(message) {
		if (message && message.messageClientId) return String(message.messageClientId)
		if (message && message.messageServerId) return String(message.messageServerId)
		return [
			message && message.senderId,
			message && message.createTime,
			message && message.messageType,
			message && message.text
		].join('-')
	}

	function padNumber(value) {
		return value < 10 ? `0${value}` : String(value)
	}

	function formatMessageTime(timestamp) {
		const date = new Date(Number(timestamp) || Date.now())
		const now = new Date()
		const time = `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`
		const isToday = date.getFullYear() === now.getFullYear() &&
			date.getMonth() === now.getMonth() &&
			date.getDate() === now.getDate()

		if (isToday) return time
		if (date.getFullYear() === now.getFullYear()) {
			return `${padNumber(date.getMonth() + 1)}月${padNumber(date.getDate())}日 ${time}`
		}
		return `${date.getFullYear()}年${padNumber(date.getMonth() + 1)}月${padNumber(date.getDate())}日 ${time}`
	}

	function getGenderAvatar(gender) {
		// 云信用户资料约定：1 为男性、2 为女性，0 或未填写表示未知。
		if (Number(gender) === 1) return MAN_AVATAR
		if (Number(gender) === 2) return WOMAN_AVATAR
		return DEFAULT_AVATAR
	}

	function getImageFileName(filePath) {
		const pathWithoutQuery = String(filePath || '').split('?')[0]
		const pathParts = pathWithoutQuery.split(/[\\/]/)
		let fileName = pathParts[pathParts.length - 1] || `image_${Date.now()}.jpg`
		try {
			fileName = decodeURIComponent(fileName)
		} catch (error) {
			// 临时文件路径未编码时直接使用原始文件名即可。
		}
		return /\.[a-z0-9]+$/i.test(fileName) ? fileName : `${fileName}.jpg`
	}

	function getCompressedImageName(filePath, sourceFile) {
		const nestedFile = sourceFile && (sourceFile.file || sourceFile.raw)
		const originalName = sourceFile && sourceFile.name ?
			String(sourceFile.name) :
			nestedFile && nestedFile.name ? String(nestedFile.name) :
			getImageFileName(filePath)
		return `${originalName.replace(/\.[^.]+$/, '') || `image_${Date.now()}`}.jpg`
	}

	function getVoiceFileInfo(filePath) {
		const cleanPath = String(filePath || '').split('?')[0]
		const pathParts = cleanPath.split(/[\\/]/)
		let name = pathParts[pathParts.length - 1] || `voice_${Date.now()}.mp3`
		try {
			name = decodeURIComponent(name)
		} catch (error) {
			// 临时文件路径未编码时直接使用原始名称。
		}
		if (!/\.[a-z0-9]+$/i.test(name)) name += '.mp3'
		const extension = (name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'mp3'
		const mimeTypes = {
			mp3: 'audio/mpeg',
			m4a: 'audio/mp4',
			aac: 'audio/aac',
			wav: 'audio/wav',
			amr: 'audio/amr',
			ogg: 'audio/ogg',
			webm: 'audio/webm'
		}
		return {
			name,
			mimeType: mimeTypes[extension.toLowerCase()] || ''
		}
	}

	function normalizeNimMessage(message) {
		const messageType = Number(message && message.messageType)
		const attachment = message && message.attachment ? message.attachment : {}
		const id = getMessageId(message)
		const base = {
			id,
			timestamp: Number(message && message.createTime) || 0,
			direction: message && message.isSelf ? 'self' : 'other'
		}

		if (messageType === 0) {
			const content = message && message.text ? message.text : '[文本消息]'
			return {
				...base,
				type: 'text',
				content,
				segments: parseNimEmojiText(content)
			}
		}
		if (messageType === 1 && attachment.url) {
			return {
				...base,
				type: 'image',
				url: attachment.url,
				content: '[图片]'
			}
		}
		if (messageType === 2 && attachment.url) {
			const duration = Math.max(0, Number(attachment.duration) || 0)
			return {
				...base,
				type: 'audio',
				url: attachment.url,
				duration,
				durationSeconds: Math.max(1, Math.ceil(duration / 1000)),
				content: '[语音]'
			}
		}
		if (messageType === 10) {
			return {
				...base,
				type: 'system',
				content: message.text || MESSAGE_TYPE_LABELS[messageType]
			}
		}

		let content = MESSAGE_TYPE_LABELS[messageType] || '[暂不支持的消息]'
		if (messageType === 2 && attachment.duration) {
			content = `[语音] ${Math.max(1, Math.ceil(Number(attachment.duration) / 1000))}秒`
		} else if (messageType === 6 && attachment.name) {
			content = `[文件] ${attachment.name}`
		}
		return {
			...base,
			type: 'text',
			content,
			segments: parseNimEmojiText(content)
		}
	}

	export default {
		data() {
			return {
				// 页面业务参数：由 /pages/chat/chat?jobId=...&resumeId=... 注入。
				jobId: '',
				resumeId: '',
				personAccId: '',
				enterpriseAccId: '',
				conversationId: '',
				selfUserInfo: null,
				selfAvatar: DEFAULT_AVATAR,
				otherUserInfo: null,
				otherAvatar: DEFAULT_AVATAR,
				actions: [{
						key: 'resume',
						label: '发简历',
						iconUrl: '/static/a.png',
						style: 'width: 34rpx; height: 32rpx;'
					},
					{
						key: 'pin',
						label: '置顶',
						iconUrl: '/static/b.png',
						style: 'width: 37rpx; height: 37rpx;'

					},
					{
						key: 'company',
						label: '公司主页',
						iconUrl: '/static/c.png',
						style: 'width: 38rpx; height: 32rpx;'
					},
					{
						key: 'more',
						label: '更多',
						iconUrl: '/static/d.png',
						style: 'width: 37rpx; height: 37rpx;'
					}
				],
				isPinned: false,
				isUpdatingPin: false,
				draft: '',
				inputFocused: false,
				isVoiceMode: false,
				isRecording: false,
				recordingGesture: 'send',
				recordingElapsed: 0,
				voiceWaveBars: 23,
				pendingVoice: null,
				showVoiceTextEditor: false,
				transcribedText: '',
				isTranscribingVoice: false,
				audioPlayingId: '',
				statusBarHeight: 0,
				activePanel: '',
				scrollIntoView: '',
				scrollWithAnimation: false,
				isCheckingLimits: false,
				isWaitingForNim: false,
				isLoadingHistory: false,
				historyExhausted: false,
				historyLoadError: '',
				messages: [],
				isSendingMessage: false,
				isSelectingImage: false,
				imageUploadProgress: 0,
				commonPhrases: [],
				isLoadingCommonPhrases: false,
				commonPhrasesError: '',
				isEditingCommonPhrases: false,
				showQuickReplyModal: false,
				quickReplyText: '',
				quickReplyId: null,
				isSavingCommonPhrase: false,
				deletingCommonPhraseId: '',
				isLoadingSendResumeJob: false,
				showSendResumeModal: false,
				isSendingResume: false,
				sendResumeJob: {
					jobId: '',
					jobName: '',
					location: '',
					salary: ''
				},
				emojis: NIM_EMOJIS,
				moreActions: [{
						key: 'photo',
						label: '图片',
						iconUrl: '/static/icon_pic.png'
					},
					{
						key: 'camera',
						label: '相机',
						iconUrl: '/static/icon_camera.png'
					},
					{
						key: 'audio',
						label: '语音',
						iconUrl: '/static/icon_audio.png'
					}
				]
			}
		},
		computed: {
			isChatLoading() {
				return this.isCheckingLimits || this.isWaitingForNim || this.isLoadingHistory
			},
			displayMessages() {
				const result = []
				let previousTimestamp = 0

				this.messages.forEach(rawMessage => {
					const message = normalizeNimMessage(rawMessage)
					if (!previousTimestamp || message.timestamp - previousTimestamp >= TIME_DIVIDER_INTERVAL) {
						result.push({
							id: `time-${message.id}`,
							type: 'time',
							content: formatMessageTime(message.timestamp)
						})
					}
					result.push(message)
					previousTimestamp = message.timestamp
				})
				console.log(666, this.messages)
				return result
			},
			scrollTopStyle() {
				return `calc(${this.statusBarHeight}px + 220rpx)`
			},
			recordingCountdown() {
				const remaining = MAX_VOICE_DURATION - this.recordingElapsed
				if (remaining > VOICE_COUNTDOWN_DURATION) return 0
				return Math.max(0, Math.ceil(remaining / 1000))
			},
			recordingStatusText() {
				if (this.recordingGesture === 'cancel') return '松开 取消'
				if (this.recordingGesture === 'transcribe') return '松开 转文字'
				return '松开 发送语音'
			}
		},
		async onLoad(options = {}) {
			// uni-app 会把 URL 查询参数传给 onLoad；同时兼容大小写，避免外部链接差异。
			this.jobId = String(options.jobId || options.JobId || '').trim()
			this.resumeId = String(options.resumeId || options.ResumeId || '').trim()
			const systemInfo = uni.getSystemInfoSync()
			this.statusBarHeight = systemInfo.statusBarHeight || 0
			this._chatPageAlive = true
			this.bindNimLoginEvents()
			this.loadCommonPhrases()
			this.loadSendResumeStatus()
			await this.loadChatAccess()
		},
		onUnload() {
			this._chatPageAlive = false
			// 离开聊天页后恢复消息列表页的其它会话红点判断。
			clearActiveConversationId(this.conversationId)
			this.abortVoiceRecording()
			this.destroyAudioPlayer()
			this.unbindNimLoginEvents()
			this.unbindMessageEvents()
		},
		onHide() {
			// App 进入后台时不能继续占用麦克风或播放语音。
			if (this.isRecording) this.abortVoiceRecording()
			this.destroyAudioPlayer()
		},
		methods: {
			bindNimLoginEvents() {
				// App.vue 中的云信登录是异步的，页面需要在登录完成后继续初始化会话。
				uni.$on(NIM_EVENT.LOGIN_STATUS, this.handleNimLoginStatus)
				uni.$on(NIM_EVENT.LOGIN_FAILED, this.handleNimLoginFailed)
			},
			unbindNimLoginEvents() {
				uni.$off(NIM_EVENT.LOGIN_STATUS, this.handleNimLoginStatus)
				uni.$off(NIM_EVENT.LOGIN_FAILED, this.handleNimLoginFailed)
			},
			handleNimLoginStatus(status) {
				if (Number(status) !== 1 || !this.enterpriseAccId) return
				this.prepareNimConversation()
			},
			handleNimLoginFailed(error) {
				if (!this.enterpriseAccId || this.conversationId) return
				this.isWaitingForNim = false
				this.historyLoadError = error && (error.message || error.desc) ?
					error.message || error.desc :
					'聊天服务连接失败'
			},
			async loadChatAccess() {
				if (this.isCheckingLimits) return

				if (!this.jobId || !this.resumeId) {
					this.historyLoadError = '缺少 jobId 或 resumeId'
					return
				}

				this.isCheckingLimits = true
				this.historyLoadError = ''
				try {
					// 先校验当前职位与简历是否允许进入聊天，再决定是否读取云信消息。
					const response = await requestApi({
						Name: CHAT_LIMITS_API,
						Content: {
							JobId: this.jobId,
							ResumeId: this.resumeId
						}
					})
					if (!response || Number(response.Code) !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`获取沟通状态失败，业务错误码：${code}`)
					}

					const data = parseResponseData(response.Data, '沟通限制接口返回的数据格式不正确')
					if (data.Code !== undefined && Number(data.Code) !== 0) {
						throw new Error(`获取沟通状态失败，数据错误码：${data.Code}`)
					}
					const isTop = data.IsTop !== undefined ? data.IsTop : response.IsTop
					this.isPinned = isTop === true || Number(isTop) === 1 || String(isTop).toLowerCase() === 'true'
					// 兼容会话账号信息位于 Data 或响应根节点的两种返回结构。
					const personAccId = data.PersonAccId !== undefined ?
						data.PersonAccId :
						response.PersonAccId
					this.personAccId = personAccId === undefined || personAccId === null ?
						'' :
						String(personAccId).trim()

					const successStep = data.SuccessStep || response.SuccessStep
					if (successStep) {
						this.historyExhausted = true
						uni.showModal({
							content: String(successStep.Tips || ''),
							confirmText: String(successStep.StepName || '确定'),
							showCancel: false
						})
						return
					}

					const enterpriseAccId = data.EnterpriseAccId !== undefined ?
						data.EnterpriseAccId :
						response.EnterpriseAccId
					this.enterpriseAccId = enterpriseAccId === undefined || enterpriseAccId === null ?
						'' :
						String(enterpriseAccId).trim()
					if (!this.enterpriseAccId) {
						throw new Error('获取沟通状态失败：未返回 EnterpriseAccId')
					}

					await this.prepareNimConversation()
				} catch (error) {
					if (!this._chatPageAlive) return
					this.historyLoadError = error && error.message ? error.message : '聊天加载失败'
					console.error('[Chat] 获取聊天权限失败', error)
				} finally {
					if (this._chatPageAlive) this.isCheckingLimits = false
				}
			},
			async loadSendResumeStatus() {
				if (!this.jobId) return

				try {
					const response = await requestApi({
						Name: CHECK_SEND_RESUME_API,
						Content: {
							JobId: this.jobId
						}
					})
					if (!response || Number(response.Code) !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`获取简历投递状态失败，业务错误码：${code}`)
					}

					const data = parseResponseData(response.Data, '简历投递状态接口返回的数据格式不正确')
					if (data.Code !== undefined && Number(data.Code) !== 0) {
						throw new Error(`获取简历投递状态失败，数据错误码：${data.Code}`)
					}

					const isShow = data.IsShow !== undefined ? data.IsShow : response.IsShow
					if (isShow === undefined || isShow === null) {
						throw new Error('获取简历投递状态失败：未返回 IsShow')
					}

					const shouldShowSendResume = isShow === true ||
						isShow === 1 ||
						String(isShow).toLowerCase() === 'true'
					if (!this._chatPageAlive) return
					const resumeAction = this.actions.find(action => action.key === 'resume')
					if (resumeAction) resumeAction.label = shouldShowSendResume ? '发简历' : '再次投递'
				} catch (error) {
					console.error('[Chat] 获取简历投递状态失败', error)
				}
			},
			async prepareNimConversation() {
				if (!this.enterpriseAccId || this._conversationInitPromise) {
					return this._conversationInitPromise
				}
				if (!isNimLoggedIn()) {
					const loginError = getNimLoginError()
					if (loginError) {
						this.isWaitingForNim = false
						this.historyLoadError = loginError.message || loginError.desc || '聊天服务连接失败'
						return
					}
					// 云信仍在登录时保留等待态，登录事件会重新进入本方法。
					this.isWaitingForNim = true
					return
				}

				this.isWaitingForNim = false
				this.historyLoadError = ''
				this._conversationInitPromise = (async () => {
					const nim = getNimInstance()
					this.conversationId = nim.V2NIMConversationIdUtil.p2pConversationId(this
						.enterpriseAccId)
					// 标记当前前台会话：列表页收到消息事件时不为该会话重复显示红点。
					setActiveConversationId(this.conversationId)
					// 双方用户资料与历史消息并行获取，头像返回后 Vue 会自动刷新消息头像。
					this.loadSelfUserProfile()
					this.loadOtherUserProfile()
					this.bindMessageEvents()
					await this.loadEarlierMessages(true)
					// 清除未读失败不影响历史消息展示，只记录日志供后续排查。
					await markNimConversationRead(this.conversationId).catch(error => {
						console.warn('[Chat] 清除会话未读数失败', error)
					})
				})().catch(error => {
					if (!this._chatPageAlive) return
					this.historyLoadError = error && error.message ? error.message : '历史消息加载失败'
					console.error('[Chat] 初始化云信会话失败', error)
				}).finally(() => {
					this._conversationInitPromise = null
				})

				return this._conversationInitPromise
			},
			async loadSelfUserProfile() {
				if (this._selfUserProfilePromise) return this._selfUserProfilePromise
				if (!isNimLoggedIn()) return

				const nim = getNimInstance()
				const loginService = nim.V2NIMLoginService
				const accountId = loginService && typeof loginService.getLoginUser === 'function' ?
					loginService.getLoginUser() :
					''
				const userService = nim.V2NIMUserService
				if (!accountId || !userService || typeof userService.getUserListFromCloud !== 'function') {
					console.warn('[Chat] 无法获取云信个人资料：用户服务或登录账号不可用')
					return
				}

				// 从网易云端获取最新的本人资料，不只读取 SDK 本地缓存。
				this._selfUserProfilePromise = userService.getUserListFromCloud([accountId])
					.then(userList => {
						if (!this._chatPageAlive) return
						const selfUser = (Array.isArray(userList) ? userList : [])
							.find(user => user && user.accountId === accountId)
						if (!selfUser) return

						this.selfUserInfo = selfUser
						const avatar = typeof selfUser.avatar === 'string' ? selfUser.avatar.trim() : ''
						// 未设置云信头像时，根据用户性别展示对应的本地默认头像。
						this.selfAvatar = avatar || getGenderAvatar(selfUser.gender)
					})
					.catch(error => {
						// 个人资料失败不阻塞聊天消息，头像继续使用本地默认图。
						console.warn('[Chat] 获取云信个人资料失败', error)
					})
					.finally(() => {
						this._selfUserProfilePromise = null
					})

				return this._selfUserProfilePromise
			},
			async loadOtherUserProfile() {
				if (this._otherUserProfilePromise) return this._otherUserProfilePromise
				if (!isNimLoggedIn() || !this.enterpriseAccId) return

				const userService = getNimInstance().V2NIMUserService
				if (!userService || typeof userService.getUserListFromCloud !== 'function') {
					this.otherUserInfo = null
					this.otherAvatar = DEFAULT_AVATAR
					console.warn('[Chat] 无法获取对方云信资料：用户服务不可用')
					return
				}

				// EnterpriseAccId 即聊天对方的云信账号，从云端获取最新用户资料。
				this._otherUserProfilePromise = userService.getUserListFromCloud([this.enterpriseAccId])
					.then(userList => {
						if (!this._chatPageAlive) return
						const otherUser = (Array.isArray(userList) ? userList : [])
							.find(user => user && user.accountId === this.enterpriseAccId)
						this.otherUserInfo = otherUser || null
						const avatar = otherUser && typeof otherUser.avatar === 'string' ?
							otherUser.avatar.trim() :
							''
						this.otherAvatar = avatar || DEFAULT_AVATAR
					})
					.catch(error => {
						// 获取失败不阻塞聊天消息，对方头像统一回退本地默认图。
						if (this._chatPageAlive) {
							this.otherUserInfo = null
							this.otherAvatar = DEFAULT_AVATAR
						}
						console.warn('[Chat] 获取对方云信资料失败', error)
					})
					.finally(() => {
						this._otherUserProfilePromise = null
					})

				return this._otherUserProfilePromise
			},
			handleAvatarError(direction) {
				if (direction === 'self') {
					const gender = this.selfUserInfo ? this.selfUserInfo.gender : 0
					this.selfAvatar = getGenderAvatar(gender)
					return
				}
				this.otherAvatar = DEFAULT_AVATAR
			},
			bindMessageEvents() {
				if (this._messageEventsBound) return
				// 消息监听已在 services/nim.js 单例层注册，这里只订阅页面级事件。
				uni.$on(NIM_EVENT.MESSAGE_RECEIVED, this.handleReceiveMessages)
				this._messageEventsBound = true
			},
			unbindMessageEvents() {
				if (!this._messageEventsBound) return
				uni.$off(NIM_EVENT.MESSAGE_RECEIVED, this.handleReceiveMessages)
				this._messageEventsBound = false
			},
			handleReceiveMessages(messageList) {
				// SDK 会同时推送其他会话的新消息，详情页只接收当前会话的数据。
				const currentMessages = (Array.isArray(messageList) ? messageList : [])
					.filter(message => message && message.conversationId === this.conversationId)
				if (!currentMessages.length) return

				this.mergeMessages(currentMessages)
				markNimConversationRead(this.conversationId).catch(error => {
					console.warn('[Chat] 清除会话未读数失败', error)
				})
				this.$nextTick(() => this.scrollToBottom(true))
			},
			mergeMessages(messageList) {
				const messageMap = new Map(this.messages.map(message => [getMessageId(message), message]))
				messageList.forEach(message => {
					if (!message || message.isDelete) return
					messageMap.set(getMessageId(message), message)
				})
				this.messages = Array.from(messageMap.values()).sort((left, right) => {
					const timeDiff = (Number(left.createTime) || 0) - (Number(right.createTime) || 0)
					return timeDiff || getMessageId(left).localeCompare(getMessageId(right))
				})
			},
			async loadCommonPhrases() {
				if (this.isLoadingCommonPhrases) return

				this.isLoadingCommonPhrases = true
				this.commonPhrasesError = ''
				try {
					const response = await requestApi({
						Name: COMMON_LANGUAGE_GET_API,
						Content: ''
					})
					if (!response || Number(response.Code) !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`获取常用语失败，业务错误码：${code}`)
					}

					const rows = response.Data && response.Data.Rows
					if (!Array.isArray(rows)) throw new Error('获取常用语失败：接口未返回有效列表')

					this.commonPhrases = rows
						.map((item, index) => {
							const message = item && typeof item.Msg === 'string' ? item.Msg.trim() : ''
							if (!message) return null

							return {
								id: item.Id ? String(item.Id) : null,
								key: item.Id ? String(item.Id) : `phrase-${index}`,
								message,
								isTop: Boolean(item.IsTop),
								originalIndex: index
							}
						})
						.filter(Boolean)
						.sort((left, right) => {
							if (left.isTop !== right.isTop) return left.isTop ? -1 : 1
							return left.originalIndex - right.originalIndex
						})
				} catch (error) {
					this.commonPhrases = []
					this.commonPhrasesError = '常用语加载失败，点击重试'
					console.error('[Chat] 获取常用语失败', error)
				} finally {
					this.isLoadingCommonPhrases = false
				}
			},
			messageAnchor(id) {
				// SDK 消息 ID 可能带特殊字符，转换后再作为 scroll-into-view 的锚点。
				return `message-${String(id).replace(/[^a-zA-Z0-9_-]/g, '-')}`
			},
			navigateBack() {
				const pages = getCurrentPages()
				if (pages.length > 1) {
					uni.navigateBack()
					return
				}
				uni.reLaunch({
					url: '/pages/index/index'
				})
			},
			handleAction(action) {
				if (action.key === 'resume') {
					this.openSendResumeModal()
					return
				}
				if (action.key === 'pin') {
					this.updatePinStatus()
					return
				}
				if (action.key === 'more') {
					uni.showActionSheet({
						itemList: ['设置备注', '消息免打扰', '清空聊天记录', '举报'],
						fail: () => {}
					})
					return
				}
				uni.showToast({
					title: '公司主页功能待接入',
					icon: 'none'
				})
			},
			async updatePinStatus() {
				if (this.isUpdatingPin) return
				if (!this.enterpriseAccId || !this.personAccId) {
					uni.showToast({
						title: this.isCheckingLimits ? '沟通信息加载中，请稍候' : '未获取到会话账号信息',
						icon: 'none'
					})
					return
				}
				if (!this.conversationId || !isNimLoggedIn()) {
					uni.showToast({
						title: '聊天服务尚未就绪',
						icon: 'none'
					})
					return
				}

				const nextIsPinned = !this.isPinned
				let businessUpdated = false
				let toastTitle = ''
				this.isUpdatingPin = true
				uni.showLoading({
					title: nextIsPinned ? '置顶中' : '取消中',
					mask: true
				})

				try {
					const response = await requestApi({
						Name: CHAT_SAVE_API,
						Content: {
							EnterpriseAccId: this.enterpriseAccId,
							PersonAccId: this.personAccId,
							IsTop: nextIsPinned
						}
					})
					const responseCode = response && response.Code !== undefined ? Number(response.Code) : NaN
					if (!response || responseCode !== 0) {
						if (responseCode === 4400002) throw new Error('置顶数量已达上限')
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`更新置顶状态失败，业务错误码：${code}`)
					}

					const data = parseResponseData(response.Data, '保存会话接口返回的数据格式不正确')
					const dataCode = data.Code !== undefined ? Number(data.Code) : 0
					if (dataCode !== 0) {
						if (dataCode === 4400002) throw new Error('置顶数量已达上限')
						throw new Error(`更新置顶状态失败，数据错误码：${data.Code}`)
					}

					// 业务接口保存成功后，以服务端状态刷新当前页面，再同步网易云本地会话列表。
					businessUpdated = true
					this.isPinned = nextIsPinned
					const conversationService = getNimInstance().V2NIMLocalConversationService
					if (!conversationService || typeof conversationService.stickTopConversation !== 'function') {
						throw new Error('当前网易云信 SDK 不支持会话置顶')
					}
					await conversationService.stickTopConversation(this.conversationId, nextIsPinned)
					toastTitle = nextIsPinned ? '会话已置顶' : '已取消置顶'
				} catch (error) {
					toastTitle = businessUpdated ?
						'状态已保存，会话列表同步失败' :
						error && error.message ? error.message : '更新置顶状态失败'
					console.error('[Chat] 更新会话置顶状态失败', error)
				} finally {
					uni.hideLoading()
					if (this._chatPageAlive) this.isUpdatingPin = false
				}

				if (this._chatPageAlive && toastTitle) {
					uni.showToast({
						title: toastTitle,
						icon: 'none'
					})
				}
			},
			async openSendResumeModal() {
				if (this.isLoadingSendResumeJob) return
				if (!this.personAccId || !this.enterpriseAccId) {
					uni.showToast({
						title: this.isCheckingLimits ? '沟通信息加载中，请稍候' : '未获取到会话账号信息',
						icon: 'none'
					})
					return
				}

				this.isLoadingSendResumeJob = true
				uni.showLoading({
					title: '职位信息加载中',
					mask: true
				})
				let loadingVisible = true
				try {
					const response = await requestApi({
						Name: GET_SEND_RESUME_JOB_API,
						Content: {
							FromAccId: this.personAccId,
							ToAccId: this.enterpriseAccId
						}
					})
					if (!response || Number(response.Code) !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`获取职位信息失败，业务错误码：${code}`)
					}

					const data = parseResponseData(response.Data, '职位信息接口返回的数据格式不正确')
					if (data.Code !== undefined && Number(data.Code) !== 0) {
						throw new Error(`获取职位信息失败，数据错误码：${data.Code}`)
					}
					if (!this._chatPageAlive) return

					this.sendResumeJob = {
						jobId: data.JobId === undefined || data.JobId === null ? '' : String(data.JobId),
						jobName: data.JobName === undefined || data.JobName === null ? '' : String(data.JobName),
						location: data.Location === undefined || data.Location === null ? '' : String(data
							.Location),
						salary: data.Salary === undefined || data.Salary === null ? '' : String(data.Salary)
					}
					this.activePanel = ''
					this.inputFocused = false
					this.showSendResumeModal = true
				} catch (error) {
					if (!this._chatPageAlive) return
					uni.hideLoading()
					loadingVisible = false
					uni.showToast({
						title: error && error.message ? error.message : '职位信息加载失败',
						icon: 'none'
					})
					console.error('[Chat] 获取简历投递职位信息失败', error)
				} finally {
					if (loadingVisible) uni.hideLoading()
					if (this._chatPageAlive) this.isLoadingSendResumeJob = false
				}
			},
			closeSendResumeModal() {
				this.showSendResumeModal = false
			},
			async confirmSendResume() {
				if (this.isSendingResume) return

				const rawJobId = this.sendResumeJob && this.sendResumeJob.jobId
				if (rawJobId === undefined || rawJobId === null || String(rawJobId).trim() === '') {
					this.closeSendResumeModal()
					uni.showToast({
						title: '未获取到有效职位信息',
						icon: 'none'
					})
					return
				}

				const numericJobId = Number(rawJobId)
				const jobId = Number.isFinite(numericJobId) ? numericJobId : String(rawJobId).trim()
				this.isSendingResume = true
				this.closeSendResumeModal()
				uni.showLoading({
					title: '简历发送中',
					mask: true
				})
				let loadingVisible = true

				try {
					const response = await requestApi({
						Name: DELIVERY_RESUME_API,
						Content: {
							JobId: jobId
						}
					})
					if (!response || Number(response.Code) !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`发送简历失败，业务错误码：${code}`)
					}

					const data = parseResponseData(response.Data, '简历投递接口返回的数据格式不正确')
					if (data.Code !== undefined && Number(data.Code) !== 0) {
						throw new Error(`发送简历失败，数据错误码：${data.Code}`)
					}

					const successStep = data.SuccessStep || response.SuccessStep || data
					const tips = successStep && successStep.Tips !== undefined
						? String(successStep.Tips)
						: response.Tips !== undefined ? String(response.Tips) : '投递成功，请静候佳音'
					const buttonName = successStep && successStep.ButtonName !== undefined
						? String(successStep.ButtonName)
						: successStep && successStep.StepName !== undefined
							? String(successStep.StepName)
							: response.ButtonName !== undefined ? String(response.ButtonName) : '知道了'

					if (tips.includes('投递成功')) {
						const resumeAction = this.actions.find(action => action.key === 'resume')
						if (resumeAction) resumeAction.label = '再次投递'
					}

					if (!this._chatPageAlive) return
					uni.hideLoading()
					loadingVisible = false
					uni.showModal({
						title: '温馨提示',
						content: tips,
						showCancel: false,
						confirmText: buttonName || '知道了'
					})
				} catch (error) {
					if (!this._chatPageAlive) return
					uni.hideLoading()
					loadingVisible = false
					uni.showToast({
						title: error && error.message ? error.message : '简历发送失败',
						icon: 'none'
					})
					console.error('[Chat] 发送简历失败', error)
				} finally {
					if (loadingVisible) uni.hideLoading()
					if (this._chatPageAlive) this.isSendingResume = false
				}
			},
			async loadEarlierMessages(initialLoad = false) {
				if (this.isLoadingHistory || this.historyExhausted || !this.conversationId) return

				this.isLoadingHistory = true
				this.historyLoadError = ''
				const oldestMessage = this.messages[0] || null
				const anchorId = oldestMessage ? this.messageAnchor(getMessageId(oldestMessage)) : ''
				try {
					// direction=0 表示按时间倒序向前查询，anchorMessage 不会被重复返回。
					const messageList = await getNimInstance().V2NIMMessageService.getMessageList({
						conversationId: this.conversationId,
						limit: HISTORY_PAGE_SIZE,
						anchorMessage: oldestMessage || undefined,
						direction: 0
					})
					const historyMessages = Array.isArray(messageList) ? messageList : []
					this.mergeMessages(historyMessages)
					this.historyExhausted = historyMessages.length < HISTORY_PAGE_SIZE

					this.$nextTick(() => {
						if (initialLoad) {
							this.scrollToBottom(false)
							setTimeout(() => this.scrollToBottom(false), 60)
						} else if (anchorId) {
							this.scrollToAnchor(anchorId, false)
						}
					})
				} catch (error) {
					if (!this._chatPageAlive) return
					this.historyLoadError = error && error.message ? error.message : '历史消息加载失败'
					console.error('[Chat] 获取网易云历史消息失败', error)
				} finally {
					if (this._chatPageAlive) this.isLoadingHistory = false
				}
			},
			retryChatLoad() {
				if (!this.historyLoadError || this.isChatLoading) return
				if (!this.enterpriseAccId) {
					this.loadChatAccess()
					return
				}
				if (!this.conversationId) {
					this.prepareNimConversation()
					return
				}
				this.loadEarlierMessages(!this.messages.length)
			},
			scrollToAnchor(anchorId, animated) {
				this.scrollWithAnimation = Boolean(animated)
				this.scrollIntoView = ''
				this.$nextTick(() => {
					this.scrollIntoView = anchorId
				})
			},
			scrollToBottom(animated = true) {
				this.scrollToAnchor('message-bottom', animated)
			},
			togglePanel(panel) {
				this.inputFocused = false
				this.activePanel = this.activePanel === panel ? '' : panel
				if (this.activePanel !== 'phrases') this.isEditingCommonPhrases = false
				if (this.activePanel === 'phrases' && !this.commonPhrases.length) {
					this.loadCommonPhrases()
				}
				this.$nextTick(() => this.scrollToBottom(false))
			},
			enterVoiceMode() {
				this.inputFocused = false
				this.isVoiceMode = true
				this.activePanel = ''
				this.isEditingCommonPhrases = false
				this.$nextTick(() => this.scrollToBottom(false))
			},
			handleKeyboardButton() {
				if (!this.isVoiceMode) {
					this.togglePanel('phrases')
					return
				}

				this.isVoiceMode = false
				this.activePanel = ''
				this.isEditingCommonPhrases = false
				this.$nextTick(() => {
					this.inputFocused = true
					this.scrollToBottom(false)
				})
			},
			/**
			 * 按下“按住 说话”后立即显示录音层，再按当前运行环境选择录音实现：
			 * App/小程序使用 RecorderManager，H5 使用浏览器 MediaRecorder。
			 */
			async startVoiceRecording() {
				if (this.isRecording || this._voiceFinishing || this.isSendingMessage || this.isTranscribingVoice) return
				if (!this.conversationId || !isNimLoggedIn()) {
					uni.showToast({
						title: '聊天服务尚未就绪',
						icon: 'none'
					})
					return
				}

				this._voiceTouchActive = true
				this._voiceFinishing = false
				this._voiceStoppedResult = null
				this.recordingGesture = 'send'
				this.recordingElapsed = 0
				this.isRecording = true
				this.activePanel = ''
				this.inputFocused = false

				try {
					await this.beginVoiceCapture()
					// 用户可能在授权弹窗尚未结束时已经松手，此时只释放录音，不发送。
					if (!this._voiceTouchActive) {
						await this.stopVoiceCapture()
						this.resetRecordingState()
						return
					}

					this._voiceRecordingStartedAt = Date.now()
					this.clearVoiceTimer()
					this._voiceTimer = setInterval(() => {
						this.recordingElapsed = Math.min(
							MAX_VOICE_DURATION,
							Date.now() - this._voiceRecordingStartedAt
						)
						if (this.recordingElapsed >= MAX_VOICE_DURATION) {
							this.finishVoiceRecording(null, true)
						}
					}, 100)
				} catch (error) {
					this.resetRecordingState()
					const errorMessage = error && error.message ? error.message : '无法使用麦克风，请检查录音权限'
					// 浏览器安全限制属于环境配置问题，用弹窗完整展示，避免 Toast 截断关键信息。
					if (/HTTPS/i.test(errorMessage)) {
						uni.showModal({ title: '无法录音', content: errorMessage, showCancel: false })
					} else {
						uni.showToast({ title: errorMessage, icon: 'none' })
					}
					console.warn('[Chat] 无法开始录音', error)
				}
			},
			beginVoiceCapture() {
				let isH5 = false
				// #ifdef H5
				isH5 = true
				// #endif
				const systemInfo = typeof uni.getSystemInfoSync === 'function' ? uni.getSystemInfoSync() : {}
				const uniPlatform = String(systemInfo.uniPlatform || '').toLowerCase()
				// H5 中 uni.getRecorderManager 可能只是兼容占位方法，iOS Safari 调用会抛出底层 TypeError。
				if (isH5 || uniPlatform === 'web' || uniPlatform === 'h5') return this.beginH5VoiceCapture()
				if (typeof uni.getRecorderManager === 'function') return this.beginNativeVoiceCapture()
				throw new Error('当前设备不支持录音')
			},
			beginNativeVoiceCapture() {
				if (!this._recorderManager) {
					this._recorderManager = uni.getRecorderManager()
					this._recorderManager.onStart(() => {
						if (this._voiceStartResolve) this._voiceStartResolve()
						this._voiceStartResolve = null
						this._voiceStartReject = null
					})
					this._recorderManager.onStop(result => {
						this._voiceStoppedResult = result || {}
						if (this._voiceStopResolve) this._voiceStopResolve(this._voiceStoppedResult)
						this._voiceStopResolve = null
						// RecorderManager 达到 duration 后会自行停止，主动收口为一次正常发送。
						if (this.isRecording && this._voiceTouchActive && !this._voiceFinishing) {
							setTimeout(() => this.finishVoiceRecording(null, true, this._voiceStoppedResult), 0)
						}
					})
					this._recorderManager.onError(error => {
						const recordError = new Error(error && error.errMsg ? error.errMsg : '录音失败')
						if (this._voiceStartReject) this._voiceStartReject(recordError)
						// stop promise 以普通结果结束，避免授权失败时产生无人接收的 Promise rejection。
						if (this._voiceStopResolve) this._voiceStopResolve({ error: recordError })
						this._voiceStartResolve = null
						this._voiceStartReject = null
						this._voiceStopResolve = null
					})
				}

				this._voiceStopPromise = new Promise(resolve => {
					this._voiceStopResolve = resolve
				})
				return new Promise((resolve, reject) => {
					this._voiceStartTimeout = setTimeout(() => {
						this._voiceStartTimeout = null
						this._voiceStartResolve = null
						this._voiceStartReject = null
						reject(new Error('启动录音超时，请重试'))
					}, 5000)
					this._voiceStartResolve = () => {
						if (this._voiceStartTimeout) clearTimeout(this._voiceStartTimeout)
						this._voiceStartTimeout = null
						resolve()
					}
					this._voiceStartReject = error => {
						if (this._voiceStartTimeout) clearTimeout(this._voiceStartTimeout)
						this._voiceStartTimeout = null
						reject(error)
					}
					this._voiceRecorderType = 'native'
					this._recorderManager.start({
						duration: MAX_VOICE_DURATION,
						sampleRate: 16000,
						numberOfChannels: 1,
						encodeBitRate: 48000,
						format: 'mp3'
					})
				})
			},
			async beginH5VoiceCapture() {
				if (typeof window === 'undefined' || typeof navigator === 'undefined') {
					throw new Error('当前浏览器不支持录音')
				}
				const hostname = window.location && window.location.hostname ? window.location.hostname : ''
				const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
				if (window.isSecureContext === false && !isLocalhost) {
					throw new Error('浏览器录音需要 HTTPS，请使用 HTTPS 地址访问')
				}
				if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
					throw new Error('浏览器无法调用麦克风，请确认使用 HTTPS 地址')
				}
				if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器版本不支持录音')

				let stream
				try {
					stream = await navigator.mediaDevices.getUserMedia({ audio: true })
				} catch (error) {
					const errorName = String(error && error.name || '')
					if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
						throw new Error('麦克风权限未开启，请在浏览器设置中允许访问')
					}
					if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
						throw new Error('未检测到可用的麦克风')
					}
					throw new Error(error && error.message ? error.message : '浏览器调用麦克风失败')
				}
				const mimeCandidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
				const mimeType = mimeCandidates.find(type => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) || ''
				const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
				const chunks = []
				this._voiceRecorderType = 'h5'
				this._mediaStream = stream
				this._mediaRecorder = recorder
				this._mediaChunks = chunks
				this._voiceStopPromise = new Promise(resolve => {
					recorder.ondataavailable = event => {
						if (event.data && event.data.size) chunks.push(event.data)
					}
					recorder.onerror = event => resolve({
						error: new Error(event && event.error && event.error.message ? event.error.message : '浏览器录音失败')
					})
					recorder.onstop = () => {
						const finalType = recorder.mimeType || mimeType || 'audio/webm'
						const extension = finalType.includes('mp4') ? 'm4a' : 'webm'
						const blob = new Blob(chunks, { type: finalType })
						const file = new File([blob], `voice_${Date.now()}.${extension}`, { type: finalType })
						resolve({ file, mimeType: finalType, name: file.name })
					}
				})
				recorder.start(200)
			},
			/** 根据触点所在区域实时切换“发送 / 取消 / 转文字”意图。 */
			updateVoiceRecordingGesture(event) {
				if (!this.isRecording || this._voiceFinishing) return
				const touchList = event && event.touches && event.touches.length ? event.touches :
					event && event.changedTouches ? event.changedTouches : []
				const touch = touchList[0]
				if (!touch) return

				const systemInfo = uni.getSystemInfoSync()
				const width = Number(systemInfo.windowWidth) || 375
				const height = Number(systemInfo.windowHeight) || 667
				const x = Number(touch.clientX !== undefined ? touch.clientX : touch.pageX)
				const y = Number(touch.clientY !== undefined ? touch.clientY : touch.pageY)
				// 底部保留发送热区；向上滑入操作区后，左侧取消、右侧转文字。
				if (y <= height - 88) this.recordingGesture = x < width / 2 ? 'cancel' : 'transcribe'
				else this.recordingGesture = 'send'
			},
			async finishVoiceRecording(event, reachedLimit = false, stoppedResult = null) {
				if (!this.isRecording || this._voiceFinishing) return
				if (event) this.updateVoiceRecordingGesture(event)
				this._voiceTouchActive = false
				// 麦克风授权尚未完成时松手：等 startVoiceRecording 获得结果后立即停录并丢弃。
				if (!this._voiceRecordingStartedAt) {
					this.isRecording = false
					this.clearVoiceTimer()
					return
				}
				this._voiceFinishing = true
				this.clearVoiceTimer()
				const intent = this.recordingGesture

				try {
					const result = stoppedResult || await this.stopVoiceCapture()
					const measuredDuration = this._voiceRecordingStartedAt ? Date.now() - this._voiceRecordingStartedAt : 0
					const duration = Math.min(
						MAX_VOICE_DURATION,
						Math.max(0, Number(result && result.duration) || this.recordingElapsed || measuredDuration)
					)
					this.resetRecordingState()

					if (intent === 'cancel') return
					if (duration < MIN_VOICE_DURATION) {
						uni.showToast({ title: '说话时间太短', icon: 'none' })
						return
					}

					this.pendingVoice = this.normalizeRecordedVoice(result, duration)
					if (!this.pendingVoice) throw new Error('未获取到录音文件')
					if (intent === 'transcribe') await this.transcribePendingVoice()
					else {
						const sent = await this.sendPendingVoice()
						if (!sent) this.discardPendingVoice()
					}
				} catch (error) {
					this.resetRecordingState()
					uni.showToast({
						title: error && error.message ? error.message : reachedLimit ? '录音已到60秒，发送失败' : '录音处理失败',
						icon: 'none'
					})
					console.error('[Chat] 结束录音失败', error)
				} finally {
					this._voiceFinishing = false
				}
			},
			async cancelVoiceRecording() {
				if (!this.isRecording || this._voiceFinishing) return
				this.recordingGesture = 'cancel'
				await this.finishVoiceRecording()
			},
			stopVoiceCapture() {
				if (this._voiceStoppedResult) return Promise.resolve(this._voiceStoppedResult)
				if (this._voiceRecorderType === 'native' && this._recorderManager) {
					this._recorderManager.stop()
					return this.waitForVoiceStop()
				}
				if (this._voiceRecorderType === 'h5' && this._mediaRecorder) {
					if (this._mediaRecorder.state !== 'inactive') this._mediaRecorder.stop()
					this.stopMediaStream()
					return this.waitForVoiceStop()
				}
				return Promise.resolve({})
			},
			waitForVoiceStop() {
				if (!this._voiceStopPromise) return Promise.resolve({})
				return Promise.race([
					this._voiceStopPromise,
					new Promise((resolve, reject) => setTimeout(() => reject(new Error('结束录音超时，请重试')), 5000))
				])
			},
			normalizeRecordedVoice(result, duration) {
				if (!result) return null
				const path = result.tempFilePath || result.path || ''
				const file = result.file || null
				const source = file || path
				if (!source) return null
				const fileInfo = getVoiceFileInfo(path)
				return {
					source,
					path,
					file,
					duration,
					mimeType: result.mimeType || file && file.type || fileInfo.mimeType,
					name: result.name || file && file.name || fileInfo.name
				}
			},
			/** 云信 voiceToText 可直接接收本地 File 或 uni-app 临时文件路径。 */
			async transcribePendingVoice() {
				const voice = this.pendingVoice
				if (!voice || this.isTranscribingVoice) return
				this.isTranscribingVoice = true
				uni.showLoading({ title: '正在转文字...', mask: true })
				try {
					const nim = getNimInstance()
					if (!nim.V2NIMMessageService || typeof nim.V2NIMMessageService.voiceToText !== 'function') {
						throw new Error('当前云信 SDK 不支持语音转文字')
					}
					const params = {
						duration: voice.duration
					}
					if (voice.file) params.file = voice.file
					else params.voicePath = voice.path
					if (voice.mimeType) params.mimeType = voice.mimeType
					const text = await nim.V2NIMMessageService.voiceToText(params)
					if (!String(text || '').trim()) throw new Error('未识别到有效文字')

					// 默认只展示识别结果，用户点击文本区域时再唤起键盘编辑。
					this.transcribedText = String(text).trim()
					this.showVoiceTextEditor = true
				} catch (error) {
					this.discardPendingVoice()
					uni.showToast({
						title: error && error.message ? error.message : '语音转文字失败',
						icon: 'none'
					})
					console.error('[Chat] 云信语音转文字失败', error)
				} finally {
					uni.hideLoading()
					this.isTranscribingVoice = false
				}
			},
			/** 发送录音原文件；转文字页点击“发送原语音”也复用此方法。 */
			async sendPendingVoice() {
				const voice = this.pendingVoice
				if (!voice || this.isSendingMessage) return false
				this.isSendingMessage = true
				uni.showLoading({ title: '语音发送中...', mask: true })
				try {
					const nim = getNimInstance()
					const message = nim.V2NIMMessageCreator.createAudioMessage(
						voice.source,
						voice.name,
						undefined,
						voice.duration
					)
					const result = await nim.V2NIMMessageService.sendMessage(message, this.conversationId)
					if (!result || !result.message) throw new Error('语音发送失败：SDK 未返回消息')

					this.mergeMessages([result.message])
					this.discardPendingVoice()
					this.$nextTick(() => this.scrollToBottom(true))
					return true
				} catch (error) {
					uni.showToast({
						title: error && error.message ? error.message : '语音发送失败',
						icon: 'none'
					})
					console.error('[Chat] 发送云信语音消息失败', error)
					return false
				} finally {
					uni.hideLoading()
					this.isSendingMessage = false
				}
			},
			async sendTranscribedText() {
				const content = this.transcribedText.trim()
				if (!content) {
					uni.showToast({ title: '请输入消息', icon: 'none' })
					return
				}
				const sent = await this.sendTextContent(content)
				if (sent) this.discardPendingVoice()
			},
			discardPendingVoice() {
				this.pendingVoice = null
				this.showVoiceTextEditor = false
				this.transcribedText = ''
			},
			clearVoiceTimer() {
				if (this._voiceTimer) clearInterval(this._voiceTimer)
				this._voiceTimer = null
			},
			stopMediaStream() {
				if (this._mediaStream && typeof this._mediaStream.getTracks === 'function') {
					this._mediaStream.getTracks().forEach(track => track.stop())
				}
				this._mediaStream = null
			},
			resetRecordingState() {
				this.clearVoiceTimer()
				if (this._voiceStartTimeout) clearTimeout(this._voiceStartTimeout)
				this._voiceStartTimeout = null
				this.stopMediaStream()
				this.isRecording = false
				this.recordingGesture = 'send'
				this.recordingElapsed = 0
				this._voiceTouchActive = false
				this._voiceRecordingStartedAt = 0
				this._voiceStoppedResult = null
				this._voiceRecorderType = ''
				this._voiceStopPromise = null
				this._voiceStartResolve = null
				this._voiceStartReject = null
				this._voiceStopResolve = null
				this._mediaRecorder = null
				this._mediaChunks = null
			},
			abortVoiceRecording() {
				this._voiceTouchActive = false
				this.clearVoiceTimer()
				try {
					if (this._voiceRecorderType === 'native' && this._recorderManager) this._recorderManager.stop()
					if (this._voiceRecorderType === 'h5' && this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
						this._mediaRecorder.stop()
					}
				} catch (error) {
					console.warn('[Chat] 释放录音器失败', error)
				}
				this.resetRecordingState()
			},
			playAudioMessage(message) {
				if (!message || !message.url || typeof uni.createInnerAudioContext !== 'function') return
				if (this.audioPlayingId === message.id) {
					this.destroyAudioPlayer()
					return
				}
				this.destroyAudioPlayer()
				const player = uni.createInnerAudioContext()
				this._audioPlayer = player
				this.audioPlayingId = message.id
				player.src = message.url
				player.onEnded(() => this.destroyAudioPlayer())
				player.onError(error => {
					this.destroyAudioPlayer()
					uni.showToast({ title: '语音播放失败', icon: 'none' })
					console.error('[Chat] 播放语音失败', error)
				})
				player.play()
			},
			destroyAudioPlayer() {
				if (this._audioPlayer) {
					try {
						this._audioPlayer.stop()
						this._audioPlayer.destroy()
					} catch (error) {
						console.warn('[Chat] 释放语音播放器失败', error)
					}
				}
				this._audioPlayer = null
				this.audioPlayingId = ''
			},
			closePanel() {
				if (this.activePanel) this.activePanel = ''
				this.isEditingCommonPhrases = false
			},
			handleInputFocus() {
				this.inputFocused = true
				this.activePanel = ''
				this.isEditingCommonPhrases = false
				this.$nextTick(() => this.scrollToBottom(false))
			},
			usePhrase(phrase) {
				this.draft = phrase
				this.activePanel = ''
				this.isEditingCommonPhrases = false
				this.inputFocused = true
			},
			toggleCommonPhraseEditing() {
				this.isEditingCommonPhrases = !this.isEditingCommonPhrases
			},
			openQuickReplyModal(phrase = null) {
				this.quickReplyId = phrase && phrase.id ? phrase.id : null
				this.quickReplyText = phrase && phrase.message ? phrase.message : ''
				this.isEditingCommonPhrases = false
				this.showQuickReplyModal = true
			},
			closeQuickReplyModal() {
				if (this.isSavingCommonPhrase) return
				this.showQuickReplyModal = false
				this.quickReplyText = ''
				this.quickReplyId = null
			},
			async saveCommonPhrase() {
				if (this.isSavingCommonPhrase) return

				const message = this.quickReplyText.trim()
				if (!message) {
					uni.showToast({
						title: '请输入常用语内容',
						icon: 'none'
					})
					return
				}

				this.isSavingCommonPhrase = true
				try {
					const response = await requestApi({
						Name: COMMON_LANGUAGE_SAVE_API,
						Content: {
							Id: this.quickReplyId,
							Msg: message
						}
					})
					const responseCode = response && response.Code !== undefined ?
						Number(response.Code) :
						NaN
					const data = response && response.Data ? response.Data : {}
					const dataCode = data.Code !== undefined ? Number(data.Code) : 0

					if (responseCode === 4400003 || dataCode === 4400003) {
						throw new Error('最多只能设置10条常用语')
					}
					if (responseCode !== 0) {
						throw new Error(`保存常用语失败，业务错误码：${responseCode}`)
					}
					if (dataCode !== 0) {
						throw new Error(`保存常用语失败，数据错误码：${dataCode}`)
					}

					this.showQuickReplyModal = false
					this.quickReplyText = ''
					this.quickReplyId = null
					await this.loadCommonPhrases()
					uni.showToast({
						title: '保存成功',
						icon: 'success'
					})
				} catch (error) {
					uni.showToast({
						title: error && error.message ? error.message : '保存常用语失败',
						icon: 'none'
					})
					console.error('[Chat] 保存常用语失败', error)
				} finally {
					this.isSavingCommonPhrase = false
				}
			},
			sendQuickReply() {
				if (this.isSavingCommonPhrase) return

				const message = this.quickReplyText.trim()
				if (!message) {
					uni.showToast({
						title: '请输入回复内容',
						icon: 'none'
					})
					return
				}

				this.showQuickReplyModal = false
				this.quickReplyText = ''
				this.quickReplyId = null
				this.draft = message
				this.sendMessage()
			},
			handleCommonPhraseAction(action, phrase) {
				if (action === 'edit') {
					this.openQuickReplyModal(phrase)
					return
				}
				if (action === 'delete') {
					this.confirmDeleteCommonPhrase(phrase)
					return
				}

				uni.showToast({
					title: '常用语设置功能待接入',
					icon: 'none'
				})
			},
			confirmDeleteCommonPhrase(phrase) {
				if (this.deletingCommonPhraseId) return

				uni.showModal({
					title: '删除常用语',
					content: '确定要删除这条常用语吗？',
					confirmText: '确认删除',
					confirmColor: '#e54d42',
					success: result => {
						if (result.confirm) this.deleteCommonPhrase(phrase)
					}
				})
			},
			async deleteCommonPhrase(phrase) {
				if (this.deletingCommonPhraseId) return

				const phraseId = phrase && phrase.id ? phrase.id : ''
				if (!phraseId) {
					uni.showToast({
						title: '未获取到常用语ID',
						icon: 'none'
					})
					return
				}

				this.deletingCommonPhraseId = phraseId
				try {
					const response = await requestApi({
						Name: COMMON_LANGUAGE_DELETE_API,
						Content: {
							Id: phraseId
						}
					})
					if (!response || Number(response.Code) !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`删除常用语失败，业务错误码：${code}`)
					}

					this.commonPhrases = this.commonPhrases.filter(item => item.id !== phraseId)
					uni.showToast({
						title: '删除成功',
						icon: 'success'
					})
					await this.loadCommonPhrases()
				} catch (error) {
					uni.showToast({
						title: error && error.message ? error.message : '删除常用语失败',
						icon: 'none'
					})
					console.error('[Chat] 删除常用语失败', error)
				} finally {
					this.deletingCommonPhraseId = ''
				}
			},
			appendEmoji(emoji) {
				if (!emoji || !emoji.key) return
				this.draft += emoji.key
			},
			/**
			 * 读取临时图片文件大小。chooseImage 在 App/小程序端会直接返回 size，
			 * 对未提供 size 的运行环境再通过 getFileInfo 补查，避免绕过 25 MB 限制。
			 */
			getImageFileSize(filePath, fileObject) {
				const nestedFile = fileObject && (fileObject.file || fileObject.raw)
				const knownSize = Number(fileObject && fileObject.size) ||
					Number(nestedFile && nestedFile.size) || 0
				if (knownSize) return Promise.resolve(knownSize)

				// #ifdef H5
				// H5 没有 uni.getFileInfo，通过 Blob URL 读取文件大小。
				if (filePath && typeof fetch === 'function') {
					return fetch(filePath)
						.then(response => response.blob())
						.then(blob => Number(blob && blob.size) || 0)
						.catch(() => 0)
				}
				// #endif

				if (!filePath || typeof uni.getFileInfo !== 'function') return Promise.resolve(0)

				return new Promise(resolve => {
					uni.getFileInfo({
						filePath,
						success: result => resolve(Number(result && result.size) || 0),
						fail: () => resolve(0)
					})
				})
			},
			/**
			 * H5 使用 Canvas 压缩为 JPEG；App/小程序使用 uni.compressImage。
			 * 不支持压缩的图片格式会回退到原图，并继续执行 25 MB 校验。
			 */
			compressChatImage(filePath, sourceFile) {
				// #ifdef H5
				return this.compressH5ChatImage(filePath, sourceFile).catch(error => {
					console.warn('[Chat] H5 图片压缩失败，回退发送原图', error)
					const fallbackFile = sourceFile && (sourceFile.file || sourceFile.raw) || sourceFile
					return {
						path: filePath,
						uploadSource: fallbackFile || filePath,
						name: fallbackFile && fallbackFile.name ? fallbackFile.name : getImageFileName(filePath),
						size: Number(sourceFile && sourceFile.size) || 0
					}
				})
				// #endif

				// #ifndef H5
				if (!filePath || typeof uni.compressImage !== 'function') {
					return Promise.resolve({
						path: filePath,
						uploadSource: filePath,
						size: 0
					})
				}

				return new Promise(resolve => {
					uni.compressImage({
						src: filePath,
						quality: IMAGE_COMPRESS_QUALITY,
						success: result => {
							const compressedPath = result && result.tempFilePath
							resolve({
								path: compressedPath || filePath,
								uploadSource: compressedPath || filePath,
								size: Number(result && result.size) || 0
							})
						},
						fail: error => {
							// GIF 等格式在部分平台不能压缩，保留原图继续走大小校验和发送。
							console.warn('[Chat] 图片压缩失败，回退发送原图', error)
							resolve({
								path: filePath,
								uploadSource: filePath,
								size: 0
							})
						}
					})
				})
				// #endif
			},
			// #ifdef H5
			/**
			 * H5 端使用浏览器 Canvas 压缩图片。输出 File 直接交给云信 SDK 上传，
			 * Blob URL 仅用于读取尺寸，并在消息发送结束后由 cleanup 释放。
			 */
			async compressH5ChatImage(filePath, sourceFile) {
				if (!filePath && !sourceFile) throw new Error('未获取到图片文件')

				const browserFile = typeof Blob === 'undefined' ?
					null :
					[sourceFile, sourceFile && sourceFile.file, sourceFile && sourceFile.raw]
					.find(item => item instanceof Blob) || null
				const sourceType = browserFile && browserFile.type ?
					String(browserFile.type).toLowerCase() :
					sourceFile && sourceFile.type ? String(sourceFile.type).toLowerCase() : ''
				const sourceName = browserFile && browserFile.name ?
					String(browserFile.name) :
					sourceFile && sourceFile.name ? String(sourceFile.name) : String(filePath || '')
				const isGif = sourceType === 'image/gif' || /\.gif(?:$|\?)/i.test(sourceName)
				if (isGif) {
					// Canvas 只能保留 GIF 第一帧，聊天场景中应保留原始动图。
					return {
						path: filePath,
						uploadSource: browserFile || sourceFile || filePath,
						name: sourceName || getImageFileName(filePath),
						size: Number(browserFile && browserFile.size) || Number(sourceFile && sourceFile.size) || 0
					}
				}

				let sourceUrl = filePath
				let shouldRevokeSourceUrl = false
				if (browserFile) {
					sourceUrl = URL.createObjectURL(browserFile)
					shouldRevokeSourceUrl = true
				}
				if (!sourceUrl) throw new Error('未获取到图片临时地址')

				try {
					const imageElement = await new Promise((resolve, reject) => {
						const image = new Image()
						image.onload = () => resolve(image)
						image.onerror = () => reject(new Error('浏览器读取图片失败'))
						image.src = sourceUrl
					})
					const sourceWidth = Number(imageElement.naturalWidth || imageElement.width) || 0
					const sourceHeight = Number(imageElement.naturalHeight || imageElement.height) || 0
					if (!sourceWidth || !sourceHeight) throw new Error('未获取到图片尺寸')

					const scale = Math.min(1, H5_IMAGE_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
					const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
					const targetHeight = Math.max(1, Math.round(sourceHeight * scale))
					const canvas = document.createElement('canvas')
					canvas.width = targetWidth
					canvas.height = targetHeight
					const context = canvas.getContext('2d')
					if (!context) throw new Error('浏览器不支持图片压缩')

					// JPEG 不支持透明通道，先铺白色背景，避免透明 PNG 变黑。
					context.fillStyle = '#ffffff'
					context.fillRect(0, 0, targetWidth, targetHeight)
					context.drawImage(imageElement, 0, 0, targetWidth, targetHeight)
					const compressedBlob = await new Promise((resolve, reject) => {
						canvas.toBlob(blob => {
							if (blob) resolve(blob)
							else reject(new Error('浏览器生成压缩图片失败'))
						}, 'image/jpeg', IMAGE_COMPRESS_QUALITY / 100)
					})
					if (browserFile && browserFile.size && compressedBlob.size >= browserFile.size) {
						// 压缩结果反而更大时发送原文件，避免无效增容并保留原始格式。
						return {
							path: filePath,
							uploadSource: browserFile,
							name: sourceName || getImageFileName(filePath),
							size: browserFile.size,
							width: sourceWidth,
							height: sourceHeight
						}
					}

					const compressedName = getCompressedImageName(filePath, sourceFile)
					const compressedFile = new File([compressedBlob], compressedName, {
						type: 'image/jpeg',
						lastModified: Date.now()
					})
					const compressedUrl = URL.createObjectURL(compressedFile)
					return {
						path: compressedUrl,
						uploadSource: compressedFile,
						name: compressedName,
						size: compressedFile.size,
						width: targetWidth,
						height: targetHeight,
						cleanup: () => URL.revokeObjectURL(compressedUrl)
					}
				} finally {
					if (shouldRevokeSourceUrl) URL.revokeObjectURL(sourceUrl)
				}
			},
			// #endif
			/**
			 * 处理一张已选择的图片：校验原图、压缩、复核大小并发送到云信。
			 * 返回 oversize 供批量流程统一提示，避免连续弹出多个相同 Toast。
			 */
			async processSelectedImage(selectedFile, filePath, current, total) {
				let cleanupCompressedFile = null
				try {
					// 先检查原始文件，超过限制时不做无意义的压缩和上传。
					const originalSize = Number(selectedFile && selectedFile.size) ||
						await this.getImageFileSize(filePath, selectedFile)
					if (originalSize > MAX_IMAGE_SIZE) return 'oversize'

					const compressedFile = await this.compressChatImage(filePath, selectedFile)
					const compressedPath = compressedFile.path || filePath
					cleanupCompressedFile = compressedFile.cleanup || null
					const compressedSize = Number(compressedFile.size) ||
						await this.getImageFileSize(compressedPath, compressedFile.uploadSource)
					if (compressedSize > MAX_IMAGE_SIZE) return 'oversize'

					const imageInfo = await new Promise(resolve => {
						if (typeof uni.getImageInfo !== 'function') {
							resolve({})
							return
						}
						uni.getImageInfo({
							src: compressedPath,
							success: resolve,
							fail: () => resolve({})
						})
					})

					const isSent = await this.sendImageMessage({
						uploadSource: compressedFile.uploadSource || compressedPath,
						name: compressedFile.name || getImageFileName(compressedPath || filePath),
						width: Number(compressedFile.width) || Number(imageInfo && imageInfo.width) ||
							Number(selectedFile && selectedFile.width) || 0,
						height: Number(compressedFile.height) || Number(imageInfo && imageInfo.height) ||
							Number(selectedFile && selectedFile.height) || 0
					}, current, total)
					return isSent ? 'sent' : 'failed'
				} finally {
					if (typeof cleanupCompressedFile === 'function') cleanupCompressedFile()
				}
			},
			/**
			 * 相册最多选择 9 张并按顺序逐张发送；相机保持单张拍摄。
			 * 单张异常不会中断整个批次，超过 25 MB 的图片会跳过并统一提示。
			 */
			async selectAndSendImage(sourceType) {
				if (this.isSendingMessage || this.isSelectingImage) return
				if (!this.conversationId || !isNimLoggedIn()) {
					uni.showToast({
						title: '聊天服务尚未就绪',
						icon: 'none'
					})
					return
				}

				this.isSelectingImage = true
				try {
					const isCamera = sourceType === 'camera'
					const chooseResult = await new Promise((resolve, reject) => {
						uni.chooseImage({
							count: isCamera ? 1 : 9,
							sourceType: [isCamera ? 'camera' : 'album'],
							success: resolve,
							fail: reject
						})
					})
					const tempFiles = chooseResult && Array.isArray(chooseResult.tempFiles) ?
						chooseResult.tempFiles.slice(0, isCamera ? 1 : 9) :
						[]
					const tempFilePaths = chooseResult && Array.isArray(chooseResult.tempFilePaths) ?
						chooseResult.tempFilePaths.slice(0, isCamera ? 1 : 9) :
						[]
					const selectedCount = Math.max(tempFiles.length, tempFilePaths.length)
					const selectedImages = Array.from({
						length: selectedCount
					}, (unused, index) => {
						const file = tempFiles[index] || null
						return {
							file,
							path: file && (file.path || file.tempFilePath) || tempFilePaths[index] || ''
						}
					}).filter(item => item.path)
					if (!selectedImages.length) return

					let oversizeCount = 0
					let processFailedCount = 0
					for (let index = 0; index < selectedImages.length; index += 1) {
						const item = selectedImages[index]
						try {
							const result = await this.processSelectedImage(
								item.file,
								item.path,
								index + 1,
								selectedImages.length
							)
							if (result === 'oversize') oversizeCount += 1
							else if (result !== 'sent') processFailedCount += 1
						} catch (error) {
							processFailedCount += 1
							console.error(`[Chat] 第 ${index + 1} 张图片处理失败`, error)
						}
					}

					if (oversizeCount) {
						uni.showToast({
							title: '图片大小超过25m，无法发送',
							icon: 'none'
						})
					} else if (processFailedCount) {
						uni.showToast({
							title: '部分图片处理失败，请重试',
							icon: 'none'
						})
					}
				} catch (error) {
					const errorText = error && (error.errMsg || error.message) ? (error.errMsg || error.message) : ''
					if (/cancel/i.test(errorText)) return
					uni.showToast({
						title: errorText || '图片选择失败，请重试',
						icon: 'none'
					})
					console.error('[Chat] 选择图片失败', error)
				} finally {
					this.isSelectingImage = false
				}
			},
			/**
			 * 使用网易云信 V2 图片消息构造器上传并发送。SDK 会负责 NOS 上传，
			 * 发送成功后将服务端返回的消息合并到当前列表，和文本消息保持一致。
			 */
			async sendImageMessage(image, current = 1, total = 1) {
				if (!image || !image.uploadSource || this.isSendingMessage) return false

				this.isSendingMessage = true
				this.imageUploadProgress = 0
				uni.showLoading({
					title: total > 1 ? `发送图片 ${current}/${total}` : '图片发送中...',
					mask: true
				})
				try {
					const nim = getNimInstance()
					const message = nim.V2NIMMessageCreator.createImageMessage(
						image.uploadSource,
						image.name,
						undefined,
						image.width || undefined,
						image.height || undefined
					)
					const result = await nim.V2NIMMessageService.sendMessage(
						message,
						this.conversationId, {},
						progress => {
							const progressValue = Number(progress) || 0
							this.imageUploadProgress = Math.max(0, Math.min(100, Math.round(
								progressValue <= 1 ? progressValue * 100 : progressValue
							)))
						}
					)
					if (!result || !result.message) throw new Error('图片发送失败：SDK 未返回消息')

					uni.hideLoading()
					this.mergeMessages([result.message])
					this.activePanel = ''
					this.$nextTick(() => this.scrollToBottom(true))
					return true
				} catch (error) {
					uni.hideLoading()
					// 批量发送时由外层统一提示，避免一张失败弹出两次 Toast。
					if (total <= 1) {
						uni.showToast({
							title: error && error.message ? error.message : '图片发送失败',
							icon: 'none'
						})
					}
					console.error('[Chat] 发送云信图片消息失败', error)
					return false
				} finally {
					this.isSendingMessage = false
					this.imageUploadProgress = 0
				}
			},
			async sendMessage() {
				if (this.isSendingMessage || this.isSelectingImage) return

				const content = this.draft.trim()
				if (!content) {
					uni.showToast({
						title: '请输入消息',
						icon: 'none'
					})
					return
				}
				const sent = await this.sendTextContent(content)
				if (sent) this.draft = ''
			},
			/** 文本输入框与语音转文字编辑页共用同一套云信文本发送逻辑。 */
			async sendTextContent(content) {
				if (this.isSendingMessage || this.isSelectingImage) return false
				if (!this.conversationId || !isNimLoggedIn()) {
					uni.showToast({
						title: '聊天服务尚未就绪',
						icon: 'none'
					})
					return false
				}

				this.isSendingMessage = true
				try {
					const nim = getNimInstance()
					const message = nim.V2NIMMessageCreator.createTextMessage(content)
					const result = await nim.V2NIMMessageService.sendMessage(message, this.conversationId)
					if (!result || !result.message) throw new Error('消息发送失败：SDK 未返回消息')

					this.mergeMessages([result.message])
					this.activePanel = ''
					this.$nextTick(() => this.scrollToBottom(true))
					return true
				} catch (error) {
					uni.showToast({
						title: error && error.message ? error.message : '消息发送失败',
						icon: 'none'
					})
					console.error('[Chat] 发送云信消息失败', error)
					return false
				} finally {
					this.isSendingMessage = false
				}
			},
			previewImage(url) {
				if (!url) return
				// 预览当前会话内的全部图片，并保持聊天消息顺序，支持左右滑动切换。
				const urls = this.messages.reduce((result, message) => {
					const attachment = message && message.attachment ? message.attachment : {}
					if (Number(message && message.messageType) === 1 && attachment.url) {
						result.push(attachment.url)
					}
					return result
				}, [])
				// 当前图片尚未写入消息列表时仍保证可以正常预览。
				if (!urls.includes(url)) urls.push(url)
				uni.previewImage({
					current: url,
					urls
				})
			},
			handleMoreAction(item) {
				this.activePanel = ''
				if (item && item.key === 'photo') {
					this.selectAndSendImage('album')
					return
				}
				if (item && item.key === 'camera') {
					this.selectAndSendImage('camera')
					return
				}
				if (item && item.key === 'audio') {
					this.enterVoiceMode()
					return
				}
				uni.showToast({
					title: `${item.label}功能待接入`,
					icon: 'none'
				})
			}
		}
	}
</script>

<style lang="scss" scoped>
	.chat-page {
		width: 100%;
		height: 100vh;
		overflow: hidden;
		background: #f3f6f8;
		color: #333333;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.fixed-header {
		position: fixed;
		top: 0;
		right: 0;
		left: 0;
		z-index: 20;
		background: #ffffff;
		box-shadow: 0 1rpx 0 rgba(0, 0, 0, 0.04);
	}

	.navigation-bar {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 88rpx;

		.back-button {
			position: absolute;
			top: 0;
			left: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 88rpx;
			height: 88rpx;

			.back-icon {
				width: 18rpx;
				height: 18rpx;
				border-bottom: 3rpx solid #202020;
				border-left: 3rpx solid #202020;
				transform: rotate(45deg);
			}
		}

		.navigation-title {
			font-size: 32rpx;
			color: #222222;
		}
	}

	.action-menu {
		display: flex;
		align-items: center;
		height: 132rpx;

		.action-item {
			display: flex;
			flex: 1;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			height: 100%;
			color: #6f6f6f;

			.action-icon-wrap {
				position: relative;
			}

			.action-dot {
				position: absolute;
				top: -4rpx;
				right: -4rpx;
				width: 12rpx;
				height: 12rpx;
				background: #2399ed;
				border: 2rpx solid #ffffff;
				border-radius: 50%;
			}

			.action-label {
				margin-top: 8rpx;
				font-size: 24rpx;
			}
		}
	}

	.message-scroll {
		position: fixed;
		top: 220rpx;
		right: 0;
		bottom: calc(112rpx + env(safe-area-inset-bottom));
		left: 0;
		box-sizing: border-box;
		background: #f3f6f8;
		transition: bottom 0.18s ease;

		&.message-scroll--panel {
			bottom: calc(412rpx + env(safe-area-inset-bottom));
		}
	}

	.message-content {
		box-sizing: border-box;
		min-height: 100%;
		padding: 0 28rpx 30rpx;
	}

	.load-status {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 60rpx;
		font-size: 22rpx;
		color: #a0a4a8;

		&.load-status--error {
			color: #2399ed;
		}
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 240rpx;
		font-size: 24rpx;
		color: #a0a4a8;
	}

	.time-divider {
		padding: 12rpx 0 28rpx;
		text-align: center;
		font-size: 22rpx;
		color: #a8a8a8;
	}

	.system-message {
		box-sizing: border-box;
		max-width: 82%;
		margin: 0 auto 28rpx;
		padding: 10rpx 18rpx;
		text-align: center;
		font-size: 22rpx;
		line-height: 1.5;
		color: #92979c;
		background: rgba(0, 0, 0, 0.04);
		border-radius: 8rpx;
	}

	.message-row {
		display: flex;
		align-items: flex-end;
		margin-bottom: 28rpx;

		.message-avatar {
			flex-shrink: 0;
			width: 70rpx;
			height: 70rpx;
			border-radius: 50%;
		}

		.message-bubble {
			box-sizing: border-box;
			max-width: 68%;
			min-height: 70rpx;
			padding: 16rpx 24rpx;
			font-size: 28rpx;
			line-height: 1.65;
			word-break: break-all;
			border-radius: 8rpx;

			&.message-bubble--image {
				min-height: 0;
				padding: 0;
				overflow: hidden;
				background: transparent;
			}
		}

		.message-image {
			display: block;
			width: 320rpx;
			max-height: 420rpx;
		}

		.message-bubble--audio {
			min-width: 150rpx;
			padding-top: 10rpx;
			padding-bottom: 10rpx;
		}

		.audio-message-content {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 24rpx;
			min-height: 50rpx;
		}

		.audio-message-icon {
			font-size: 26rpx;
			line-height: 1;
		}

		.audio-message-duration {
			font-size: 24rpx;
			line-height: 1;
		}

		.message-text {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			max-width: 100%;
		}

		.message-text-copy {
			max-width: 100%;
			white-space: pre-wrap;
			word-break: break-all;
		}

		.message-emoji {
			flex-shrink: 0;
			width: 44rpx;
			height: 44rpx;
			margin: 0 2rpx;
			vertical-align: middle;
		}

		&.other {
			flex-direction: row;

			.message-avatar {
				margin-right: 20rpx;
			}

			.message-bubble {
				background: #2399ed;
				color: #ffffff;
			}
		}

		&.self {
			flex-direction: row-reverse;

			.message-avatar {
				margin-left: 20rpx;
			}

			.message-bubble {
				background: #ffffff;
				color: #686868;
			}
		}
	}

	.message-bottom {
		height: 2rpx;
	}

	.composer {
		position: fixed;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 30;
		box-sizing: border-box;
		padding-bottom: env(safe-area-inset-bottom);
		background: #ffffff;
		box-shadow: 0 -1rpx 0 #eeeeee;
	}

	.composer-main {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		height: 112rpx;
		padding: 16rpx 28rpx;

		.phrase-button,
		.send-button {
			flex-shrink: 0;
			box-sizing: border-box;
			margin: 0;
			height: 68rpx;
			padding: 0 20rpx;
			font-size: 24rpx;
			line-height: 68rpx;
			color: #ffffff;
			background: #2399ed;
			border: none;
			border-radius: 8rpx;

			&::after {
				border: none;
			}
		}

		.send-button {
			margin-left: 18rpx;

			&[disabled] {
				color: #ffffff;
				background: #8bc9f3;
			}
		}

		.phrase-icon {
			flex-shrink: 0;
			width: 120rpx;
			height: 70rpx;
		}

		.message-input {
			flex: 1;
			min-width: 0;
			box-sizing: border-box;
			height: 68rpx;
			margin-left: 28rpx;
			padding: 0 20rpx;
			font-size: 28rpx;
			background: #f3f6f8;
			border: 1rpx solid #e5e8eb;
			border-radius: 8rpx;
		}

		.round-button {
			flex-shrink: 0;
			width: 60rpx;
			height: 60rpx;
			margin-left: 20rpx;
		}

		.voice-button {
			flex: 1;
			box-sizing: border-box;
			min-width: 0;
			height: 68rpx;
			margin: 0 0 0 28rpx;
			padding: 0 20rpx;
			font-size: 28rpx;
			font-weight: 500;
			line-height: 68rpx;
			color: #333333;
			background: #f3f6f8;
			border: 1rpx solid #e5e8eb;
			border-radius: 8rpx;

			&::after {
				border: none;
			}
		}
	}

	.voice-record-mask,
	.voice-text-mask {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 120;
		background: rgba(0, 0, 0, 0.72);
	}

	.voice-record-card {
		position: absolute;
		top: 43%;
		left: 50%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 360rpx;
		min-height: 176rpx;
		padding: 28rpx 30rpx 22rpx;
		color: #17370c;
		background: #91ed61;
		border-radius: 28rpx;
		transform: translate(-50%, -50%);

		&::after {
			position: absolute;
			bottom: -20rpx;
			left: 50%;
			width: 40rpx;
			height: 40rpx;
			content: '';
			background: #91ed61;
			border-radius: 4rpx;
			transform: translateX(-50%) rotate(45deg);
		}
	}

	.voice-wave {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 52rpx;

		.voice-wave-bar {
			display: block;
			width: 4rpx;
			height: 18rpx;
			margin: 0 2rpx;
			background: #3e9530;
			border-radius: 4rpx;
			animation: voice-wave-pulse 0.72s ease-in-out infinite alternate;
		}

		&.voice-wave--warning .voice-wave-bar {
			background: #dd6b35;
		}
	}

	.voice-record-status {
		position: relative;
		z-index: 1;
		margin-top: 12rpx;
		font-size: 30rpx;
		font-weight: 600;
	}

	.voice-record-countdown {
		position: relative;
		z-index: 1;
		margin-top: 6rpx;
		font-size: 24rpx;
		color: #b54b28;
	}

	.voice-record-actions {
		position: absolute;
		right: 34rpx;
		bottom: calc(150rpx + env(safe-area-inset-bottom));
		left: 34rpx;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.voice-record-action {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 290rpx;
		height: 104rpx;
		font-size: 29rpx;
		font-weight: 600;
		color: #ffffff;
		background: rgba(255, 255, 255, 0.14);
		border: 2rpx solid rgba(255, 255, 255, 0.1);
		border-radius: 70rpx 70rpx 42rpx 42rpx;
		transition: background 0.12s ease, transform 0.12s ease;

		&.voice-record-action--active {
			color: #17370c;
			background: #91ed61;
			transform: translateY(-10rpx);
		}
	}

	.voice-text-mask {
		z-index: 130;
		background: rgba(27, 27, 27, 0.82);
	}

	.voice-text-close {
		position: absolute;
		top: calc(28rpx + env(safe-area-inset-top));
		left: 30rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 60rpx;
		height: 60rpx;
		font-size: 56rpx;
		font-weight: 200;
		line-height: 1;
		color: #ffffff;
	}

	.voice-text-editor-wrap {
		position: absolute;
		top: 43%;
		left: 50%;
		width: calc(100% - 80rpx);
		transform: translate(-50%, -50%);

		&::after {
			position: absolute;
			right: 86rpx;
			bottom: -18rpx;
			width: 36rpx;
			height: 36rpx;
			content: '';
			background: #91ed61;
			border-radius: 4rpx;
			transform: rotate(45deg);
		}
	}

	.voice-text-editor {
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		width: 100%;
		height: 180rpx;
		padding: 28rpx 34rpx;
		font-size: 34rpx;
		line-height: 1.55;
		color: #111111;
		background: #91ed61;
		border-radius: 28rpx;
	}

	.voice-text-footer {
		position: absolute;
		right: 44rpx;
		bottom: calc(90rpx + env(safe-area-inset-bottom));
		left: 44rpx;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 20rpx;
	}

	.voice-text-action {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		height: 88rpx;
		padding: 0 38rpx;
		font-size: 28rpx;
		border-radius: 48rpx;

		&.voice-text-action--audio {
			color: #f1f1f1;
			background: rgba(255, 255, 255, 0.16);
		}

		&.voice-text-action--text {
			min-width: 210rpx;
			color: #111111;
			background: #f5f5f5;
		}
	}

	@keyframes voice-wave-pulse {
		from {
			height: 12rpx;
		}

		to {
			height: 46rpx;
		}
	}

	.extension-panel {
		box-sizing: border-box;
		height: 300rpx;
		overflow-y: auto;
		padding: 20rpx 28rpx 28rpx;
		border-top: 1rpx solid #f0f0f0;
		background: #f7f8fa;

		&.extension-panel--phrases {
			overflow: hidden;
			padding: 0;
			background: #ffffff;
		}
	}

	.phrase-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.phrase-list {
		flex: 1;
		min-height: 0;
		overflow: hidden;

		.phrase-status {
			padding: 36rpx 22rpx;
			text-align: center;
			font-size: 26rpx;
			color: #999999;
			background: #ffffff;
			border-radius: 10rpx;

			&.phrase-status--error {
				color: #2399ed;
			}
		}

		.phrase-item {
			display: flex;
			align-items: center;
			box-sizing: border-box;
			padding: 20rpx 22rpx;
			font-size: 26rpx;
			color: #555555;
			background: #ffffff;
			border-bottom: 1rpx solid #eeeeee;

			.phrase-message {
				display: block;
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.phrase-item-actions {
				display: flex;
				flex-shrink: 0;
				align-items: center;
				gap: 24rpx;
				margin-left: 24rpx;

				.phrase-item-action-icon {
					width: 30rpx;
					height: 30rpx;

					&.phrase-item-action-icon--disabled {
						opacity: 0.4;
					}
				}
			}

			&:first-child {
				border-radius: 10rpx 10rpx 0 0;
			}

			&:last-child {
				border-bottom: none;
				border-radius: 0 0 10rpx 10rpx;
			}
		}
	}

	.phrase-actions {
		position: relative;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		height: 72rpx;
		background: #ffffff;
		border-top: 1rpx solid #eeeeee;

		.phrase-add {
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 26rpx;
			color: #555555;

			.phrase-add-icon {
				width: 30rpx;
				height: 30rpx;
				margin-right: 8rpx;
			}
		}

		.phrase-setting-icon {
			position: absolute;
			right: 28rpx;
			width: 32rpx;
			height: 32rpx;
		}
	}

	.quick-reply-mask {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 40rpx;
		background: rgba(0, 0, 0, 0.55);
	}

	.quick-reply-dialog {
		overflow: hidden;
		width: 560rpx;
		background: #ffffff;
		border-radius: 8rpx;
		box-shadow: 0 10rpx 40rpx rgba(0, 0, 0, 0.18);
	}

	.quick-reply-header {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 88rpx;

		.quick-reply-title {
			font-size: 32rpx;
			font-weight: 600;
			color: #444444;
		}

		.quick-reply-close {
			position: absolute;
			top: 0;
			right: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 80rpx;
			height: 80rpx;
			font-size: 42rpx;
			font-weight: 300;
			color: #999999;
		}
	}

	.quick-reply-body {
		position: relative;
		padding: 0 36rpx 28rpx;

		.quick-reply-input {
			box-sizing: border-box;
			width: 100%;
			height: 160rpx;
			padding: 16rpx 18rpx 40rpx;
			font-size: 24rpx;
			line-height: 1.45;
			color: #555555;
			background: #f3f5f6;
			border: 1rpx solid #e2e5e7;
			border-radius: 4rpx;
		}

		.quick-reply-placeholder {
			color: #999999;
		}

		.quick-reply-count {
			position: absolute;
			right: 50rpx;
			bottom: 40rpx;
			font-size: 20rpx;
			color: #aaaaaa;
		}
	}

	.quick-reply-footer {
		display: flex;
		height: 88rpx;
		border-top: 1rpx solid #eeeeee;

		.quick-reply-button {
			display: flex;
			flex: 1;
			align-items: center;
			justify-content: center;
			font-size: 30rpx;
			color: #2399ed;

			&+.quick-reply-button {
				border-left: 1rpx solid #eeeeee;
			}

			&.quick-reply-button--disabled {
				opacity: 0.55;
			}
		}
	}

	.send-resume-mask {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 110;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 40rpx;
		background: rgba(0, 0, 0, 0.55);
	}

	.send-resume-dialog {
		overflow: hidden;
		width: 560rpx;
		background: #ffffff;
		border-radius: 8rpx;
		box-shadow: 0 10rpx 40rpx rgba(0, 0, 0, 0.18);
	}

	.send-resume-content {
		padding: 42rpx 40rpx 30rpx;
		text-align: center;

		.send-resume-title,
		.send-resume-tip {
			display: block;
		}

		.send-resume-title {
			font-size: 32rpx;
			font-weight: 600;
			line-height: 44rpx;
			color: #333333;
		}

		.send-resume-tip {
			margin-top: 16rpx;
			font-size: 25rpx;
			line-height: 36rpx;
			color: #999999;
		}
	}

	.send-resume-job {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		height: 58rpx;
		margin-top: 28rpx;
		padding: 0 12rpx;
		overflow: hidden;
		background: #f5f7f8;
	}

	.send-resume-job-item {
		display: flex;
		flex: 1;
		align-items: center;
		min-width: 0;

		&.send-resume-job-item--name {
			flex: 1.35;
		}

		&+.send-resume-job-item {
			margin-left: 12rpx;
		}

		.send-resume-job-icon {
			flex-shrink: 0;
			margin-right: 8rpx;
		}

		.send-resume-job-text {
			display: block;
			min-width: 0;
			overflow: hidden;
			text-align: left;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 22rpx;
			color: #999999;
		}
	}

	.send-resume-actions {
		display: flex;
		height: 88rpx;
		border-top: 1rpx solid #eeeeee;

		.send-resume-button {
			display: flex;
			flex: 1;
			align-items: center;
			justify-content: center;
			font-size: 30rpx;

			&+.send-resume-button {
				border-left: 1rpx solid #eeeeee;
			}

			&.send-resume-button--cancel {
				color: #999999;
			}

			&.send-resume-button--confirm {
				color: #2399ed;
			}
		}
	}

	.emoji-list {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 18rpx 12rpx;

		.emoji-item {
			display: flex;
			align-items: center;
			justify-content: center;
			height: 64rpx;
			background: #ffffff;
			border-radius: 10rpx;

			.emoji-image {
				width: 48rpx;
				height: 48rpx;
			}
		}
	}

	.more-list {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 24rpx;

		.more-item {
			display: flex;
			flex-direction: column;
			align-items: center;
			font-size: 24rpx;
			color: #666666;

			.more-icon {
				width: 120rpx;
				height: 120rpx;
				margin-bottom: 16rpx;
				background: #ffffff;
				border-radius: 16rpx;
			}
		}
	}
</style>
