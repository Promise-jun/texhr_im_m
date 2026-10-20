<template>
	<view class="history-panel">
		<view class="history-header">
			<text class="history-title">{{ talentName }}</text>
			<button class="resume-link" :disabled="opening || !visible" @click="viewResume">查看简历</button>
		</view>
		<scroll-view class="history-scroll" scroll-y :scroll-into-view="scrollTarget"
			@wheel.native="stopInitialAutoScroll" @touchstart="stopInitialAutoScroll">
			<view class="history-content">
				<view v-if="loading" class="history-state">正在加载聊天记录...</view>
				<button v-else-if="loadError" class="history-state history-error" @click="loadMessages">
					{{ loadError }}，点击重试
				</button>
				<view v-else-if="loaded && !messages.length" class="history-state">暂无聊天记录</view>
				<view v-for="message in displayMessages" :key="message.id" class="history-message">
					<view v-if="message.time" class="time-divider">{{ message.time }}</view>
					<view v-if="message.type === 'system'" class="system-message">{{ message.content }}</view>
					<view v-else-if="message.type === 'person-card'" class="person-card" @click="viewResume">
						<text class="person-name">{{ message.person.name }}</text>
						<view v-if="message.person.meta.length" class="person-meta">
							<text v-for="(item, index) in message.person.meta" :key="index" class="person-meta-item">{{ item }}</text>
						</view>
						<view class="person-intention">
							<view v-if="message.person.jobName" class="intention-item">
								<image src="/static/pc/icon_job.png" class="intention-icon" mode="aspectFit"></image>
								<text>{{ message.person.jobName }}</text>
							</view>
							<view v-if="message.person.location" class="intention-item">
								<image src="/static/pc/icon_location.png" class="intention-icon" mode="aspectFit"></image>
								<text>{{ message.person.location }}</text>
							</view>
						</view>
					</view>
					<view v-else class="message-row" :class="message.direction">
						<image :src="messageAvatar(message)" class="message-avatar" mode="aspectFill"
							@error="handleAvatarError(message.avatar)"></image>
						<view v-if="message.type === 'image'" class="image-bubble" @click="previewImage(message.url)">
							<image :src="message.url" class="message-image" mode="widthFix" @load="scrollToBottom"></image>
						</view>
						<button v-else-if="message.type === 'audio'" class="message-bubble audio-bubble"
							:style="{ width: message.audioWidth }" :disabled="opening || !visible"
							:aria-label="audioLabel(message)" :title="audioLabel(message)"
							:aria-pressed="audioActiveId === message.id ? 'true' : 'false'" @click="playAudio(message)">
							<text class="audio-icon">{{ audioActiveId === message.id ? audioState === 'loading' ? '◌' : '❚❚' : '▶' }}</text>
							<view class="audio-wave" :class="{ 'audio-wave--playing': audioActiveId === message.id && audioState === 'playing' }"
								aria-hidden="true"><view v-for="bar in 5" :key="bar" class="audio-bar"></view></view>
							<text>{{ message.durationSeconds ? message.durationSeconds + '″' : '--″' }}</text>
						</button>
						<!-- 兼容历史库中的 Enterprise 职位卡片，保留真实职位、地点和薪资。 -->
						<view v-else-if="message.type === 'job-card'" class="message-bubble job-card">
							<text class="job-name">{{ message.job.JobName || '职位信息' }}</text>
							<text v-if="message.job.Salary" class="job-salary">{{ message.job.Salary }}</text>
							<text v-if="message.job.Location" class="job-location">{{ message.job.Location }}</text>
						</view>
						<view v-else class="message-bubble text-bubble">
							<block v-for="(segment, index) in message.segments" :key="index">
								<image v-if="segment.type === 'emoji'" :src="segment.url" :aria-label="segment.key"
									class="message-emoji" mode="aspectFit"></image>
								<text v-else>{{ segment.content }}</text>
							</block>
						</view>
					</view>
				</view>
				<view id="pc-history-message-bottom" class="message-bottom"></view>
			</view>
		</scroll-view>
		<!-- 按钮区域独立于消息滚动区，固定在面板底部，长聊天记录也不会将按钮挤出视口。 -->
		<view class="history-footer">
			<button class="continue-button" :loading="continuing" :disabled="!canContinue" @click="continueChat">继续聊聊</button>
		</view>
	</view>
</template>

