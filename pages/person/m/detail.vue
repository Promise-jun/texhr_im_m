<template>
	<view class="history-detail-page">
		<!-- 固定导航栏，预留 App 状态栏高度，滚动消息时标题始终可见。 -->
		<view class="fixed-header" :style="{ paddingTop: `${statusBarHeight}px` }">
			<view class="navigation-bar">
				<view class="back-button" aria-label="返回" @click="navigateBack">
					<text class="back-icon"></text>
				</view>
				<text class="navigation-title">聊天详情</text>
			</view>
		</view>

		<!-- 消息区位于固定导航栏和底部按钮之间，避免首尾消息被遮挡。 -->
		<scroll-view class="message-scroll" :style="{ top: scrollTopStyle }" scroll-y
			:scroll-into-view="scrollIntoView" :scroll-with-animation="false"
			@touchstart="stopInitialAutoScroll" @wheel="stopInitialAutoScroll">
			<view class="message-content">
				<view v-if="isLoading || loadError" class="load-status" :class="{ 'is-error': loadError }"
					@click="loadHistoryDetail">
					<text v-if="isLoading">{{ isWaitingForNim ? '正在连接聊天服务...' : '正在加载聊天记录...' }}</text>
					<text v-else>{{ loadError }}，点击重试</text>
				</view>
				<view v-else-if="!messages.length" class="empty-state">暂无聊天记录</view>

				<view v-for="message in messages" :key="message.id" class="history-message">
					<view v-if="message.time" class="time-divider">{{ message.time }}</view>
					<view class="message-row" :class="[message.direction, { 'message-row--job-card': message.type === 'job-card' }]">
						<image v-if="message.type !== 'job-card'" :src="failedAvatarIds.includes(message.id) ? defaultAvatar : message.avatar"
							class="message-avatar" mode="aspectFill" @error="handleAvatarError(message)"></image>
						<view class="message-bubble" :class="{
							'message-bubble--image': message.type === 'image',
							'message-bubble--audio': message.type === 'audio',
							'message-bubble--job-card': message.type === 'job-card'
						}" :style="message.type === 'audio' ? { width: audioBubbleWidth(message) } : null">
							<!-- 历史职位卡片沿用 chat.vue 的字段及失效样式，只展示已发生的聊天记录。 -->
							<view v-if="message.type === 'job-card'" class="job-message-card"
								:style="{ filter: message.job.status ? 'grayscale(0)' : 'grayscale(1)' }">
								<view class="job-message-heading">
									<text class="job-message-name">{{ message.job.JobName || '职位信息' }}</text>
									<text class="job-message-salary">{{ message.job.status ? message.job.Salary : '已失效' }}</text>
								</view>
								<text v-if="message.job.CompanyName" class="job-message-company">{{ message.job.CompanyName }}</text>
								<view v-if="message.job.Location || message.job.Experience || message.job.Education" class="job-message-requirements">
									<view v-if="message.job.Location" class="job-message-requirement">
										<image src="/static/icon_location.png" class="job-message-icon" mode="aspectFit"></image>
										<text>{{ message.job.Location }}</text>
									</view>
									<view v-if="message.job.Experience" class="job-message-requirement">
										<image src="/static/icon_work.png" class="job-message-icon" mode="aspectFit"></image>
										<text>{{ message.job.Experience }}</text>
									</view>
									<view v-if="message.job.Education" class="job-message-requirement">
										<image src="/static/icon_edu.png" class="job-message-icon" mode="aspectFit"></image>
										<text>{{ message.job.Education }}</text>
									</view>
								</view>
								<view v-if="message.job.Logo || message.job.EnterpriseManager || message.job.EnterpriseManagerPost" class="job-message-manager">
									<image :src="failedJobLogoIds.includes(message.id) ? defaultAvatar : (message.job.Logo || defaultAvatar)"
										class="job-message-logo" mode="aspectFit" @error="handleJobLogoError(message)"></image>
									<text v-if="message.job.EnterpriseManager" class="job-message-manager-name">{{ message.job.EnterpriseManager }}</text>
									<text v-if="message.job.EnterpriseManagerPost" class="job-message-manager-post">{{ message.job.EnterpriseManagerPost }}</text>
								</view>
								<view v-if="message.job.EnterpriseTime" class="job-message-tip">{{ message.job.EnterpriseTime }}</view>
							</view>
							<image v-else-if="message.type === 'image'" :src="message.url" class="message-image"
								mode="widthFix" @load="scrollToBottom" @error="scrollToBottom" @click.stop="previewImage(message.url)"></image>
							<view v-else-if="message.type === 'audio'" class="audio-message-content" @click.stop="playAudioMessage(message)">
								<text>{{ audioPlayingId === message.id ? '❚❚' : '▶' }}</text>
								<text>{{ message.durationSeconds ? `${message.durationSeconds}\"` : '语音' }}</text>
							</view>
							<view v-else class="message-text">
								<block v-for="(segment, index) in message.segments" :key="index">
									<image v-if="segment.type === 'emoji'" :src="segment.url" :aria-label="segment.key"
										class="message-emoji" mode="aspectFit"></image>
									<text v-else class="message-text-copy">{{ segment.content }}</text>
								</block>
							</view>
						</view>
					</view>
				</view>
				<!-- 使用末尾锚点定位最新消息，不依赖消息总高度或固定延时。 -->
				<view id="history-message-bottom" class="message-bottom"></view>
			</view>
		</scroll-view>

		<!-- 继续聊聊依次校验职位、确认切换、发送消息，成功后才进入聊天页。 -->
		<view class="fixed-footer">
			<button class="continue-button" :disabled="!canContinueChat || isContinuingChat"
				:loading="isContinuingChat" @click="continueChat">继续聊聊</button>
		</view>

		<!-- 职位失效或招满时，从企业发布中的职位中选择新的沟通职位。 -->
		<uni-popup ref="jobPicker" :key="jobPickerVersion" type="bottom" background-color="#ffffff" border-radius="20rpx 20rpx 0 0"
			@change="handleJobPickerChange">
			<view class="job-picker-sheet">
				<view class="job-picker-heading">
					<text class="job-picker-title">点击选择沟通职位</text>
					<view class="job-picker-close" aria-label="关闭职位选择" @click="closeJobPicker">×</view>
				</view>
				<scroll-view class="job-picker-list" scroll-y>
					<view v-if="isLoadingJobs" class="job-picker-status">正在加载职位...</view>
					<view v-else-if="jobListError" class="job-picker-status job-picker-status--error" @click="loadHistoryJobList">
						{{ jobListError }}，点击重试
					</view>
					<view v-else-if="!jobList.length" class="job-picker-status">暂无可沟通职位</view>
					<view v-else v-for="job in jobList" :key="job.key" class="job-picker-item" @click="selectHistoryChatJob(job)">
						<text>{{ job.JobName }}-{{ job.Location }}-{{ job.Salary }}</text>
					</view>
				</scroll-view>
			</view>
		</uni-popup>
	</view>
