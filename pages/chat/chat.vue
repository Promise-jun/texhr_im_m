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
					<text class="action-label">{{ action.key === 'pin' && isPinned ? '已置顶' : action.label }}</text>
				</view>
			</view>
		</view>

		<scroll-view class="message-scroll" :class="{ 'message-scroll--panel': activePanel }"
			:style="{ top: scrollTopStyle }" scroll-y :scroll-into-view="scrollIntoView"
			:scroll-with-animation="scrollWithAnimation" :upper-threshold="80" @scrolltoupper="loadEarlierMessages"
			@click="closePanel">
			<view class="message-content">
				<view class="load-status" :class="{ 'load-status--error': historyLoadError }"
					@click="retryChatLoad">
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
						<view class="message-bubble" :class="{ 'message-bubble--image': message.type === 'image' }">
							<image v-if="message.type === 'image'" :src="message.url" class="message-image"
								mode="widthFix" @click.stop="previewImage(message.url)"></image>
							<view v-else class="message-text">
								<block v-for="(segment, segmentIndex) in message.segments"
									:key="segmentIndex">
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
				<image v-if="activePanel === 'phrases'" src="../../static/icon_key.png" class="phrase-icon"
					mode="aspectFit" @click="togglePanel('phrases')"></image>
				<button v-else class="phrase-button" @click="togglePanel('phrases')">常用语</button>
				<input v-model.trim="draft" class="message-input" :focus="inputFocused" confirm-type="send"
					cursor-spacing="18" maxlength="500" placeholder="输入消息" @focus="handleInputFocus"
					@confirm="sendMessage" />
				<image src="../../static/icon_emoji.png" class="round-button" @click="togglePanel('emoji')"></image>
				<button v-if="draft" class="send-button" :disabled="isSendingMessage" @click="sendMessage">
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
									:class="{ 'phrase-item-action-icon--disabled': deletingCommonPhraseId === phrase.id }" mode="aspectFit"
									@click.stop="handleCommonPhraseAction('delete', phrase)"></image>
							</view>
						</view>
					</scroll-view>
					<view class="phrase-actions">
						<view class="phrase-add" @click="openQuickReplyModal">
							<image src="../../static/icon_common_add.png" class="phrase-add-icon" mode="aspectFit"></image>
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
	</view>
</template>

<script>
	import { requestApi } from '../../services/request'
	import {
		NIM_EVENT,
		getNimLoginError,
		getNimInstance,
		isNimLoggedIn
	} from '../../services/nim'
	import { markNimConversationRead } from '../../services/conversation'
	import { NIM_EMOJIS, parseNimEmojiText } from '../../services/nim-emoji'

	const CHAT_LIMITS_API = 'Chat.MyChat.Limits'
	const COMMON_LANGUAGE_GET_API = 'Chat.CommonLanguage.Get'
	const COMMON_LANGUAGE_SAVE_API = 'Chat.CommonLanguage.Save'
	const COMMON_LANGUAGE_DELETE_API = 'Chat.CommonLanguage.Del'
	const HISTORY_PAGE_SIZE = 50
	const TIME_DIVIDER_INTERVAL = 5 * 60 * 1000
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

	function parseResponseData(data) {
		if (typeof data !== 'string') return data || {}
		if (!data.trim()) return {}

		try {
			return JSON.parse(data) || {}
		} catch (error) {
			throw new Error('沟通限制接口返回的数据格式不正确')
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
		const isToday = date.getFullYear() === now.getFullYear()
			&& date.getMonth() === now.getMonth()
			&& date.getDate() === now.getDate()

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
				draft: '',
				inputFocused: false,
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
				commonPhrases: [],
				isLoadingCommonPhrases: false,
				commonPhrasesError: '',
				isEditingCommonPhrases: false,
				showQuickReplyModal: false,
				quickReplyText: '',
				quickReplyId: null,
				isSavingCommonPhrase: false,
				deletingCommonPhraseId: '',
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
			await this.loadChatAccess()
		},
		onUnload() {
			this._chatPageAlive = false
			this.unbindNimLoginEvents()
			this.unbindMessageEvents()
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
				this.historyLoadError = error && (error.message || error.desc)
					? error.message || error.desc
					: '聊天服务连接失败'
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

					const data = parseResponseData(response.Data)
					if (data.Code !== undefined && Number(data.Code) !== 0) {
						throw new Error(`获取沟通状态失败，数据错误码：${data.Code}`)
					}
					// 兼容 SuccessStep/EnterpriseAccId 位于 Data 或响应根节点的两种返回结构。
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

					const enterpriseAccId = data.EnterpriseAccId !== undefined
						? data.EnterpriseAccId
						: response.EnterpriseAccId
					this.enterpriseAccId = enterpriseAccId === undefined || enterpriseAccId === null
						? ''
						: String(enterpriseAccId).trim()
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
					this.conversationId = nim.V2NIMConversationIdUtil.p2pConversationId(this.enterpriseAccId)
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
				const accountId = loginService && typeof loginService.getLoginUser === 'function'
					? loginService.getLoginUser()
					: ''
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
						const avatar = otherUser && typeof otherUser.avatar === 'string'
							? otherUser.avatar.trim()
							: ''
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

				const messageService = getNimInstance().V2NIMMessageService
				if (!messageService) throw new Error('当前网易云信 SDK 不支持消息服务')
				messageService.on('onReceiveMessages', this.handleReceiveMessages)
				this._messageService = messageService
				this._messageEventsBound = true
			},
			unbindMessageEvents() {
				if (!this._messageEventsBound || !this._messageService) return
				this._messageService.off('onReceiveMessages', this.handleReceiveMessages)
				this._messageService = null
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
				if (action.key === 'pin') {
					this.isPinned = !this.isPinned
					uni.showToast({
						title: this.isPinned ? '会话已置顶' : '已取消置顶',
						icon: 'none'
					})
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
					title: action.key === 'resume' ? '简历发送功能待接入' : '公司主页功能待接入',
					icon: 'none'
				})
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
					const responseCode = response && response.Code !== undefined
						? Number(response.Code)
						: NaN
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
			async sendMessage() {
				if (this.isSendingMessage) return

				const content = this.draft.trim()
				if (!content) {
					uni.showToast({
						title: '请输入消息',
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

				this.isSendingMessage = true
				try {
					const nim = getNimInstance()
					const message = nim.V2NIMMessageCreator.createTextMessage(content)
					const result = await nim.V2NIMMessageService.sendMessage(message, this.conversationId)
					if (!result || !result.message) throw new Error('消息发送失败：SDK 未返回消息')

					this.mergeMessages([result.message])
					this.draft = ''
					this.activePanel = ''
					this.$nextTick(() => this.scrollToBottom(true))
				} catch (error) {
					uni.showToast({
						title: error && error.message ? error.message : '消息发送失败',
						icon: 'none'
					})
					console.error('[Chat] 发送云信消息失败', error)
				} finally {
					this.isSendingMessage = false
				}
			},
			previewImage(url) {
				if (!url) return
				uni.previewImage({
					current: url,
					urls: [url]
				})
			},
			handleMoreAction(item) {
				this.activePanel = ''
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

			& + .quick-reply-button {
				border-left: 1rpx solid #eeeeee;
			}

			&.quick-reply-button--disabled {
				opacity: 0.55;
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