<script>
	import { getHistoryChatMessages } from '../../services/chat-history'
	import { createPcAudioPlayer, audioBubbleWidth, getAudioMimeType } from '../../services/pc-chat-audio'

	const DEFAULT_AVATAR = '/static/default_avatar.png'

	export default {
		name: 'PcChatHistoryPanel',
		props: {
			detail: { type: Object, required: true },
			visible: { type: Boolean, default: true },
			opening: { type: Boolean, default: false },
			continuing: { type: Boolean, default: false }
		},
		data() {
			return {
				messages: [], loading: true, loaded: false, loadError: '', scrollTarget: '',
				failedAvatars: {}, audioActiveId: '', audioState: 'idle', audioDurations: {}
			}
		},
		computed: {
			talentName() {
				return (this.detail.conversation && this.detail.conversation.name)
					|| (this.messages.find(message => message.direction === 'other' && message.name) || {}).name || '人才'
			},
			canContinue() { return this.visible && !this.opening && !this.continuing && this.loaded && !this.loading && !this.loadError },
			displayMessages() {
				return this.messages.map(message => {
					const seconds = this.audioDurations[message.id] || message.durationSeconds || 0
					return { ...message, durationSeconds: seconds, audioWidth: audioBubbleWidth(seconds) }
				})
			}
		},
		watch: {
			visible(value) { if (!value) this.destroyAudioPlayer() },
			opening(value) { if (value) this.destroyAudioPlayer() }
		},
		mounted() {
			this._alive = true
			this._keepAtBottom = true
			this._loadRequestId = 0
			if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.handleVisibilityChange)
			this.loadMessages()
		},
		beforeDestroy() {
			// 会话切换由父页 key 重建组件，旧请求即便随后成功也不能覆盖新会话。
			this._alive = false
			this._loadRequestId += 1
			this.destroyAudioPlayer()
			if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.handleVisibilityChange)
		},
		methods: {
			async loadMessages() {
				if (!this._alive || this._loadPromise || this.loaded) return this._loadPromise
				this.loading = true
				this.loadError = ''
				const requestId = ++this._loadRequestId
				const isCurrent = () => this._alive && requestId === this._loadRequestId
				// 文档 2266 已在父页成功取得 JobId/ResumeId 后才创建组件；文档 2247 一次读取全部 Rows。
				// fromAccid 必须是当前企业账号，toAccid 是人才账号，保证 IsMySend 对应 PC 的左右气泡。
				this._loadPromise = getHistoryChatMessages(this.detail.enterpriseAccId, this.detail.personAccId, 'enterprise')
					.then(messages => {
						if (!isCurrent()) return
						this.messages = messages
						this.loaded = true
					})
					.catch(error => {
						if (isCurrent()) this.loadError = error && error.message || '聊天记录加载失败'
					})
					.finally(() => {
						if (!isCurrent()) return
						this.loading = false
						this._loadPromise = null
						if (this.loaded) this.scrollToBottom()
					})
				return this._loadPromise
			},
			scrollToBottom() {
				if (!this._alive || !this._keepAtBottom || this.loading || !this.messages.length) return
				this.scrollTarget = ''
				this.$nextTick(() => {
					if (this._alive && this._keepAtBottom) this.scrollTarget = 'pc-history-message-bottom'
				})
			},
			stopInitialAutoScroll() {
				// 用户开始翻阅后，不再因异步图片加载把阅读位置拉回末尾。
				this._keepAtBottom = false
			},
			messageAvatar(message) {
				return !message.avatar || this.failedAvatars[message.avatar] ? DEFAULT_AVATAR : message.avatar
			},
			handleAvatarError(avatar) { this.$set(this.failedAvatars, avatar, true) },
			viewResume() {
				if (!this.visible || this.opening) return
				this.$emit('action', { key: 'resume', label: '查看简历', resumeId: this.detail.resumeId })
			},
			previewImage(url) {
				if (!this.visible || this.opening) return
				uni.previewImage({ current: url, urls: this.messages.filter(message => message.type === 'image').map(message => message.url) })
			},
			audioLabel(message) {
				return `${this.audioActiveId === message.id ? this.audioState === 'loading' ? '正在加载' : '暂停' : '播放'}语音${message.durationSeconds ? '，' + message.durationSeconds + '秒' : ''}`
			},
			playAudio(message) {
				if (!this.visible || this.opening) return
				if (!this._audioPlayer) this._audioPlayer = createPcAudioPlayer({
					onState: (id, state) => { this.audioActiveId = id; this.audioState = state },
					onDuration: (id, seconds) => { if (this._alive) this.$set(this.audioDurations, id, seconds) },
					onError: title => { if (this._alive) uni.showToast({ title, icon: 'none' }) }
				})
				this._audioPlayer.play({ ...message, mimeType: getAudioMimeType(message.attachment || message) })
			},
			destroyAudioPlayer() {
				if (this._audioPlayer) this._audioPlayer.destroy()
				this._audioPlayer = null
			},
			handleVisibilityChange() { if (document.hidden) this.destroyAudioPlayer() },
			continueChat() {
				if (!this.canContinue) return
				this.destroyAudioPlayer()
				// 浏览历史不标记已读或发送招呼语；用户主动继续后交给现有 PC 实时聊天组件处理。
				this.$emit('continue')
			}
		}
	}