</template>

<script>
	import { NIM_EVENT, getNimInstance, getNimLoginError, isNimLoggedIn } from '../../../services/nim'
	import {
		getHistoryChatDetail, getHistoryChatMessages, getHistoryChatJobState,
		getHistoryChatButton, changeHistoryChatJob, getHistoryChatJobList
	} from '../../../services/chat-history'
	import {
		appendExternalReturnUrl,
		getExternalReturnUrl,
		navigateBackWithExternal
	} from '../../../services/navigation'
	import UniPopup from '../../../uni_modules/uni-popup/components/uni-popup/uni-popup.vue'

	const DEFAULT_AVATAR = '/static/default_avatar.png'
	const CONTINUE_CHAT_TEXT = '我正在求职，请问贵公司还招人吗？'

	export default {
		components: { UniPopup },
		data() {
			return {
				enterpriseAccId: '',
				chatDetail: null,
				messages: [],
				scrollIntoView: '',
				statusBarHeight: 0,
				isLoading: true,
				isWaitingForNim: false,
				loadError: '',
				isContinuingChat: false,
				jobState: null,
				isJobPickerVisible: false,
				jobPickerVersion: 0,
				isChoosingJob: false,
				isLoadingJobs: false,
				jobList: [],
				jobListError: '',
				defaultAvatar: DEFAULT_AVATAR,
				failedAvatarIds: [],
				failedJobLogoIds: [],
				audioPlayingId: '',
				externalReturnUrl: ''
			}
		},
		computed: {
			scrollTopStyle() {
				return `calc(${this.statusBarHeight}px + 88rpx)`
			},
			canContinueChat() {
				return !this.isLoading && Boolean(this.chatDetail && this.chatDetail.JobId && this.chatDetail.ResumeId)
			}
		},
		async onLoad(options = {}) {
			// 列表页传入历史会话的对方 Accid，同时兼容手工链接的小写参数。
			this.enterpriseAccId = String(options.Accid || options.accid || '').trim()
			this.externalReturnUrl = getExternalReturnUrl(options)
			this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 0
			this._detailPageAlive = true
			this._keepHistoryAtBottom = true
			uni.$on(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
			uni.$on(NIM_EVENT.LOGIN_FAILED, this.handleLoginFailed)
			await this.loadHistoryDetail()
		},
		onShow() {
			if (this._continueChatOpened) {
				// 从聊天页返回后允许重新发起沟通；跳转失败时则保留已发送进度用于重试。
				this._continueChatOpened = false
				this._pendingContinueChat = null
				this.isContinuingChat = false
			}
		},
		onHide() {
			this.destroyAudioPlayer()
		},
		onUnload() {
			this._detailPageAlive = false
			if (this._continueModalResolve) this._continueModalResolve(false)
			this.closeJobPicker()
			uni.$off(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
			uni.$off(NIM_EVENT.LOGIN_FAILED, this.handleLoginFailed)
			this.destroyAudioPlayer()
		},
		methods: {
			async addJobStatusesBeforeRender(messages) {
				return Promise.all((Array.isArray(messages) ? messages : []).map(async message => {
					if (!message || message.type !== 'job-card' || !message.job) return message
					const jobId = message.job.JobId === undefined || message.job.JobId === null ?
						'' : String(message.job.JobId).trim()
					let status = false
					if (jobId) {
						try {
							const state = await getHistoryChatJobState(jobId)
							// 渲染自定义职位消息前补充状态：仅 State=1 为有效，其余状态均为失效。
							status = state === 1
						} catch (error) {
							console.warn('[ChatHistory] 获取自定义消息职位状态失败', error)
						}
					}
					return { ...message, job: { ...message.job, status } }
				}))
			},
			handleLoginStatus(status) {
				if (Number(status) === 1) this.loadHistoryDetail()
			},
			handleLoginFailed(error) {
				if (!this._detailPageAlive || this._detailLoaded || this._detailLoadPromise) return
				this.isLoading = false
				this.isWaitingForNim = false
				this.loadError = error && (error.message || error.desc) || '聊天服务连接失败'
			},
			async loadHistoryDetail() {
				if (!this._detailPageAlive || this._detailLoaded) return
				if (this._detailLoadPromise) return this._detailLoadPromise
				if (!this.enterpriseAccId) {
					this.isLoading = false
					this.loadError = '未获取到对方会话账号'
					return
				}
				if (!isNimLoggedIn()) {
					const error = getNimLoginError()
					if (error) this.handleLoginFailed(error)
					else {
						this.isLoading = true
						this.isWaitingForNim = true
						this.loadError = ''
					}
					return
				}
				this.isLoading = true
				this.isWaitingForNim = false
				this.loadError = ''
				// 合并点击重试/登录通知的并发触发；成功后当前页面不重复拉取两份接口。
				this._detailLoadPromise = (async () => {
					if (!this.chatDetail) {
						const loginService = getNimInstance().V2NIMLoginService
						const personAccId = loginService && typeof loginService.getLoginUser === 'function'
							? loginService.getLoginUser() : ''
						const detail = await getHistoryChatDetail(personAccId, this.enterpriseAccId)
						if (!this._detailPageAlive) return
						this.chatDetail = detail
					}
					// 必须等 GetSingleChat 成功，再使用实际返回的双方账号读取全部历史记录。
					const historyMessages = await getHistoryChatMessages(this.chatDetail.PersonAccId, this.chatDetail.EnterpriseAccId)
					const messages = await this.addJobStatusesBeforeRender(historyMessages)
					if (!this._detailPageAlive) return
					this.messages = messages
					this._detailLoaded = true
				})()
					.catch(error => {
						if (!this._detailPageAlive) return
						this.loadError = error && error.message || '聊天记录加载失败'
						console.error('[ChatHistory] 加载聊天详情失败', error)
					})
					.finally(() => {
						if (this._detailPageAlive) {
							this.isLoading = false
							if (this._detailLoaded) this.scrollToBottom()
						}
						this._detailLoadPromise = null
					})
				return this._detailLoadPromise
			},
			scrollToBottom() {
				if (!this._detailPageAlive || !this._keepHistoryAtBottom || this.isLoading || !this.messages.length) return
				// 等消息及加载提示完成渲染后滚动；图片后续撑高内容时重新定位同一锚点。
				this.scrollIntoView = ''
				this.$nextTick(() => {
					if (this._detailPageAlive && this._keepHistoryAtBottom) this.scrollIntoView = 'history-message-bottom'
				})
			},
			stopInitialAutoScroll() {
				// 用户开始查看更早消息后，异步图片加载不再把阅读位置拉回底部。
				this._keepHistoryAtBottom = false
			},
			async continueChat() {
				if (!this._detailPageAlive || !this.canContinueChat || this.isContinuingChat) return
				this.destroyAudioPlayer()
				// 锁覆盖状态查询、弹窗、职位切换、发送和跳转整个流程。
				this.isContinuingChat = true
				this.jobState = null
				try {
					const { JobId, ResumeId, PersonAccId, EnterpriseAccId } = this.chatDetail
					const state = await getHistoryChatJobState(JobId)
					if (!this._detailPageAlive) return
					this.jobState = state
					let targetJobId = JobId
					let targetAccId = EnterpriseAccId
					let shouldSwitch = false
					if (state !== 1) {
						// 失效/招满不调用按钮接口，等待底部弹窗选择发布中的职位。
						const selected = await this.chooseHistoryChatJob()
						if (!selected || !this._detailPageAlive) return
						targetJobId = selected.JobId
						shouldSwitch = true
					} else {
						// 正常职位才调用文档 2259，比较的是当前页职位与接口的聊天职位。
						const button = await getHistoryChatButton(JobId, ResumeId)
						if (!this._detailPageAlive) return
						targetAccId = EnterpriseAccId
						shouldSwitch = button.JobId !== JobId
					}
					let pending = this._pendingContinueChat
					if (!pending || pending.jobId !== targetJobId || pending.resumeId !== ResumeId ||
						pending.personAccId !== PersonAccId || pending.enterpriseAccId !== targetAccId) {
						pending = { jobId: targetJobId, resumeId: ResumeId, personAccId: PersonAccId,
							enterpriseAccId: targetAccId, enterprise: null, customSent: false, textSent: false }
						this._pendingContinueChat = pending
					}
					if (shouldSwitch && !pending.enterprise) {
						// 在职位列表中的点击已表示选定目标，仅正常职位不一致时需要二次确认。
						if (state === 1) {
							const confirmed = await this.confirmContinueJobSwitch()
							if (!confirmed || !this._detailPageAlive) return
						}
						// 先检查云信是否就绪，避免职位已经切换却无法发送变更消息。
						this.getContinueMessageContext(targetAccId)
						const enterprise = await changeHistoryChatJob(PersonAccId, targetAccId, targetJobId)
						if (!this._detailPageAlive) return
						pending.enterprise = enterprise
					}
					await this.sendContinueChatMessages(pending)
					if (!this._detailPageAlive) return
					await this.openContinuedChat(pending)
				} catch (error) {
					if (!this._detailPageAlive) return
					uni.showToast({ title: error && error.message || '继续聊天失败，请重试', icon: 'none' })
					console.error('[ChatHistory] 继续聊天失败', error)
				} finally {
					if (this._detailPageAlive && !this._continueChatOpened) this.isContinuingChat = false
				}
			},
			chooseHistoryChatJob() {
				return new Promise(resolve => {
					this._jobPickerResolve = resolve
					this.isChoosingJob = true
					this.isJobPickerVisible = true
					// 重建弹窗以避开关闭动画的 300ms 延时，快速重新点击也能正常打开。
					this.jobPickerVersion++
					this.$nextTick(() => {
						if (!this._detailPageAlive || this._jobPickerResolve !== resolve) return
						this.$refs.jobPicker.open('bottom')
						this.loadHistoryJobList()
					})
				})
			},
			async loadHistoryJobList() {
				if (!this._detailPageAlive || !this.isJobPickerVisible || this.isLoadingJobs) return
				const requestId = this._jobListRequestId = (this._jobListRequestId || 0) + 1
				this.isLoadingJobs = true
				this.jobList = []
				this.jobListError = ''
				try {
					const jobs = await getHistoryChatJobList(this.chatDetail.EnterpriseAccId)
					if (this._detailPageAlive && this.isJobPickerVisible && requestId === this._jobListRequestId) this.jobList = jobs
				} catch (error) {
					if (this._detailPageAlive && this.isJobPickerVisible && requestId === this._jobListRequestId) {
						this.jobListError = error && error.message || '职位列表加载失败'
					}
				} finally {
					if (this._detailPageAlive && requestId === this._jobListRequestId) this.isLoadingJobs = false
				}
			},
			handleJobPickerChange(event) {
				this.isJobPickerVisible = Boolean(event && event.show)
				if (this.isJobPickerVisible) return
				// 关闭或卸载时取消等待，并使迟到的职位列表响应失效。
				this._jobListRequestId = (this._jobListRequestId || 0) + 1
				this.isLoadingJobs = false
				this.isChoosingJob = false
				const resolve = this._jobPickerResolve
				this._jobPickerResolve = null
				if (resolve) resolve(null)
			},
			closeJobPicker() {
				this.handleJobPickerChange({ show: false })
				if (this.$refs && this.$refs.jobPicker) this.$refs.jobPicker.close()
			},
			selectHistoryChatJob(job) {
				if (!this._detailPageAlive || !this.isChoosingJob || this.isLoadingJobs || !job || !job.JobId) return
				const resolve = this._jobPickerResolve
				this._jobPickerResolve = null
				// 先解除选择回调再关闭弹窗，防止 change(false) 将已选职位当作取消。
				this.closeJobPicker()
				if (resolve) resolve(job)
			},
			confirmContinueJobSwitch() {
				return new Promise((resolve, reject) => {
					this._continueModalResolve = resolve
					uni.showModal({
						title: '提示', content: '是否切换聊天职位', confirmText: '立即切换',
						success: result => resolve(Boolean(result && result.confirm)),
						fail: () => reject(new Error('打开职位切换提示失败')),
						complete: () => { this._continueModalResolve = null }
					})
				})
			},
			getContinueMessageContext(enterpriseAccId) {
				if (!isNimLoggedIn()) throw new Error('聊天服务尚未就绪，请稍后重试')
				const nim = getNimInstance()
				const creator = nim.V2NIMMessageCreator
				const service = nim.V2NIMMessageService
				if (!enterpriseAccId || !nim.V2NIMConversationIdUtil ||
					typeof nim.V2NIMConversationIdUtil.p2pConversationId !== 'function' || !creator || !service ||
					typeof creator.createCustomMessage !== 'function' || typeof creator.createTextMessage !== 'function' ||
					typeof service.sendMessage !== 'function') throw new Error('当前聊天服务不支持发送消息')
				return { creator, service, conversationId: nim.V2NIMConversationIdUtil.p2pConversationId(enterpriseAccId) }
			},
			async sendContinueChatMessages(pending) {
				const { creator, service, conversationId } = this.getContinueMessageContext(pending.enterpriseAccId)
				// 切换成功先发送 type=5 卡片；逐条等待 SDK 回执，失败重试不重发已成功的消息。
				if (pending.enterprise && !pending.customSent) {
					const message = creator.createCustomMessage('', JSON.stringify({ type: 5, data: pending.enterprise }))
					const result = await service.sendMessage(message, conversationId)
					if (!result || !result.message) throw new Error('职位变更消息发送失败')
					pending.customSent = true
					if (!this._detailPageAlive) return
				}
				if (!pending.textSent) {
					const result = await service.sendMessage(creator.createTextMessage(CONTINUE_CHAT_TEXT), conversationId)
					if (!result || !result.message) throw new Error('求职消息发送失败')
					pending.textSent = true
				}
			},
			openContinuedChat(pending) {
				return new Promise((resolve, reject) => {
					// 已在详情页完成消息发送，聊天页只加载会话，跳过初始化默认招呼语。
					uni.navigateTo({
						url: appendExternalReturnUrl(
							`/pages/person/m/chat?jobId=${encodeURIComponent(pending.jobId)}&resumeId=${encodeURIComponent(pending.resumeId)}&skipGreeting=1`,
							this.externalReturnUrl
						),
						success: () => {
							if (this._detailPageAlive) this._continueChatOpened = true
							resolve()
						},
						fail: () => reject(new Error('打开聊天页面失败，请重试'))
					})
				})
			},
			navigateBack() {
				navigateBackWithExternal(this.externalReturnUrl, '/pages/person/m/list')
			},
			handleAvatarError(message) {
				if (!this.failedAvatarIds.includes(message.id)) this.failedAvatarIds.push(message.id)
			},
			handleJobLogoError(message) {
				if (!this.failedJobLogoIds.includes(message.id)) this.failedJobLogoIds.push(message.id)
			},
			previewImage(url) {
				const urls = this.messages.filter(message => message.type === 'image').map(message => message.url)
				if (url) uni.previewImage({ current: url, urls })
			},
			audioBubbleWidth(message) {
				const seconds = Math.min(60, Math.max(1, message.durationSeconds || 1))
				return `${Math.round(150 + (seconds - 1) * 320 / 59)}rpx`
			},
			playAudioMessage(message) {
				if (!this._detailPageAlive || !message.url) return
				const isPlaying = this.audioPlayingId === message.id
				this.destroyAudioPlayer()
				if (isPlaying) return
				if (typeof uni.createInnerAudioContext !== 'function') {
					uni.showToast({ title: '当前环境不支持语音播放', icon: 'none' })
					return
				}
				const player = uni.createInnerAudioContext()
				this._audioPlayer = player
				this.audioPlayingId = message.id
				player.src = message.url
				player.onEnded(() => {
					if (this._audioPlayer === player) this.destroyAudioPlayer()
				})
				player.onError(() => {
					if (this._audioPlayer !== player) return
					this.destroyAudioPlayer()
					if (this._detailPageAlive) uni.showToast({ title: '语音播放失败，请重试', icon: 'none' })
				})
				player.play()
			},
			destroyAudioPlayer() {
				// 离开页面、切换语音或再次点击同一语音时都释放播放器。
				const player = this._audioPlayer
				this._audioPlayer = null
				this.audioPlayingId = ''
				if (player) {
					player.stop()
					player.destroy()
				}
			}
		}
	}
</script>

<style lang="scss" scoped>
	.history-detail-page {
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
		border-bottom: 1rpx solid #eeeeee;
	}
	.navigation-bar {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 88rpx;
	}
	.back-button {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 88rpx;
		height: 88rpx;
	}
	.back-icon {
		width: 18rpx;
		height: 18rpx;
		border-bottom: 3rpx solid #202020;
		border-left: 3rpx solid #202020;
		transform: rotate(45deg);
	}
	.navigation-title { font-size: 32rpx; color: #222222; }
	.message-scroll {
		position: fixed;
		right: 0;
		bottom: calc(160rpx + env(safe-area-inset-bottom));
		left: 0;
		box-sizing: border-box;
		background: #f3f6f8;
	}
	.message-content { box-sizing: border-box; min-height: 100%; padding: 24rpx 28rpx 4rpx; }
	.message-bottom { height: 2rpx; }
	.load-status, .empty-state {
		padding: 60rpx 0;
		text-align: center;
		font-size: 24rpx;
		line-height: 1.6;
		color: #a0a4a8;
	}
	.load-status.is-error { color: #f37324; }
	.time-divider { padding: 12rpx 0 36rpx; text-align: center; font-size: 24rpx; color: #a8a8a8; }
	.message-row {
		display: flex;
		align-items: flex-end;
		margin-bottom: 36rpx;
	}
	.message-avatar { flex-shrink: 0; width: 76rpx; height: 76rpx; border-radius: 50%; }
	.message-bubble {
		box-sizing: border-box;
		max-width: 68%;
		min-height: 70rpx;
		padding: 16rpx 24rpx;
		font-size: 28rpx;
		line-height: 1.65;
		word-break: break-all;
		border-radius: 8rpx;
	}
	.message-row.other {
		.message-avatar { margin-right: 28rpx; }
		.message-bubble { background: #f37324; color: #ffffff; }
	}
	.message-row.self {
		flex-direction: row-reverse;
		.message-avatar { margin-left: 28rpx; }
		.message-bubble { background: #ffffff; color: #686868; }
	}
	.message-bubble.message-bubble--image { min-height: 0; padding: 0; overflow: hidden; background: transparent; }
	.message-image { display: block; width: 320rpx; max-width: 100%; }
	.audio-message-content { display: flex; align-items: center; justify-content: space-between; gap: 24rpx; min-height: 50rpx; }
	.message-text { white-space: pre-wrap; word-break: break-all; }
	.message-emoji { display: inline-block; width: 44rpx; height: 44rpx; margin: 0 2rpx; vertical-align: middle; }
	.message-row.message-row--job-card .message-bubble {
		width: 100%; max-width: 100%; min-height: 0; padding: 0; background: transparent; color: #303236;
	}
	.job-message-card { box-sizing: border-box; width: 100%; padding: 26rpx; background: #ffffff; border-radius: 2rpx; }
	.job-message-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 20rpx; }
	.job-message-name { flex: 1; min-width: 0; font-size: 34rpx; font-weight: 500; line-height: 1.3; }
	.job-message-salary { flex-shrink: 0; font-size: 30rpx; color: #ff5c16; }
	.job-message-company { display: block; margin-top: 18rpx; font-size: 26rpx; color: #777a7e; }
	.job-message-requirements { display: flex; flex-wrap: wrap; gap: 20rpx; margin-top: 20rpx; }
	.job-message-requirement { display: inline-flex; align-items: center; font-size: 24rpx; color: #686c70; }
	.job-message-icon { flex-shrink: 0; width: 24rpx; height: 24rpx; margin-right: 8rpx; }
	.job-message-manager { display: flex; align-items: center; flex-wrap: wrap; gap: 12rpx; margin-top: 20rpx; }
	.job-message-logo { width: 48rpx; height: 48rpx; border-radius: 2rpx; }
	.job-message-manager-name, .job-message-manager-post { font-size: 28rpx; }
	.job-message-tip { margin-top: 18rpx; padding-top: 18rpx; border-top: 1rpx solid #eeeeee; font-size: 22rpx; color: #a0a4a8; white-space: pre-wrap; }
	.fixed-footer {
		position: fixed;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: content-box;
		height: 160rpx;
		padding-bottom: env(safe-area-inset-bottom);
		background: #ffffff;
	}
	.continue-button {
		margin: 0;
		padding: 0 44rpx;
		height: 72rpx;
		line-height: 72rpx;
		border-radius: 8rpx;
		background: #f37324;
		color: #ffffff;
		font-size: 26rpx;
		&::after { border: 0; }
		&[disabled] { background: #f6c09f; color: #ffffff; }
	}
	.job-picker-sheet { padding: 0 28rpx 16rpx; background: #ffffff; border-radius: 20rpx 20rpx 0 0; }
	.job-picker-heading { display: flex; align-items: center; justify-content: space-between; height: 108rpx; }
	.job-picker-title { font-size: 32rpx; color: #333333; }
	.job-picker-close { display: flex; align-items: center; justify-content: center; width: 72rpx; height: 72rpx; font-size: 44rpx; color: #999999; }
	.job-picker-list { height: 50vh; }
	.job-picker-item { padding: 28rpx 0; border-bottom: 1rpx solid #eeeeee; font-size: 28rpx; line-height: 1.6; color: #333333; word-break: break-all; }
	.job-picker-status { padding: 60rpx 0; text-align: center; font-size: 26rpx; line-height: 1.6; color: #999999; }
	.job-picker-status--error { color: #f37324; }
</style>
