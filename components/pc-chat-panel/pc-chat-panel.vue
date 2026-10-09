<template>
	<view class="chat-panel" @click="closeComposerPanels">
		<view class="chat-panel-header">
			<view class="job-context">
				<text>当前沟通职位：</text>
				<text class="job-name">{{ detail.jobName || '职位沟通' }}</text>
				<text class="action-link" @click="emitAction('switch-job', '切换职位')">切换</text>
			</view>
			<text class="chat-title">{{ otherUser.name || conversation.name }}</text>
			<text class="action-link resume-link" @click="emitAction('resume', '查看简历')">查看简历</text>
		</view>

		<scroll-view class="message-scroll" scroll-y :scroll-into-view="scrollTarget"
			:upper-threshold="60" @scrolltoupper="loadEarlierMessages(false)">
			<view class="message-content">
				<view v-if="messages.length" class="history-state" @click="loadEarlierMessages(false)">
					{{ isLoadingHistory ? '正在加载聊天记录...' : historyExhausted ? '没有更多消息了' : '加载更多消息' }}
				</view>
				<view class="resume-card">
					<text class="resume-name">{{ otherUser.name || conversation.name }}</text>
					<!-- GetSingleChat 只返回简历 ID，不返回年龄、学历等，未接入的资料不展示假数据。 -->
					<view class="resume-meta">
						<text v-if="genderLabel" class="resume-meta-item">{{ genderLabel }}</text>
						<text class="resume-meta-item">人才简历已关联</text>
					</view>
				</view>
				<view v-if="isCheckingAccess || (isLoadingHistory && !messages.length)" class="message-state">
					正在加载聊天记录...
				</view>
				<view v-if="accessError || historyError" class="message-state message-state--error" @click="retryLoad">
					{{ accessError || historyError }}，点击重试
				</view>
				<view v-else-if="!isCheckingAccess && !isLoadingHistory && !messages.length && accessReady"
					class="message-state">暂无聊天记录，发送消息开始沟通吧</view>
				<template v-for="message in displayMessages">
					<view v-if="message.type === 'time' || message.type === 'system'" :key="message.id"
						class="time-divider">{{ message.content }}</view>
					<view v-else :id="message.anchor" :key="message.id" class="message-row" :class="message.direction">
						<image :src="message.direction === 'self' ? selfAvatar : otherAvatar" class="message-avatar"
							mode="aspectFill" @error="handleAvatarError(message.direction)"></image>
						<view v-if="message.type === 'image'" class="message-bubble message-bubble--image"
							@click="previewImage(message.url)">
							<image :src="message.url" class="message-image" mode="widthFix" @load="scrollToBottom"></image>
						</view>
						<button v-else-if="message.type === 'audio'" class="message-bubble message-bubble--audio"
							:class="{ 'audio-active': audioActiveId === message.id }" :style="{ width: message.audioWidth }"
							:aria-label="audioButtonLabel(message)" :title="audioButtonLabel(message)"
							:aria-pressed="audioActiveId === message.id ? 'true' : 'false'" @click="playAudioMessage(message)">
							<view class="audio-indicator" aria-hidden="true">
								<view v-if="audioActiveId === message.id && audioState === 'loading'" class="audio-spinner"></view>
								<text v-else class="audio-play-icon">{{ audioActiveId === message.id ? '❚❚' : '▶' }}</text>
							</view>
							<view class="audio-waveform" :class="{ 'audio-waveform--playing': audioActiveId === message.id && audioState === 'playing' }"
								aria-hidden="true"><view v-for="bar in 5" :key="bar" class="audio-wave-bar"></view></view>
							<text class="audio-duration">{{ message.durationSeconds ? message.durationSeconds + '"' : '--"' }}</text>
						</button>
						<view v-else class="message-bubble message-bubble--text">
							<view class="message-text">
								<block v-for="(segment, segmentIndex) in message.segments" :key="segmentIndex">
									<image v-if="segment.type === 'emoji'" :src="segment.url" :aria-label="segment.key"
										class="message-emoji" mode="aspectFit"></image>
									<text v-else class="message-text-copy">{{ segment.content }}</text>
								</block>
							</view>
						</view>
					</view>
				</template>
				<view id="pc-message-bottom" class="message-bottom"></view>
			</view>
		</scroll-view>

		<view class="composer">
			<view class="composer-toolbar">
				<text class="composer-tool" @click.stop="toggleEmojiPanel"><text class="tool-icon">☺</text> 表情</text>
				<button class="composer-tool composer-tool--button" :class="{ 'composer-tool--active': phrasesVisible }"
					:aria-expanded="phrasesVisible ? 'true' : 'false'" @click.stop="togglePhrasePanel">
					<text class="tool-icon">◎</text> 常用语
				</button>
				<text class="composer-tool" @click="emitAction('interview', '面试邀请')"><text class="tool-icon">▣</text> 面试邀请</text>
				<!-- <text class="composer-tool" @click="emitAction('mobile', '手机聊天')"><text class="tool-icon">▦</text> 手机聊天</text> -->
				<view class="toolbar-right">
					<text class="composer-tool" @click="emitAction('unsuitable', '不合适')"><text class="tool-icon">⊗</text> 不合适</text>
					<text class="composer-tool" @click="togglePinned"><text class="tool-icon">↥</text> {{ isPinned ? '取消置顶' : '置顶' }}</text>
					<text class="composer-tool tool-more" @click="emitAction('more', '更多')">···</text>
				</view>
			</view>
			<view v-if="phrasesVisible" class="phrase-panel" @click.stop>
				<view class="phrase-panel-header">
					<text>常用语</text>
					<text class="phrase-settings" @click="emitAction('phrase-settings', '常用语设置')">设置</text>
				</view>
				<scroll-view scroll-y class="phrase-list" :aria-busy="isLoadingCommonPhrases ? 'true' : 'false'">
					<view v-if="isLoadingCommonPhrases" class="phrase-status">常用语加载中...</view>
					<button v-else-if="commonPhrasesError" class="phrase-status phrase-status--error"
						@click="loadCommonPhrases">{{ commonPhrasesError }}</button>
					<view v-else-if="!commonPhrases.length" class="phrase-status">暂无常用语</view>
					<block v-else>
						<!-- 只省略展示文字，发送时仍使用接口返回的完整常用语；与普通发送共用锁，防止重复发送。 -->
						<button v-for="phrase in commonPhrases" :key="phrase.key" class="phrase-item" :title="phrase.message"
							:aria-label="'发送常用语：' + phrase.message" :disabled="!canSendText" @click="sendCommonPhrase(phrase)">
							<text class="phrase-message">{{ phrase.message }}</text>
							<text v-if="sendingPhraseKey === phrase.key" class="phrase-sending">发送中...</text>
						</button>
					</block>
				</scroll-view>
			</view>
			<view v-if="emojiVisible" class="emoji-panel" @click.stop>
				<!-- 表情 key 与消息文本保持一致，图片地址复用手机端的网易云信表情资源。 -->
				<view v-for="emoji in emojis" :key="emoji.key" class="emoji-item" :title="emoji.key" @click="appendEmoji(emoji)">
					<image :src="emoji.url" :aria-label="emoji.key" class="emoji-image" mode="aspectFit"></image>
				</view>
			</view>
			<view class="composer-input-row">
				<!-- H5 从输入组件根节点监听原生键盘事件，避免 uni 事件包装丢失 key/ctrlKey。 -->
				<!-- #ifdef H5 -->
				<textarea ref="composerInput" v-model="draft" class="composer-input" maxlength="2000" placeholder="输入消息"
					:disabled="!accessReady || opening" @focus="closeComposerPanels"></textarea>
				<!-- #endif -->
				<!-- #ifndef H5 -->
				<textarea v-model="draft" class="composer-input" :maxlength="2000" placeholder="输入消息"
					:disabled="!accessReady || opening" :show-confirm-bar="false" @focus="closeComposerPanels"></textarea>
				<!-- #endif -->
				<view class="composer-footer">
					<text class="composer-hint">按Enter键发送，按Ctrl+Enter换行</text>
					<button class="send-button" :disabled="!canSend" @click="sendMessage">{{ isSending ? '发送中' : '发送' }}</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import {
		NIM_EVENT, getNimInstance, isNimLoggedIn,
		setActiveConversationId, getActiveConversationId, clearActiveConversationId
	} from '../../services/nim'
	import { markNimConversationRead, formatConversationTime } from '../../services/conversation'
	import { requestApi } from '../../services/request'
	import { getAudioMimeType, audioDurationSeconds, audioBubbleWidth, createPcAudioPlayer } from '../../services/pc-chat-audio'
	import { NIM_EMOJIS, parseNimEmojiText } from '../../services/nim-emoji'

	const DEFAULT_AVATAR = '/static/default_avatar.png'
	const HISTORY_PAGE_SIZE = 50
	const COMMON_LANGUAGE_GET_API = 'Chat.CommonLanguage.Get'
	const MESSAGE_LABELS = { 2: '[语音]', 3: '[视频]', 4: '[位置]', 6: '[文件]', 100: '[自定义消息]' }

	function messageId(message) {
		return String(message.messageClientId || message.messageServerId ||
			[message.senderId, message.createTime, message.messageType, message.text].join('-'))
	}

	function responseData(response) {
		if (!response || Number(response.Code) !== 0) throw new Error('获取沟通状态失败')
		const data = typeof response.Data === 'string' ? JSON.parse(response.Data) : response.Data
		if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('沟通状态格式不正确')
		if (data.Code !== undefined && Number(data.Code) !== 0) throw new Error('获取沟通状态失败')
		return data
	}

	export default {
		name: 'PcChatPanel',
		props: {
			conversation: { type: Object, required: true },
			jobId: { type: String, required: true },
			resumeId: { type: String, required: true },
			personAccId: { type: String, required: true },
			enterpriseAccId: { type: String, required: true },
			detail: { type: Object, required: true },
			drafts: { type: Object, required: true },
			visible: { type: Boolean, default: true },
			opening: { type: Boolean, default: false }
		},
		data() {
			return {
				messages: [], accessReady: false, isCheckingAccess: false, accessError: '',
				isLoadingHistory: false, historyExhausted: false, historyError: '', scrollTarget: '',
				isSending: false, isComposing: false, selfUser: {}, otherUser: {}, failedAvatars: {},
				audioActiveId: '', audioState: 'idle', audioDurations: {},
				isPinning: false, isPinned: this.detail.isPinned || this.conversation.stickTop, emojiVisible: false,
				phrasesVisible: false, commonPhrases: [], commonPhrasesLoaded: false,
				isLoadingCommonPhrases: false, commonPhrasesError: '', sendingPhraseKey: '',
				// 与手机端共用网易云信官方表情数据，发送时写入 [表情名] key。
				emojis: NIM_EMOJIS
			}
		},
		computed: {
			conversationId() { return this.detail.conversationId },
			draft: {
				get() { return this.drafts[this.conversationId] || '' },
				set(value) { this.$set(this.drafts, this.conversationId, value) }
			},
			canSendText() { return this.visible && this.accessReady && !this.opening && !this.isSending },
			canSend() { return this.canSendText && Boolean(this.draft.trim()) },
			selfAvatar() { return this.profileAvatar(this.selfUser.avatar) },
			otherAvatar() { return this.profileAvatar(this.otherUser.avatar || this.conversation.avatar) },
			genderLabel() { return { 1: '男', 2: '女' }[this.otherUser.gender] || '' },
			displayMessages() {
				const rows = []
				let previousTime = 0
				this.messages.forEach(message => {
					const id = messageId(message)
					const timestamp = Number(message.createTime) || 0
					// 首条消息及间隔超过五分钟的消息显示时间，气泡保持正序。
					if (timestamp && (!previousTime || timestamp - previousTime >= 5 * 60 * 1000)) {
						rows.push({ id: `time-${id}`, type: 'time', content: formatConversationTime(timestamp) })
					}
					previousTime = timestamp
					const type = Number(message.messageType)
					const attachment = message.attachment || {}
					const revoked = Boolean(message.isRevoked)
					const durationSeconds = this.audioDurations[id] || audioDurationSeconds(attachment.duration)
					const content = revoked ? '消息已撤回' : type === 0 || type === 10 ? message.text || '[消息]'
						: type === 6 && attachment.name ? `[文件] ${attachment.name}` : MESSAGE_LABELS[type] || '[暂不支持的消息]'
					rows.push({
						id, anchor: this.messageAnchor(id),
						direction: message.isSelf || message.senderId === this.enterpriseAccId ? 'self' : 'other',
						type: revoked || type === 10 ? 'system' : type === 2 ? 'audio' : type === 1 && attachment.url ? 'image' : 'text',
						url: attachment.url || '',
						durationSeconds, audioWidth: audioBubbleWidth(durationSeconds), mimeType: getAudioMimeType(attachment),
						content,
						// 文本和兼容性提示都走同一解析器，未知 [xxx] 会原样显示。
						segments: parseNimEmojiText(content)
					})
				})
				return rows
			}
		},
		watch: {
			visible(value) {
				if (!this._alive) return
				if (!value) this.releaseCurrentConversation()
				else if (this.accessReady) {
					this.activateConversation()
					this.loadEarlierMessages(true)
				}
			},
			'conversation.stickTop'(value) { this.isPinned = Boolean(value) }
		},
		mounted() {
			this._alive = true
			this.bindInputEvents()
			// 浏览器切到后台时也停止语音，避免用户已离开页面却继续播放。
			// #ifdef H5
			this._audioVisibilityHandler = () => { if (document.hidden) this.stopAudio() }
			document.addEventListener('visibilitychange', this._audioVisibilityHandler)
			// 浮层和工具按钮阻止点击冒泡，点击页面其它区域或按 Escape 时关闭。
			this._composerDismissHandler = event => {
				if (event.type === 'click' || event.key === 'Escape') this.closeComposerPanels()
			}
			document.addEventListener('click', this._composerDismissHandler)
			document.addEventListener('keydown', this._composerDismissHandler)
			// #endif
			// 父组件按会话 ID 创建独立实例，旧实例卸载后异步结果不会写进新会话。
			uni.$on(NIM_EVENT.MESSAGE_RECEIVED, this.handleReceiveMessages)
			uni.$on(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
			this.loadChatAccess()
		},
		beforeDestroy() {
			this._alive = false
			this.unbindInputEvents()
			// #ifdef H5
			document.removeEventListener('visibilitychange', this._audioVisibilityHandler)
			document.removeEventListener('click', this._composerDismissHandler)
			document.removeEventListener('keydown', this._composerDismissHandler)
			// #endif
			uni.$off(NIM_EVENT.MESSAGE_RECEIVED, this.handleReceiveMessages)
			uni.$off(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
			this.releaseCurrentConversation()
		},
		methods: {
			bindInputEvents() {
				// #ifdef H5
				const input = this.$refs.composerInput
				this._inputRoot = input && (input.$el || input)
				if (!this._inputRoot) return
				this._compositionStart = () => { this.isComposing = true }
				this._compositionEnd = () => { this.isComposing = false }
				this._inputRoot.addEventListener('keydown', this.handleInputKeydown, true)
				this._inputRoot.addEventListener('compositionstart', this._compositionStart, true)
				this._inputRoot.addEventListener('compositionend', this._compositionEnd, true)
				// #endif
			},
			unbindInputEvents() {
				// #ifdef H5
				if (!this._inputRoot) return
				this._inputRoot.removeEventListener('keydown', this.handleInputKeydown, true)
				this._inputRoot.removeEventListener('compositionstart', this._compositionStart, true)
				this._inputRoot.removeEventListener('compositionend', this._compositionEnd, true)
				this._inputRoot = null
				// #endif
			},
			async loadChatAccess() {
				if (this.isCheckingAccess || !this._alive) return
				this.isCheckingAccess = true
				this.accessError = ''
				try {
					// 使用 GetSingleChat 返回的职位、简历 ID 校验当前沟通权限。
					const response = await requestApi({
						Name: 'Chat.MyChat.Limits', Content: { JobId: this.jobId, ResumeId: this.resumeId }
					})
					const data = responseData(response)
					if (!this._alive) return
					// 与现有聊天页一致，兼容权限提示位于 Data 或响应根节点的返回结构。
					const successStep = data.SuccessStep || response.SuccessStep
					if (successStep) {
						// 服务端返回后续操作提示时弹窗提醒，不再初始化消息或清除会话未读数。
						this.accessReady = false
						uni.showModal({
							content: String(successStep.Tips || ''),
							confirmText: String(successStep.StepName || '确定'),
							showCancel: false
						})
						return
					}
					if ((data.PersonAccId && String(data.PersonAccId).trim() !== this.personAccId)
						|| (data.EnterpriseAccId && String(data.EnterpriseAccId).trim() !== this.enterpriseAccId)) {
						throw new Error('沟通账号与当前会话不一致')
					}
					this.accessReady = true
					// 进入会话且通过沟通权限校验后获取常用语，不阻塞历史消息和用户资料加载。
					this.loadCommonPhrases()
					this.prepareConversation()
				} catch (error) {
					if (this._alive) this.accessError = error.message || '聊天加载失败'
				} finally {
					if (this._alive) this.isCheckingAccess = false
				}
			},
			prepareConversation() {
				if (!isNimLoggedIn()) {
					this.historyError = '聊天服务尚未就绪'
					return
				}
				this.activateConversation()
				this.loadUserProfiles()
				this.loadEarlierMessages(true)
			},
			handleLoginStatus(status) {
				if (status === 1 && this.accessReady) this.prepareConversation()
				else if (status !== 1) this.releaseCurrentConversation()
			},
			activateConversation() {
				if (!this.visible || !this.accessReady || !isNimLoggedIn()) return
				setActiveConversationId(this.conversationId)
				getNimInstance().V2NIMLocalConversationService.setCurrentConversation(this.conversationId)
				this.markRead()
			},
			releaseCurrentConversation() {
				this.stopAudio()
				this.closeComposerPanels()
				// 仅释放本实例拥有的前台会话，避免旧组件销毁时取消新组件的已读状态。
				if (getActiveConversationId() !== this.conversationId) return
				getNimInstance().V2NIMLocalConversationService.setCurrentConversation()
				clearActiveConversationId(this.conversationId)
			},
			async markRead() {
				if (!this.visible || !this.accessReady || !this._alive || !isNimLoggedIn()) return
				try {
					await markNimConversationRead(this.conversationId)
					if (this._alive && this.visible) this.$emit('read', this.conversationId)
				} catch (error) {
					console.warn('[PC Chat] 清除未读数失败', error)
				}
			},
			async loadUserProfiles() {
				try {
					// 与历史消息独立获取双方云端资料，头像失败不会阻塞聊天。
					const users = await getNimInstance().V2NIMUserService.getUserListFromCloud([
						this.enterpriseAccId, this.personAccId
					])
					if (!this._alive) return
					this.selfUser = users.find(user => user.accountId === this.enterpriseAccId) || {}
					this.otherUser = users.find(user => user.accountId === this.personAccId) || {}
				} catch (error) {
					console.warn('[PC Chat] 获取云信用户资料失败', error)
				}
			},
			profileAvatar(url) { return !url || this.failedAvatars[url] ? DEFAULT_AVATAR : url },
			handleAvatarError(direction) {
				const url = direction === 'self' ? this.selfAvatar : this.otherAvatar
				if (url !== DEFAULT_AVATAR) this.$set(this.failedAvatars, url, true)
			},
			mergeMessages(list) {
				const map = new Map(this.messages.map(message => [messageId(message), message]))
				list.forEach(message => {
					if (!message || message.conversationId !== this.conversationId) return
					if (message.isDelete) map.delete(messageId(message))
					else map.set(messageId(message), message)
				})
				// 历史、实时和发送回执可能包含相同消息，按 SDK 消息 ID 去重后再排序。
				this.messages = Array.from(map.values()).sort((a, b) =>
					(Number(a.createTime) || 0) - (Number(b.createTime) || 0) || messageId(a).localeCompare(messageId(b)))
				// 正在播放的语音被撤回、删除或替换后立即停止。
				if (this.audioActiveId) {
					const active = this.messages.find(message => messageId(message) === this.audioActiveId)
					if (!active || active.isRevoked || Number(active.messageType) !== 2
						|| (active.attachment || {}).url !== this._audioSource) this.stopAudio()
				}
			},
			async loadEarlierMessages(initial = false) {
				if (!this._alive || !this.accessReady || !isNimLoggedIn() || this.isLoadingHistory
					|| (!initial && this.historyExhausted)) return
				this.isLoadingHistory = true
				this.historyError = ''
				// 分页锚点独立于消息数组：实时/发送消息不会改变下一页历史的起点。
				const anchor = initial ? undefined : this._oldestHistoryMessage
				const hadHistory = Boolean(this._oldestHistoryMessage)
				try {
					const list = await getNimInstance().V2NIMMessageService.getMessageList({
						conversationId: this.conversationId, limit: HISTORY_PAGE_SIZE,
						anchorMessage: anchor, direction: 0
					})
					if (!this._alive) return
					if (!Array.isArray(list)) throw new Error('聊天记录格式不正确')
					this.mergeMessages(list)
					if (!initial || !hadHistory) {
						const sorted = list.slice().sort((a, b) => Number(a.createTime) - Number(b.createTime))
						this._oldestHistoryMessage = sorted[0] || anchor
						this.historyExhausted = list.length < HISTORY_PAGE_SIZE
					}
					if (initial) this.scrollToBottom()
					else if (anchor) this.scrollToAnchor(this.messageAnchor(messageId(anchor)))
				} catch (error) {
					if (this._alive) this.historyError = error.message || '聊天记录加载失败'
				} finally {
					if (this._alive) this.isLoadingHistory = false
				}
			},
			retryLoad() {
				if (!this.accessReady) this.loadChatAccess()
				else this.prepareConversation()
			},
			handleReceiveMessages(list) {
				if (!this._alive || !this.accessReady || !Array.isArray(list)) return
				const current = list.filter(message => message && message.conversationId === this.conversationId)
				if (!current.length) return
				this.mergeMessages(current)
				// 隐藏期间可以缓存消息，但不能标已读；返回页面后再统一清除未读。
				if (this.visible) { this.markRead(); this.scrollToBottom() }
			},
			messageAnchor(id) { return `pc-msg-${encodeURIComponent(id).replace(/%/g, '_')}` },
			scrollToAnchor(id) {
				this.scrollTarget = ''
				this.$nextTick(() => { if (this._alive) this.scrollTarget = id })
			},
			scrollToBottom() { this.scrollToAnchor('pc-message-bottom') },
			handleInputKeydown(event) {
				if (event.key !== 'Enter' || this.isComposing || event.isComposing || event.keyCode === 229) return
				if (event.ctrlKey || event.shiftKey) {
					// Ctrl+Enter 在浏览器 textarea 中没有默认换行行为，需要在光标位置插入换行。
					if (event.ctrlKey) {
						event.preventDefault()
						const input = event.target
						const start = input.selectionStart
						this.draft = `${this.draft.slice(0, start)}\n${this.draft.slice(input.selectionEnd)}`.slice(0, 2000)
						this.$nextTick(() => input.setSelectionRange(start + 1, start + 1))
					}
					return
				}
				event.preventDefault()
				this.sendMessage()
			},
			appendEmoji(emoji) {
				if (!emoji || !emoji.key) return
				// 按完整 key 插入，不能在字数上限处把 [表情名] 截断，否则两端都无法解析。
				if (this.draft.length + emoji.key.length > 2000) {
					uni.showToast({ title: '输入内容不能超过2000字', icon: 'none' })
					return
				}
				this.draft += emoji.key
				this.emojiVisible = false
			},
			closeComposerPanels() {
				this.emojiVisible = false
				this.phrasesVisible = false
			},
			toggleEmojiPanel() {
				this.emojiVisible = !this.emojiVisible
				this.phrasesVisible = false
			},
			togglePhrasePanel() {
				this.phrasesVisible = !this.phrasesVisible
				this.emojiVisible = false
				// 成功返回空列表也视为已加载，避免每次打开都重复请求；失败则允许重新获取。
				if (this.phrasesVisible && !this.commonPhrasesLoaded) this.loadCommonPhrases()
			},
			async loadCommonPhrases() {
				if (!this._alive || this.isLoadingCommonPhrases) return
				this.isLoadingCommonPhrases = true
				this.commonPhrasesError = ''
				try {
					const response = await requestApi({ Name: COMMON_LANGUAGE_GET_API, Content: '' })
					if (!this._alive) return
					if (!response || Number(response.Code) !== 0) throw new Error('获取常用语失败')
					const data = typeof response.Data === 'string' ? JSON.parse(response.Data) : response.Data
					if (data && data.Code !== undefined && Number(data.Code) !== 0) throw new Error('获取常用语失败')
					if (!data || !Array.isArray(data.Rows)) throw new Error('常用语列表格式不正确')
					// 沿用手机端的 Msg / Id / IsTop 结构：过滤空文本，置顶优先，其余保持接口顺序。
					this.commonPhrases = data.Rows.map((item, index) => {
						const message = item && typeof item.Msg === 'string' ? item.Msg.trim() : ''
						if (!message) return null
						return { id: item.Id ? String(item.Id) : null,
							key: item.Id ? String(item.Id) : `phrase-${index}`, message,
							isTop: Boolean(item.IsTop), originalIndex: index }
					}).filter(Boolean).sort((left, right) =>
						left.isTop !== right.isTop ? (left.isTop ? -1 : 1) : left.originalIndex - right.originalIndex)
					this.commonPhrasesLoaded = true
				} catch (error) {
					if (!this._alive) return
					this.commonPhrases = []
					this.commonPhrasesLoaded = false
					this.commonPhrasesError = '常用语加载失败，点击重试'
					console.warn('[PC Chat] 获取常用语失败', error)
				} finally {
					if (this._alive) this.isLoadingCommonPhrases = false
				}
			},
			async sendCommonPhrase(phrase) {
				if (!this._alive || !this.canSendText || !phrase || !phrase.message) return
				this.sendingPhraseKey = phrase.key
				// 直接发送常用语，不借用或覆盖输入框草稿；失败保留浮层，便于用户重试。
				const sent = await this.sendTextMessage(phrase.message)
				if (!this._alive) return
				this.sendingPhraseKey = ''
				if (sent) this.phrasesVisible = false
			},
			async sendMessage() {
				if (!this.canSend) return
				const draft = this.draft
				return this.sendTextMessage(draft, draft)
			},
			async sendTextMessage(text, draftSnapshot) {
				if (!this._alive || !this.canSendText || typeof text !== 'string' || !text.trim()) return false
				if (!isNimLoggedIn()) { uni.showToast({ title: '聊天服务尚未就绪', icon: 'none' }); return false }
				const conversationId = this.conversationId
				this.isSending = true
				try {
					const nim = getNimInstance()
					const result = await nim.V2NIMMessageService.sendMessage(
						nim.V2NIMMessageCreator.createTextMessage(text.trim()), conversationId)
					if (!result || !result.message) throw new Error('消息发送失败')
					// 即使用户切走了，发送成功也只清除对应会话的原草稿；保留发送期间追加的输入。
					if (draftSnapshot !== undefined && this.drafts[conversationId] === draftSnapshot) {
						this.$set(this.drafts, conversationId, '')
					}
					if (!this._alive) return true
					this.mergeMessages([result.message])
					this.scrollToBottom()
					this.$emit('changed')
					return true
				} catch (error) {
					if (this._alive) uni.showToast({ title: error.message || '消息发送失败，请重试', icon: 'none' })
					return false
				} finally {
					if (this._alive) this.isSending = false
				}
			},
			async togglePinned() {
				if (this.isPinning || !isNimLoggedIn() || this.opening) return
				const value = !this.isPinned
				let saved = false
				this.isPinning = true
				try {
					// 与移动端一致，先保存业务会话置顶状态，再同步云信列表排序。
					const response = await requestApi({ Name: 'Chat.Chat.Save', Content: {
						PersonAccId: this.personAccId, EnterpriseAccId: this.enterpriseAccId, IsTop: value
					} })
					if (!response || Number(response.Code) !== 0) throw new Error('会话置顶失败')
					const data = typeof response.Data === 'string' ? JSON.parse(response.Data) : response.Data
					if (data && data.Code !== undefined && Number(data.Code) !== 0) throw new Error('会话置顶失败')
					saved = true
					await getNimInstance().V2NIMLocalConversationService.stickTopConversation(this.conversationId, value)
					if (!this._alive) return
					this.isPinned = value
					this.$emit('changed')
				} catch (error) {
					if (this._alive) {
						if (saved) this.isPinned = value
						uni.showToast({ title: saved ? '置顶已保存，会话列表同步失败' : '会话置顶失败，请重试', icon: 'none' })
					}
				} finally {
					if (this._alive) this.isPinning = false
				}
			},
			previewImage(url) {
				uni.previewImage({ current: url, urls: this.displayMessages.filter(row => row.type === 'image').map(row => row.url) })
			},
			audioButtonLabel(message) {
				const duration = message.durationSeconds ? `，${message.durationSeconds}秒` : ''
				if (this.audioActiveId === message.id) return this.audioState === 'loading' ? '正在加载，点击取消' : '停止播放语音'
				return `播放语音${duration}`
			},
			playAudioMessage(message) {
				if (!this._alive || !this.visible || this.opening) return
				if (!this._audioController) {
					this._audioController = createPcAudioPlayer({
						onState: (id, state) => { this.audioActiveId = id; this.audioState = state },
						onDuration: (id, seconds) => { if (this._alive) this.$set(this.audioDurations, id, seconds) },
						onError: title => { if (this._alive && this.visible) uni.showToast({ title, icon: 'none' }) }
					})
				}
				this._audioSource = message.url
				this._audioController.play(message)
			},
			stopAudio() {
				if (this._audioController) this._audioController.destroy()
				this._audioController = null
				this._audioSource = ''
			},
			emitAction(key, label) {
				// 所有业务操作统一携带当前职位与简历，后续接入页面时无需重新猜测对应关系。
				this.$emit('action', { key, label, jobId: this.jobId, resumeId: this.resumeId,
					personAccId: this.personAccId, enterpriseAccId: this.enterpriseAccId, chatByQRcode: this.detail.chatByQRcode })
			}
		}
	}
</script>

<style lang="scss" scoped>
	.chat-panel { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
	.chat-panel-header { position: relative; display: flex; align-items: center; flex: 0 0 49px; box-sizing: border-box;
		padding: 0 18px; border-bottom: 1px solid #eceff1; }
	.job-context { display: flex; align-items: center; max-width: 46%; font-size: 12px; color: #929ba4; }
	.job-name { max-width: 155px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.action-link { flex-shrink: 0; margin-left: 8px; font-size: 12px; color: #0866d9; cursor: pointer; }
	.chat-title { position: absolute; left: 56%; max-width: 25%; overflow: hidden; text-overflow: ellipsis;
		white-space: nowrap; font-size: 16px; color: #666; transform: translateX(-50%); }
	.resume-link { margin-left: auto; }
	.message-scroll { flex: 1; height: 0; min-height: 0; }
	.message-content { box-sizing: border-box; padding: 20px 24px 0; }
	.resume-card { box-sizing: border-box; min-height: 102px; padding: 16px 14px; margin: 12px 0 22px;
		border: 1px solid #f1f2f3; box-shadow: 0 1px 2px rgba(0, 0, 0, .05); }
	.resume-name { display: block; font-size: 16px; line-height: 24px; color: #2682e6; }
	.resume-meta { display: flex; align-items: center; margin-top: 8px; font-size: 13px; color: #8c949c;
		.resume-meta-item + .resume-meta-item { margin-left: 12px; padding-left: 12px; border-left: 1px solid #e5e8eb; } }
	.history-state, .message-state, .time-divider { text-align: center; font-size: 12px; line-height: 20px; color: #a1a6aa; }
	.history-state { padding-bottom: 4px; cursor: pointer; }
	.message-state { padding: 22px 0; }
	.message-state--error { color: #126bd1; cursor: pointer; }
	.time-divider { margin: 20px 0; }
	.message-row { display: flex; align-items: flex-start; margin-bottom: 16px;
		&.self { flex-direction: row-reverse;
			.message-avatar { margin: 0 0 0 14px; }
			.message-bubble { background: #e8f3ff; }
			.message-bubble::before { left: auto; right: -6px; border-left: 6px solid #e8f3ff; border-right: 0; } } }
	.message-avatar { flex: 0 0 44px; width: 44px; height: 44px; margin-right: 14px; border-radius: 50%; }
	.message-bubble { position: relative; box-sizing: border-box; max-width: 66%; min-height: 42px;
		margin-top: 4px; padding: 11px 16px; border-radius: 4px; font-size: 14px; line-height: 21px;
		color: #65717b; background: #edf0f2; white-space: pre-wrap; overflow-wrap: anywhere;
		&::before { position: absolute; top: 12px; left: -6px; width: 0; height: 0; content: '';
			border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-right: 6px solid #edf0f2; } }
	.message-bubble--image { padding: 5px; cursor: pointer; }
	.message-bubble--text { padding-top: 8px; padding-bottom: 8px; }
	// 使用行内文本流，避免 flex 把表情之间的换行限制在某个文本片段内。
	.message-text { max-width: 100%; }
	.message-text-copy { max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
	.message-emoji { display: inline-block; width: 28px; height: 28px; margin: 0 2px; vertical-align: middle; }
	.message-bubble--audio { display: flex; align-items: center; flex: 0 1 auto; height: 44px; min-width: 120px;
		margin-right: 0; margin-left: 0; border: 0; text-align: left; cursor: pointer;
		&::after { border: 0; }
		&:hover { filter: brightness(.97); }
		&:focus-visible { outline: 2px solid #2b6cd4; outline-offset: 3px; }
		&.audio-active { color: #0866d9; } }
	.audio-indicator { display: flex; align-items: center; justify-content: center; flex: 0 0 20px; width: 20px; height: 20px; }
	.audio-play-icon { font-family: Arial, sans-serif; font-size: 14px; line-height: 20px; }
	.audio-spinner { box-sizing: border-box; width: 14px; height: 14px; border: 2px solid #b8c9dc;
		border-top-color: #0866d9; border-radius: 50%; animation: audio-spin .8s linear infinite; }
	.audio-waveform { display: flex; align-items: center; flex: 0 0 25px; height: 20px; margin-left: 8px;
		.audio-wave-bar { width: 3px; height: 8px; margin-right: 2px; border-radius: 1px; background: currentColor; }
		.audio-wave-bar:nth-child(2), .audio-wave-bar:nth-child(4) { height: 14px; }
		.audio-wave-bar:nth-child(3) { height: 20px; }
		&--playing .audio-wave-bar { animation: audio-wave .9s ease-in-out infinite; }
		&--playing .audio-wave-bar:nth-child(2n) { animation-delay: .2s; }
		&--playing .audio-wave-bar:nth-child(3) { animation-delay: .4s; } }
	.audio-duration { flex-shrink: 0; margin-left: auto; padding-left: 8px; font-size: 13px;
		line-height: 20px; font-variant-numeric: tabular-nums; white-space: nowrap; }
	@keyframes audio-spin { to { transform: rotate(360deg); } }
	@keyframes audio-wave { 0%, 100% { transform: scaleY(.45); } 50% { transform: scaleY(1); } }
	@media (prefers-reduced-motion: reduce) { .audio-spinner, .audio-waveform--playing .audio-wave-bar { animation: none; } }
	.message-image { display: block; width: 230px; max-width: 100%; border-radius: 3px; }
	.message-bottom { height: 12px; }
	.composer { position: relative; flex: 0 0 158px; box-sizing: border-box; border-top: 1px solid #eceff1; }
	.composer-toolbar { display: flex; align-items: center; height: 42px; padding: 0 18px; gap: 16px; }
	.composer-tool { display: inline-flex; align-items: center; flex-shrink: 0; color: #9aa3ab; font-size: 13px;
		cursor: pointer; &:hover { color: #0866d9; } }
	.composer-tool--button { width: auto; margin: 0; padding: 0; border: 0; border-radius: 0; line-height: normal;
		background: transparent; &::after { border: 0; } }
	.composer-tool--active { color: #0866d9; }
	.tool-icon { margin-right: 4px; font-family: Arial, sans-serif; font-size: 19px; }
	.toolbar-right { display: flex; align-items: center; gap: 16px; margin-left: auto; }
	.tool-more { font-size: 20px; }
	.composer-input-row { padding: 0 15px 12px 24px; }
	.composer-input { display: block; box-sizing: border-box; width: 100%; height: 60px; min-height: 60px; padding: 0;
		border: 0; outline: 0; resize: none; font-family: inherit; font-size: 14px; line-height: 22px; color: #333;
		background: #fff; &:disabled { background: #fff; } }
	.composer-footer { display: flex; align-items: center; justify-content: flex-end; gap: 24px; margin-top: 8px; }
	.composer-hint { font-size: 12px; color: #c0c5ca; }
	.send-button { display: flex; align-items: center; justify-content: center; width: 70px; height: 34px;
		margin: 0; padding: 0; border: 0; border-radius: 3px; font-size: 13px; line-height: 34px; color: #fff;
		background: #2b6cd4; cursor: pointer; &::after { border: 0; }
		&[disabled] { color: #fff; background: #8fb2e8; cursor: default; } }
	.emoji-panel { position: absolute; bottom: 158px; left: 18px; z-index: 3; display: grid;
		grid-template-columns: repeat(9, minmax(0, 1fr)); box-sizing: border-box;
		width: 374px; max-height: 244px; overflow-x: hidden; overflow-y: auto; padding: 8px;
		border: 1px solid #e5e8eb; border-radius: 4px; background: #fff;
		box-shadow: 0 3px 12px rgba(0, 0, 0, .08); }
	.emoji-item { display: flex; align-items: center; justify-content: center; min-width: 0; height: 38px; cursor: pointer;
		&:hover { border-radius: 3px; background: #f1f6fb; } }
	.emoji-image { width: 28px; height: 28px; }
	.phrase-panel { position: absolute; bottom: 158px; left: 18px; z-index: 3; box-sizing: border-box;
		width: 380px; max-width: calc(100% - 36px); border: 1px solid #e5e8eb; background: #fff;
		box-shadow: 0 2px 14px rgba(0, 0, 0, .09);
		// 箭头对准常用语工具按钮，浮层不占用聊天区或输入区布局。
		&::after { position: absolute; bottom: -6px; left: 94px; width: 10px; height: 10px; content: '';
			border-right: 1px solid #e5e8eb; border-bottom: 1px solid #e5e8eb; background: #fff; transform: rotate(45deg); } }
	.phrase-panel-header { display: flex; align-items: center; justify-content: space-between; box-sizing: border-box;
		height: 46px; padding: 0 20px; border-bottom: 1px solid #f0f2f5; font-size: 14px; color: #9aa3ab; }
	.phrase-settings { font-size: 12px; color: #0866d9; cursor: pointer; }
	.phrase-list { height: 180px; overflow-x: hidden; overflow-y: auto; }
	.phrase-item { display: flex; align-items: center; box-sizing: border-box; width: 100%; height: 45px; margin: 0;
		padding: 0 20px; border: 0; border-bottom: 1px solid #f0f2f5; border-radius: 0; font-size: 13px;
		line-height: 44px; text-align: left; color: #65717b; background: #fff; cursor: pointer;
		&::after { border: 0; } &:hover { background: #f5f8fc; }
		&[disabled] { color: #a4abb4; background: #fff; cursor: default; }
		&:focus-visible { outline: 2px solid #2b6cd4; outline-offset: -2px; } }
	.phrase-message { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.phrase-sending { flex-shrink: 0; margin-left: 12px; font-size: 12px; color: #0866d9; }
	.phrase-status { box-sizing: border-box; width: 100%; margin: 0; padding: 28px 16px; border: 0; border-radius: 0;
		font-size: 13px; line-height: 22px; text-align: center; color: #9aa3ab; background: #fff;
		&::after { border: 0; } }
	.phrase-status--error { color: #0866d9; cursor: pointer; }
</style>