</script>

<style lang="scss" scoped>
	.history-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; color: #51565b; background: #fff; }
	.history-header { position: relative; display: flex; align-items: center; justify-content: center; flex-shrink: 0; height: 49px; border-bottom: 1px solid #f0f1f2; }
	.history-title { max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; }
	.resume-link { position: absolute; right: 20px; padding: 0; margin: 0; background: transparent; color: #1672d9; line-height: 30px; font-size: 12px; cursor: pointer; }
	button::after { border: 0; }
	.resume-link[disabled] { background: transparent; color: #aeb5bc; }
	.history-scroll { flex: 1; height: 0; min-height: 0; }
	.history-content { padding: 14px 24px 0; }
	.history-state { display: block; width: 100%; padding: 25px 0; margin: 0; background: transparent; text-align: center; color: #a2a7ac; font-size: 13px; line-height: 24px; }
	.history-error { color: #e06a2c; cursor: pointer; }
	.time-divider, .system-message { margin: 18px 0; text-align: center; color: #a6a6a6; font-size: 12px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
	.person-card { padding: 16px 14px; border: 1px solid #f1f1f1; box-shadow: 0 1px 3px rgba(0,0,0,.03); cursor: pointer; }
	.person-name { display: block; color: #1672d9; font-size: 14px; line-height: 24px; }
	.person-meta { display: flex; flex-wrap: wrap; margin-top: 6px; color: #7f858b; font-size: 13px; }
	.person-meta-item + .person-meta-item { margin-left: 10px; padding-left: 10px; border-left: 1px solid #e8e8e8; }
	.person-intention { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px; color: #7f858b; font-size: 13px; }
	.intention-item { display: flex; align-items: center; }
	.intention-icon { width: 15px; height: 15px; margin-right: 5px; }
	.message-row { display: flex; align-items: flex-start; gap: 12px; margin: 14px 0 20px; }
	.message-row.self { flex-direction: row-reverse; }
	.message-avatar { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; }
	.message-bubble { position: relative; box-sizing: border-box; max-width: 66%; padding: 10px 15px; background: #eceff1; color: #555e66; border-radius: 4px; font-size: 14px; line-height: 23px; }
	.text-bubble { white-space: pre-wrap; overflow-wrap: anywhere; }
	.message-bubble::before { position: absolute; top: 16px; left: -6px; width: 12px; height: 12px; background: inherit; content: ''; transform: rotate(45deg); }
	.self .message-bubble { color: #fff; background: #f37324; }
	.self .message-bubble::before { left: auto; right: -6px; }
	.message-emoji { display: inline-block; width: 24px; height: 24px; vertical-align: middle; }
	.image-bubble { max-width: 66%; cursor: zoom-in; }
	.message-image { display: block; width: 230px; max-width: 100%; border-radius: 4px; }
	.audio-bubble { display: flex; align-items: center; justify-content: space-between; min-height: 44px; margin: 0; text-align: left; cursor: pointer; }
	.audio-icon { flex-shrink: 0; font-size: 13px; }
	.audio-wave { display: flex; align-items: center; gap: 3px; height: 22px; margin: 0 12px; }
	.audio-bar { width: 3px; height: 8px; border-radius: 2px; background: currentColor; }
	.audio-bar:nth-child(2), .audio-bar:nth-child(4) { height: 15px; }
	.audio-bar:nth-child(3) { height: 21px; }
	.audio-wave--playing .audio-bar { animation: history-audio-wave .8s ease-in-out infinite alternate; }
	.audio-wave--playing .audio-bar:nth-child(2n) { animation-delay: .2s; }
	@keyframes history-audio-wave { from { transform: scaleY(.45); } to { transform: scaleY(1); } }
	.job-card { min-width: 190px; }
	.job-name, .job-location { display: block; }
	.job-name { font-weight: 600; }
	.job-salary { display: block; margin-top: 5px; }
	.job-location { margin-top: 5px; font-size: 12px; }
	.message-bottom { height: 1px; }
	.history-footer { display: flex; align-items: center; justify-content: center; flex-shrink: 0; height: 158px; border-top: 1px solid #f0f1f2; }
	.continue-button { padding: 0 22px; margin: 0; border-radius: 0; background: #f37324; color: #fff; font-size: 18px; font-weight: 600; line-height: 48px; cursor: pointer; }
	.continue-button[disabled] { background: #f6c09f; color: #fff; cursor: default; }
</style>
