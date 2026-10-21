<template>
	<view class="pc-chat-page">
		<view class="chat-shell">
			<view class="top-bar">
				<view class="main-tabs">
					<view v-for="tab in mainTabs" :key="tab.key" class="main-tab"
						:class="{ 'main-tab--active': activeMainTab === tab.key }" @click="switchMainTab(tab.key)">
						{{ tab.label }}
					</view>
				</view>
				<view class="service-phone">
					<image src="/static/pc/icon_phone.png" class="phone-icon"></image>
					<text>400-672-6626</text>
				</view>
			</view>

			<view class="chat-workspace">
				<view class="chat-sidebar">
					<view v-if="activeMainTab === 'recent'" class="message-tabs">
						<view v-for="tab in messageTabs" :key="tab.key" class="message-tab"
							:class="{ 'message-tab--active': activeMessageTab === tab.key }"
							@click="activeMessageTab = tab.key">
							<text>{{ tab.label }}</text>
							<text v-if="tab.key === 'unread' && unreadTotal" class="tab-badge">{{ unreadTotal }}</text>
						</view>
					</view>

					<view class="conversation-list" :class="{ 'conversation-list--full': activeMainTab === 'history' }">
						<view v-for="conversation in visibleConversations" :key="conversation.id"
							class="conversation-item" :class="{ 'conversation-item--selected': visibleSelectedId === conversation.id,
								'conversation-item--opening': openingConversationId === conversation.id }"
							@click="selectConversation(conversation)">
							<image :src="getConversationAvatar(conversation)" class="avatar" mode="aspectFill"
								@error="handleAvatarError(conversation)"></image>
							<view class="conversation-copy">
								<text class="conversation-name">{{ conversation.name }}</text>
								<text class="conversation-preview">{{ conversation.message }}</text>
							</view>
							<view class="conversation-meta">
								<text class="conversation-time">{{ conversation.time }}</text>
								<text v-if="conversation.unreadCount > 0" class="unread-badge"
									:class="{ 'unread-badge--dot': conversation.mute }">
									{{ conversation.mute ? '' : conversation.unreadText }}
								</text>
							</view>
							<view v-if="conversation.stickTop" class="pinned-corner"></view>
						</view>

						<view v-if="visibleIsLoading && !visibleConversations.length"
							class="conversation-empty">
							正在加载会话...
						</view>
						<view v-else-if="visibleLoadError && !visibleConversations.length"
							class="conversation-empty conversation-empty--error" @click="retryVisibleConversations">
							{{ visibleLoadError }}，点击重试
						</view>
						<view v-else-if="!visibleConversations.length" class="conversation-empty">
							{{ activeMainTab === 'recent' && activeMessageTab === 'unread' ? '暂无未读消息' : '暂无会话' }}
						</view>
					</view>
				</view>

				<view class="chat-content">
					<!-- 只有业务接口成功后才创建聊天组件，显式传入职位、简历及双方云信账号。 -->
					<pc-chat-panel v-if="chatDetail && activeMainTab === 'recent'" :key="chatDetail.conversationId"
						:conversation="activeConversation" :job-id="chatDetail.jobId" :resume-id="chatDetail.resumeId"
						:person-acc-id="chatDetail.personAccId" :enterprise-acc-id="chatDetail.enterpriseAccId"
						:detail="chatDetail" :drafts="conversationDrafts" :visible="pageVisible"
						:skip-greeting="Boolean(chatDetail.skipGreeting)"
						:opening="Boolean(openingConversationId)" @read="handleConversationRead"
						@changed="scheduleConversationReload" @pin-changed="handleConversationPinChanged" @action="handleChatAction" />
					<!-- 历史页只读：详情接口成功后才挂载，组件再按企业→人才方向请求全部聊天记录。 -->
					<pc-chat-history-panel v-else-if="historyChatDetail && activeMainTab === 'history'"
						:key="historyChatDetail.conversationId" :detail="historyChatDetail" :visible="pageVisible"
						:opening="Boolean(openingConversationId)" :continuing="isContinuingHistoryChat"
						@action="handleChatAction" @continue="continueHistoryChat" />
					<view v-else-if="openingConversationId" class="chat-loading-state">
						正在打开会话...
					</view>
					<view v-else class="empty-state">
						<!-- 未选择会话或接口失败时保留原空状态；只有 GetSingleChat 成功后才切换聊天面板。 -->
						<image src="/static/pc_chat_empty.png" class="empty-image" mode="aspectFit"></image>
						<text class="empty-tip">主动出击，心仪人才聊出来</text>
						<view class="search-button" @click="searchTalent">搜索人才</view>
					</view>
				</view>
			</view>
		</view>
		<!-- 历史职位失效/招满时复用实时聊天的职位列表，让用户选择新的沟通职位。 -->
		<view v-if="historyJobPickerVisible" class="history-job-picker-mask" @click="cancelHistoryJobPicker">
			<view class="history-job-picker" @click.stop>
				<view class="history-job-picker-header">
					<text class="history-job-picker-title">选择沟通职位</text>
					<button class="history-job-picker-close" aria-label="关闭职位列表" title="关闭"
						@click="cancelHistoryJobPicker">×</button>
				</view>
				<view v-if="historyJobListLoading" class="history-job-picker-state">职位加载中...</view>
				<button v-else-if="historyJobListError" class="history-job-picker-state history-job-picker-error"
					@click="loadHistoryJobList">{{ historyJobListError }}，点击重试</button>
				<view v-else-if="!historyJobList.length" class="history-job-picker-empty">
					<text class="history-job-picker-empty-text">暂无职位数据，马上发布发起聊天吧</text>
					<button class="history-job-publish-button" @click="openHistoryJobPublish">马上发布</button>
				</view>
				<scroll-view v-else scroll-y class="history-job-picker-list">
					<button v-for="job in historyJobList" :key="job.key || job.JobId" class="history-job-picker-item"
						@click="selectHistoryJob(job)">
						<text class="history-job-picker-name">{{ job.JobName || '未命名职位' }}</text>
						<text class="history-job-picker-detail">{{ job.Location || '-' }} - {{ job.Salary || '-' }}</text>
					</button>
				</scroll-view>
			</view>
		</view>
		<view v-if="reportModalVisible" class="report-modal-mask" @click="closeReportModal">
			<view class="report-modal" @click.stop>
				<button class="report-modal-close" aria-label="关闭举报窗口" title="关闭" @click="closeReportModal">×</button>
				<iframe class="report-modal-frame" :src="reportModalUrl" title="举报" frameborder="0"></iframe>
			</view>
		</view>
	</view>
</template>

<script>
	import {
		NIM_EVENT,
		getNimInstance,
		getNimLoginError,
		isNimLoggedIn
	} from '../../../services/nim'
	import {
		getAllNimConversations,
		getAllHistoryConversations,
		normalizeAndSortConversations
	} from '../../../services/conversation'
	import {
		getHistoryChatJobState, getHistoryChatButton, changeHistoryChatJob, getPcHistoryChatJobList
	} from '../../../services/chat-history'
	import { requestApi } from '../../../services/request'
	import PcChatPanel from '../../../components/pc-chat-panel/pc-chat-panel.vue'
	import PcChatHistoryPanel from '../../../components/pc-chat-history-panel/pc-chat-history-panel.vue'

	const DEFAULT_AVATAR = '/static/default_avatar.png'
	const CONTINUE_CHAT_TEXT = '好久没互动了，我对你简历很感兴趣，快来聊聊~'
	const PC_JOB_LIST_API = 'Chat.Chat.GetJobList'

	export default {
		components: { PcChatPanel, PcChatHistoryPanel },
		data() {
			return {
				activeMainTab: 'recent',
				activeMessageTab: 'all',
				// 外部链接可通过 personAccId 指定进入某个人才的实时会话。
				routePersonAccId: '',
				selectedId: '',
				openingConversationId: '',
				chatDetail: null,
				historyChatDetail: null,
				isContinuingHistoryChat: false,
				historyJobPickerVisible: false,
				historyJobListLoading: false,
				historyJobListError: '',
				historyJobList: [],
				reportModalVisible: false,
				reportModalUrl: '',
				pageVisible: false,
				// 草稿以会话 ID 隔离，切换会话后仍可恢复，异步发送也不会清空其他会话的草稿。
				conversationDrafts: {},
				rawConversations: [],
				historyConversations: [],
				isLoading: true,
				isHistoryLoading: true,
				loadError: '',
				historyLoadError: '',
				currentTime: Date.now(),
				// 记录加载失败的远程头像 URL；资料更新成新 URL 后会自动重新尝试加载。
				failedAvatarMap: {},
				mainTabs: [{
						key: 'recent',
						label: '最近7天会话'
					},
					{
						key: 'history',
						label: '历史会话'
					}
				],
				messageTabs: [{
						key: 'all',
						label: '全部消息'
					},
					{
						key: 'unread',
						label: '未读消息'
					}
				]
			}
		},
		computed: {
			visibleSelectedId() {
				return this.activeMainTab === 'history'
					? (this.historyChatDetail && this.historyChatDetail.conversationId) || '' : this.selectedId
			},
			activeConversation() {
				if (!this.chatDetail) return null
				return this.conversations.find(item => item.id === this.chatDetail.conversationId)
					|| this.chatDetail.conversation
			},
			/**
			 * “最近7天会话”只是产品标签：这里标准化并展示 SDK 返回的全部会话，
			 * 不按消息时间做七天范围过滤。排序遵循置顶优先、最新消息优先。
			 */
			conversations() {
				return normalizeAndSortConversations(this.rawConversations, this.currentTime)
			},
			unreadTotal() {
				return this.conversations.reduce((total, conversation) => {
					return total + Number(conversation.unreadCount || 0)
				}, 0)
			},
			visibleConversations() {
				if (this.activeMainTab === 'history') return this.historyConversations
				// 未读页签只判断 SDK 会话未读数，全部页签不做任何时间或未读过滤。
				if (this.activeMessageTab === 'unread') {
					return this.conversations.filter(conversation => conversation.unreadCount > 0)
				}
				console.log(112233, this.conversations)
				return this.conversations
			},
			visibleIsLoading() {
				return this.activeMainTab === 'history' ? this.isHistoryLoading : this.isLoading
			},
			visibleLoadError() {
				return this.activeMainTab === 'history' ? this.historyLoadError : this.loadError
			}
		},
		onLoad(options = {}) {
			this._conversationPageAlive = true
			this._historyConversationsLoaded = false
			this._openConversationRequestId = 0
			this._continueHistoryRequestId = 0
			this._routeConversationPromise = null
			this._routeConversationOpened = false
			// uni-app 会把 URL 查询参数传给 onLoad；兼容大小写，方便外部链接传参。
			this.routePersonAccId = String(options.personAccId || options.PersonAccId || '').trim()
			this.bindConversationEvents()
		},
		onShow() {
			this.pageVisible = true
			// 页面恢复显示时主动刷新，覆盖页面隐藏期间发生的会话变化。
			this.currentTime = Date.now()
			if (this.routePersonAccId) this.openRouteConversationAfterLoad()
			else this.loadConversations()
			this.loadHistoryConversations()
		},
		onHide() {
			this.pageVisible = false
			if (this._routeConversationPromise) this._routeConversationRetryAfterHide = true
			this.cancelOpeningConversation()
			this.cancelContinueHistory()
		},
		onUnload() {
			this._conversationPageAlive = false
			this.pageVisible = false
			this.reportModalVisible = false
			this.reportModalUrl = ''
			this.cancelOpeningConversation()
			this.cancelContinueHistory()
			this.unbindConversationEvents()
			if (this._conversationRefreshTimer) clearTimeout(this._conversationRefreshTimer)
		},
		methods: {
			bindConversationEvents() {
				// SDK 单例已把原生监听转成 uni 全局事件；页面只负责订阅和在卸载时解绑。
				uni.$on(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
				uni.$on(NIM_EVENT.LOGIN_FAILED, this.handleNimLoginFailed)
				uni.$on(NIM_EVENT.CONVERSATION_SYNC_STARTED, this.handleConversationSyncStarted)
				uni.$on(NIM_EVENT.CONVERSATION_SYNC_FINISHED, this.scheduleConversationReload)
				uni.$on(NIM_EVENT.CONVERSATION_SYNC_FAILED, this.handleConversationLoadFailed)
				uni.$on(NIM_EVENT.CONVERSATION_CREATED, this.handleConversationCreated)
				uni.$on(NIM_EVENT.CONVERSATION_CHANGED, this.handleConversationChanged)
				uni.$on(NIM_EVENT.CONVERSATION_DELETED, this.handleConversationDeleted)
				uni.$on(NIM_EVENT.TOTAL_UNREAD_COUNT_CHANGED, this.scheduleConversationReload)
				uni.$on(NIM_EVENT.MESSAGE_RECEIVED, this.scheduleConversationReload)
			},
			unbindConversationEvents() {
				uni.$off(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
				uni.$off(NIM_EVENT.LOGIN_FAILED, this.handleNimLoginFailed)
				uni.$off(NIM_EVENT.CONVERSATION_SYNC_STARTED, this.handleConversationSyncStarted)
				uni.$off(NIM_EVENT.CONVERSATION_SYNC_FINISHED, this.scheduleConversationReload)
				uni.$off(NIM_EVENT.CONVERSATION_SYNC_FAILED, this.handleConversationLoadFailed)
				uni.$off(NIM_EVENT.CONVERSATION_CREATED, this.handleConversationCreated)
				uni.$off(NIM_EVENT.CONVERSATION_CHANGED, this.handleConversationChanged)
				uni.$off(NIM_EVENT.CONVERSATION_DELETED, this.handleConversationDeleted)
				uni.$off(NIM_EVENT.TOTAL_UNREAD_COUNT_CHANGED, this.scheduleConversationReload)
				uni.$off(NIM_EVENT.MESSAGE_RECEIVED, this.scheduleConversationReload)
			},
			handleLoginStatus(status) {
				if (status !== 1) return
				this.scheduleConversationReload()
				this.loadHistoryConversations()
				// 页面可能先于云信登录完成显示；登录成功后重新尝试打开路由指定的会话。
				this.openRouteConversationAfterLoad()
			},
			handleNimLoginFailed(error) {
				this.handleConversationLoadFailed(error)
				if (this._historyConversationsLoaded) return
				this.isHistoryLoading = false
				this.historyLoadError = error && (error.message || error.desc)
					? error.message || error.desc
					: '历史会话加载失败'
			},
			handleConversationSyncStarted() {
				if (!this.rawConversations.length) this.isLoading = true
			},
			handleConversationLoadFailed(error) {
				this.isLoading = false
				this.loadError = error && (error.message || error.desc)
					? error.message || error.desc
					: '会话加载失败'
			},
			handleConversationCreated(conversation) {
				this.upsertConversations([conversation])
				// 完整刷新会同时从网易云获取新会话用户的昵称与头像。
				this.scheduleConversationReload()
			},
			handleConversationChanged(conversationList) {
				this.upsertConversations(conversationList)
				// 更新消息摘要、未读数后再次补齐最新用户资料。
				this.scheduleConversationReload()
			},
			handleConversationDeleted(conversationIds) {
				const deletedIdSet = new Set((Array.isArray(conversationIds) ? conversationIds : [])
					.map(conversationId => String(conversationId)))
				this.rawConversations = this.rawConversations.filter(conversation => {
					return !deletedIdSet.has(String(conversation.conversationId))
				})
				if (deletedIdSet.has(String(this.selectedId))) {
					this.selectedId = ''
					this.chatDetail = null
				}
				if (deletedIdSet.has(String(this.openingConversationId))) this.cancelOpeningConversation()
				if (this._conversationLoadPromise) this._conversationReloadPending = true
			},
			upsertConversations(conversationList) {
				if (!Array.isArray(conversationList) || !conversationList.length) return

				const conversationMap = new Map(this.rawConversations.map(conversation => [
					String(conversation.conversationId),
					conversation
				]))
				conversationList.forEach(conversation => {
					if (!conversation || !conversation.conversationId) return
					const conversationId = String(conversation.conversationId)
					const previous = conversationMap.get(conversationId) || {}
					conversationMap.set(conversationId, {
						...previous,
						...conversation,
						// 事件对象资料为空时保留上次从 V2NIMUserService 获取的展示信息。
						name: conversation.name || previous.name,
						avatar: conversation.avatar || previous.avatar
					})
				})

				this.currentTime = Date.now()
				this.rawConversations = Array.from(conversationMap.values())
			},
			scheduleConversationReload() {
				if (!this._conversationPageAlive) return
				if (this._conversationRefreshTimer) clearTimeout(this._conversationRefreshTimer)
				// 合并同批消息触发的多个 SDK 通知，避免重复分页和重复拉取用户资料。
				this._conversationRefreshTimer = setTimeout(() => {
					this._conversationRefreshTimer = null
					this.loadConversations()
				}, 80)
			},
			async loadConversations() {
				if (!this._conversationPageAlive) return
				if (!isNimLoggedIn()) {
					const loginError = getNimLoginError()
					if (loginError) {
						this.handleConversationLoadFailed(loginError)
						return
					}
					// App.vue 正在异步登录，成功后 LOGIN_STATUS 事件会触发实际加载。
					this.isLoading = !this.rawConversations.length
					return
				}
				if (this._conversationLoadPromise) {
					this._conversationReloadPending = true
					return this._conversationLoadPromise
				}

				this.isLoading = !this.rawConversations.length
				this.loadError = ''
				// getAllNimConversations 会拉完全部分页，并批量获取 P2P 对方的网易云用户资料。
				this._conversationLoadPromise = getAllNimConversations()
					.then(conversationList => {
						if (!this._conversationPageAlive) return
						this.currentTime = Date.now()
						this.rawConversations = conversationList
					})
					.catch(error => {
						if (!this._conversationPageAlive) return
						console.error('[NIM] PC 端获取会话列表失败', error)
						this.handleConversationLoadFailed(error)
					})
					.finally(() => {
						if (this._conversationPageAlive) this.isLoading = false
						this._conversationLoadPromise = null
						if (this._conversationReloadPending && this._conversationPageAlive) {
							this._conversationReloadPending = false
							this.loadConversations()
						}
					})

				return this._conversationLoadPromise
			},
			async openRouteConversationAfterLoad() {
				if (!this.routePersonAccId || !this._conversationPageAlive || !this.pageVisible
					|| !isNimLoggedIn() || this._routeConversationOpened || this._routeConversationPromise) return

				// 等 SDK 会话列表完成后再查找，避免列表尚未返回时误判为新会话。
				this._routeConversationRetryAfterHide = false
				this._routeConversationPromise = Promise.resolve(this._conversationLoadPromise || this.loadConversations())
					.then(() => {
						if (!this._conversationPageAlive || !this.pageVisible || this._routeConversationOpened) return
						this.activeMainTab = 'recent'
						this.activeMessageTab = 'all'

						const targetId = this.routePersonAccId
						const existing = this.conversations.find(conversation => conversation.type === 1
							&& String(conversation.targetId || '').trim() === targetId)
						// 列表没有该人才时仍创建临时 P2P 会话；GetSingleChat 会补齐职位和简历信息。
						const conversation = existing || this.createRouteConversation(targetId)
						if (!conversation) return
						return this.selectConversation(conversation).then(() => {
							if (this.chatDetail && this.chatDetail.conversationId === conversation.id) {
								this._routeConversationOpened = true
								// 云信创建事件到达前先把新会话加入列表，保证选中状态可见。
								if (!existing) this.upsertConversations([conversation])
							}
						})
					})
					.catch(error => {
						if (this._conversationPageAlive && this.pageVisible) {
							console.warn('[NIM] 自动打开指定会话失败', error)
						}
					})
					.finally(() => {
						this._routeConversationPromise = null
						if (this._routeConversationRetryAfterHide && this._conversationPageAlive
							&& this.pageVisible && !this._routeConversationOpened) {
							this.openRouteConversationAfterLoad()
						}
					})
				return this._routeConversationPromise
			},
			createRouteConversation(personAccId) {
				if (!personAccId) return null
				let conversationId = ''
				try {
					const util = getNimInstance().V2NIMConversationIdUtil
					if (util && typeof util.p2pConversationId === 'function') {
						conversationId = String(util.p2pConversationId(personAccId) || '').trim()
					}
				} catch (error) {
					// SDK 工具短暂不可用时保留账号作为兜底 ID，登录完成后仍可重试加载。
				}
				if (!conversationId) conversationId = personAccId
				return {
					id: conversationId,
					conversationId,
					targetId: personAccId,
					type: 1,
					name: personAccId,
					avatar: DEFAULT_AVATAR,
					message: '暂无消息',
					time: '',
					stickTop: false,
					mute: false,
					unreadCount: 0,
					unreadText: '0'
				}
			},
			async loadHistoryConversations() {
				if (!this._conversationPageAlive || this._historyConversationsLoaded) return
				if (!isNimLoggedIn()) {
					const loginError = getNimLoginError()
					if (loginError) {
						this.handleNimLoginFailed(loginError)
						return
					}
					this.isHistoryLoading = !this.historyConversations.length
					return
				}
				if (this._historyConversationLoadPromise) return this._historyConversationLoadPromise

				this.isHistoryLoading = !this.historyConversations.length
				this.historyLoadError = ''
				// 复用业务会话库查询；当前页面成功加载一次后不随 SDK 消息通知重复请求。
				this._historyConversationLoadPromise = getAllHistoryConversations()
					.then(conversationList => {
						if (!this._conversationPageAlive) return
						this.historyConversations = conversationList
						this._historyConversationsLoaded = true
					})
					.catch(error => {
						if (!this._conversationPageAlive) return
						console.error('[NIM] PC 端获取历史会话列表失败', error)
						this.historyLoadError = error && error.message ? error.message : '历史会话加载失败'
					})
					.finally(() => {
						if (this._conversationPageAlive) this.isHistoryLoading = false
						this._historyConversationLoadPromise = null
					})

				return this._historyConversationLoadPromise
			},
			retryVisibleConversations() {
				return this.activeMainTab === 'history' ? this.loadHistoryConversations() : this.loadConversations()
			},
			getConversationAvatar(conversation) {
				const avatar = conversation && conversation.avatar ? conversation.avatar : DEFAULT_AVATAR
				return this.failedAvatarMap[conversation.id] === avatar ? DEFAULT_AVATAR : avatar
			},
			handleAvatarError(conversation) {
				if (!conversation || !conversation.id || !conversation.avatar) return
				this.$set(this.failedAvatarMap, conversation.id, conversation.avatar)
			},
			cancelOpeningConversation() {
				// 无需取消底层网络请求：递增序号即可让旧响应在切换、隐藏或卸载后失效。
				this._openConversationRequestId += 1
				this.openingConversationId = ''
			},
			cancelContinueHistory() {
				this._continueHistoryRequestId = (this._continueHistoryRequestId || 0) + 1
				this.isContinuingHistoryChat = false
				this.cancelHistoryJobPicker()
			},
			cancelHistoryJobPicker() {
				this.historyJobPickerVisible = false
				this._historyJobListRequestId = (this._historyJobListRequestId || 0) + 1
				this.historyJobListLoading = false
				const resolve = this._historyJobPickerResolve
				this._historyJobPickerResolve = null
				if (resolve) resolve(null)
			},
			chooseHistoryJob() {
				return new Promise(resolve => {
					this._historyJobPickerResolve = resolve
					this._historyJobPickerNoJobs = false
					this.historyJobPickerVisible = true
					this.historyJobList = []
					this.historyJobListError = ''
					this.loadHistoryJobList()
				})
			},
			async loadHistoryJobList() {
				if (!this._conversationPageAlive || !this.historyJobPickerVisible || this.historyJobListLoading) return
				const requestId = this._historyJobListRequestId = (this._historyJobListRequestId || 0) + 1
				this.historyJobListLoading = true
				this.historyJobListError = ''
				try {
					// 与实时聊天组件完全一致：请求企业当前发布中的首批 50 个职位。
					let jobs
					if (typeof getPcHistoryChatJobList === 'function') jobs = await getPcHistoryChatJobList()
					else {
						// 保留页面层兜底，便于旧构建缓存未包含服务方法时仍能完成职位切换。
						const response = await requestApi({ Name: PC_JOB_LIST_API, Content: { Start: 0, pageSize: 50 } })
						if (!response || Number(response.Code) !== 0) throw new Error('获取职位列表失败')
						let data = response.Data
						if (typeof data === 'string') data = JSON.parse(data)
						const rows = data && Array.isArray(data.Rows) ? data.Rows : data && Array.isArray(data.List) ? data.List : []
						jobs = rows.map((row, index) => row && row.JobId ? { ...row, JobId: String(row.JobId), key: `job-${row.JobId}-${index}` } : null).filter(Boolean)
					}
					if (this._conversationPageAlive && this.historyJobPickerVisible && requestId === this._historyJobListRequestId) {
						this.historyJobList = jobs
						if (!jobs.length) {
							this._historyJobPickerNoJobs = true
						}
					}
				} catch (error) {
					if (this._conversationPageAlive && this.historyJobPickerVisible && requestId === this._historyJobListRequestId) {
						this.historyJobListError = error && error.message ? error.message : '职位列表加载失败，请重试'
					}
				} finally {
					if (this._conversationPageAlive && requestId === this._historyJobListRequestId) this.historyJobListLoading = false
				}
			},
			selectHistoryJob(job) {
				if (!this._conversationPageAlive || !this.historyJobPickerVisible || this.historyJobListLoading || !job || !job.JobId) return
				const resolve = this._historyJobPickerResolve
				this._historyJobPickerResolve = null
				this.historyJobPickerVisible = false
				if (resolve) resolve(job)
			},
			switchMainTab(key) {
				if (key === this.activeMainTab) return
				this.cancelOpeningConversation()
				this.cancelContinueHistory()
				this.activeMainTab = key
			},
			async selectConversation(conversation) {
				if (!conversation || !conversation.id) return
				const isHistory = this.activeMainTab === 'history'
				if (isHistory) this.cancelContinueHistory()
				const currentDetail = isHistory ? this.historyChatDetail : this.chatDetail
				if (this.openingConversationId === conversation.id) return
				if (currentDetail && currentDetail.conversationId === conversation.id) {
					this.cancelOpeningConversation()
					return
				}
				if (!isNimLoggedIn() || conversation.type !== 1) {
					uni.showToast({ title: conversation.type !== 1 ? '请选择人才单聊会话' : '聊天服务尚未就绪', icon: 'none' })
					return
				}

				// 企业 PC 端：当前登录账号为企业，P2P 会话的 targetId 为人才，不能沿用个人端方向。
				const enterpriseAccId = String(getNimInstance().V2NIMLoginService.getLoginUser() || '').trim()
				const personAccId = String(conversation.targetId || '').trim()
				if (!enterpriseAccId || !personAccId) {
					uni.showToast({ title: '未获取到会话账号信息', icon: 'none' })
					return
				}

				const requestId = ++this._openConversationRequestId
				const isCurrent = () => this._conversationPageAlive && this.pageVisible
					&& requestId === this._openConversationRequestId
				this.openingConversationId = conversation.id
				try {
					const response = await requestApi({
						Name: 'Chat.Chat.GetSingleChat',
						Content: { PersonAccId: personAccId, EnterpriseAccId: enterpriseAccId }
					})
					if (!isCurrent()) return
					if (!response || Number(response.Code) !== 0) throw new Error('获取会话信息失败')
					const data = typeof response.Data === 'string' ? JSON.parse(response.Data) : response.Data
					if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('会话信息格式不正确')
					if (data.Code !== undefined && Number(data.Code) !== 0) throw new Error('获取会话信息失败')
					const jobId = String(data.JobId === undefined || data.JobId === null ? '' : data.JobId).trim()
					const resumeId = String(data.ResumeId === undefined || data.ResumeId === null ? '' : data.ResumeId).trim()
					if (!jobId || !resumeId) throw new Error('会话信息缺少职位或简历')
					// 账号若有返回则必须与所点击的会话一致，防止业务资料与云信消息串到另一位人才。
					if ((data.PersonAccId && String(data.PersonAccId).trim() !== personAccId)
						|| (data.EnterpriseAccId && String(data.EnterpriseAccId).trim() !== enterpriseAccId)) {
						throw new Error('会话账号与所选人才不一致')
					}
					// 与手机端一致解析业务置顶状态，只有接口未返回 IsTop 时才回退到云信缓存。
					const isTop = data.IsTop !== undefined ? data.IsTop : response.IsTop
					const detail = {
						conversationId: conversation.id, conversation, jobId, resumeId, personAccId, enterpriseAccId,
						jobName: data.JobName === undefined || data.JobName === null ? '' : String(data.JobName),
						jobLocation: data.Location === undefined || data.Location === null ? '' : String(data.Location),
						jobSalary: data.Salary === undefined || data.Salary === null ? '' : String(data.Salary),
						isPinned: isTop === undefined ? Boolean(conversation.stickTop)
							: isTop === true || Number(isTop) === 1 || String(isTop).toLowerCase() === 'true',
						chatByQRcode: data.ChatByQRcode || ''
					}
					// 两个分类各自保存选择，避免同一会话 ID 让历史详情误用实时聊天状态。
					if (isHistory) this.historyChatDetail = detail
					else {
						this.chatDetail = detail
						this.selectedId = conversation.id
					}
				} catch (error) {
					if (!isCurrent()) return
					uni.showToast({ title: error && error.message ? error.message : '打开会话失败', icon: 'none' })
				} finally {
					if (isCurrent()) this.openingConversationId = ''
				}
			},
			confirmContinueJobSwitch() {
				return new Promise((resolve, reject) => {
					uni.showModal({
						title: '提示', content: '是否切换聊天职位', confirmText: '立即切换',
						cancelText: '取消', showCancel: true,
						success: result => resolve(Boolean(result && result.confirm)),
						fail: () => reject(new Error('打开职位切换提示失败'))
					})
				})
			},
			async sendContinueHistoryMessage(detail, enterprise, isCurrent) {
				if (!isNimLoggedIn()) throw new Error('聊天服务尚未就绪，请稍后重试')
				const nim = getNimInstance()
				const creator = nim && nim.V2NIMMessageCreator
				const service = nim && nim.V2NIMMessageService
				if (!detail.conversationId || !creator || !service || typeof service.sendMessage !== 'function') {
					throw new Error('当前聊天服务不支持发送消息')
				}
				let message
				if (enterprise) {
					if (typeof creator.createCustomMessage !== 'function') throw new Error('当前聊天服务不支持发送自定义消息')
					// 文档 2264 成功后发送 type=5，data 必须保留接口返回的 Enterprise 原对象。
					message = creator.createCustomMessage('', JSON.stringify({ type: 5, data: enterprise }))
				} else {
					if (typeof creator.createTextMessage !== 'function') throw new Error('当前聊天服务不支持发送文本消息')
					message = creator.createTextMessage(CONTINUE_CHAT_TEXT)
				}
				const result = await service.sendMessage(message, detail.conversationId)
				if (!result || !result.message) throw new Error(enterprise ? '职位切换自定义消息发送失败' : '继续聊天消息发送失败')
				if (isCurrent && !isCurrent()) return false
				return true
			},
			updateContinueJobDetail(detail, enterprise) {
				const job = enterprise || {}
				const value = (fields, fallback = '') => {
					for (const field of fields) {
						if (job[field] !== undefined && job[field] !== null && String(job[field]).trim()) return String(job[field]).trim()
					}
					return fallback
				}
				return {
					...detail,
					jobId: value(['JobId', 'Id', 'ID'], String(detail.jobId || '').trim()),
					jobName: value(['JobName', 'Name', 'PositionName', 'Title'], detail.jobName || ''),
					jobLocation: value(['Location', 'JobLocation', 'WorkLocation', 'Address', 'Area'], detail.jobLocation || ''),
					jobSalary: value(['Salary', 'SalaryText', 'Pay'], detail.jobSalary || ''),
					enterprise: enterprise || detail.enterprise,
					skipGreeting: true
				}
			},
			async continueHistoryChat() {
				if (!this._conversationPageAlive || !this.pageVisible || this.activeMainTab !== 'history'
					|| this.openingConversationId || this.isContinuingHistoryChat || !this.historyChatDetail) return
				if (!isNimLoggedIn()) {
					uni.showToast({ title: '聊天服务尚未就绪', icon: 'none' })
					return
				}
				const detail = this.historyChatDetail
				const requestId = (this._continueHistoryRequestId || 0) + 1
				this._continueHistoryRequestId = requestId
				const isCurrent = () => this._conversationPageAlive && this.pageVisible
					&& this.activeMainTab === 'history' && requestId === this._continueHistoryRequestId
				this.isContinuingHistoryChat = true
				try {
					// 历史记录可能来自职位已失效或已招满的会话，进入实时聊天前重新确认状态。
					const state = await getHistoryChatJobState(detail.jobId)
					if (!isCurrent()) return
					if (state !== 1) {
						// 职位失效/招满时沿用实时聊天的职位选择逻辑，选择新的发布中职位后再切换。
						const selectedJob = await this.chooseHistoryJob()
						if (!selectedJob || !isCurrent()) {
							// 职位列表为空时已在弹窗中给出发布入口，不再重复提示职位失效/招满。
							this._historyJobPickerNoJobs = false
							return
						}
						const selectedJobId = String(selectedJob.JobId || '').trim()
						if (!selectedJobId || selectedJobId === String(detail.jobId || '').trim()) {
							uni.showToast({ title: '请选择其他沟通职位', icon: 'none' })
							return
						}
						// 文档 2264：切换成功后返回 Enterprise，必须把同一个对象作为 type=5 消息 data。
						const enterprise = await changeHistoryChatJob(detail.personAccId, detail.enterpriseAccId, selectedJobId)
						if (!isCurrent()) return
						await this.sendContinueHistoryMessage(detail, enterprise, isCurrent)
						if (!isCurrent()) return
						this.cancelOpeningConversation()
						const switchedDetail = this.updateContinueJobDetail({ ...detail, jobId: selectedJobId }, enterprise)
						// 同步历史详情快照，用户返回历史分类后继续沟通不会再次使用失效职位。
						this.historyChatDetail = switchedDetail
						this.chatDetail = switchedDetail
						this.selectedId = this.chatDetail.conversationId
						this.activeMessageTab = 'all'
						this.activeMainTab = 'recent'
						return
					}
					// 文档 2259：状态正常后查询当前聊天职位，再决定切换职位或发送文本消息。
					const button = await getHistoryChatButton(detail.jobId, detail.resumeId)
					if (!isCurrent()) return
					const currentJobId = String(detail.jobId || '').trim()
					const returnedJobId = String(button.JobId || '').trim()
					let enterprise = null
					if (returnedJobId !== currentJobId) {
						const confirmed = await this.confirmContinueJobSwitch()
						if (!confirmed || !isCurrent()) return
						// 文档 2264：传入当前历史职位 ID，成功后使用返回 Enterprise 发送 type=5。
						enterprise = await changeHistoryChatJob(detail.personAccId, detail.enterpriseAccId, currentJobId)
						if (!isCurrent()) return
						await this.sendContinueHistoryMessage(detail, enterprise, isCurrent)
					} else {
						// 职位 ID 一致时发送固定的继续沟通文本，随后进入实时聊天。
						await this.sendContinueHistoryMessage(detail, null, isCurrent)
					}
					if (!isCurrent()) return
					// 发送成功后才创建实时聊天面板；skipGreeting 防止实时面板再次发送默认招呼语。
					this.cancelOpeningConversation()
					const continuedDetail = this.updateContinueJobDetail(detail, enterprise)
					this.historyChatDetail = continuedDetail
					this.chatDetail = continuedDetail
					this.selectedId = this.chatDetail.conversationId
					this.activeMessageTab = 'all'
					this.activeMainTab = 'recent'
				} catch (error) {
					if (isCurrent()) uni.showToast({ title: error && error.message ? error.message : '获取职位状态失败，请重试', icon: 'none' })
				} finally {
					if (requestId === this._continueHistoryRequestId) this.isContinuingHistoryChat = false
				}
			},
			handleConversationRead(conversationId) {
				// 实际进入聊天区后才同步清除本地展示的未读数，接口失败不会提前消除红点。
				this.rawConversations = this.rawConversations.map(item => item.conversationId === conversationId
					? { ...item, unreadCount: 0, hasNewMessage: false } : item)
			},
			handleConversationPinChanged({ conversationId, isPinned }) {
				if (!this._conversationPageAlive || !conversationId) return
				// 业务保存成功即更新置顶角标与排序，只改 stickTop，保留消息时间、未读数和草稿。
				this.rawConversations = this.rawConversations.map(item => item.conversationId === conversationId
					? { ...item, stickTop: isPinned } : item)
				if (this.chatDetail && this.chatDetail.conversationId === conversationId) {
					// 同步备用会话快照，切换职位重建面板后仍能恢复最新置顶状态。
					this.chatDetail = { ...this.chatDetail, isPinned,
						conversation: { ...this.chatDetail.conversation, stickTop: isPinned } }
				}
			},
			handleChatAction(action) {
				if (action && action.key === 'publish-job') {
					// 实时聊天职位列表为空时，复用历史职位弹窗的发布入口处理。
					this.openHistoryJobPublish()
					return
				}
				if (action && action.key === 'job-switched' && action.job && action.job.jobId) {
					// 切换接口及云信通知完成后更新父页职位数据，保留当前聊天实例和已加载消息。
					this.chatDetail = {
						...this.chatDetail,
						jobId: String(action.job.jobId),
						jobName: action.job.name || '',
						jobLocation: action.job.location || '',
						jobSalary: action.job.salary || '',
						enterprise: action.enterprise || this.chatDetail.enterprise
					}
					return
				}
				if (action && ['resume', 'interview', 'unsuitable'].includes(action.key)) {
					const resumeId = String(action.resumeId || (this.chatDetail && this.chatDetail.resumeId) || '').trim()
					if (!resumeId) {
						uni.showToast({ title: '未获取到简历信息', icon: 'none' })
						return
					}
					const resumeUrl = `https://www.texhr.cn/resumes/?ids=${encodeURIComponent(resumeId)}`
					const openedWindow = typeof window !== 'undefined' && typeof window.open === 'function'
						? window.open(resumeUrl, '_blank') : null
					if (!openedWindow) uni.showToast({ title: '无法打开新窗口，请检查浏览器设置', icon: 'none' })
					return
				}
				if (action && action.key === 'report') {
					const fromAccid = String(action.enterpriseAccId || (this.chatDetail && this.chatDetail.enterpriseAccId) || '').trim()
					const toAccid = String(action.personAccId || (this.chatDetail && this.chatDetail.personAccId) || '').trim()
					if (!fromAccid || !toAccid) {
						uni.showToast({ title: '未获取到举报所需的聊天账号', icon: 'none' })
						return
					}
					const reportUrl = `https://www.texhr.cn/report/ChatReportView?FromAccid=${encodeURIComponent(fromAccid)}&ToAccid=${encodeURIComponent(toAccid)}&reportType=enterprise`
					this.reportModalUrl = reportUrl
					this.reportModalVisible = true
					return
				}
				if (action && action.key === 'phrase-settings') {
					const openedWindow = typeof window !== 'undefined' && typeof window.open === 'function'
						? window.open('http://www.texhr.cn/ehr/chat/template/', '_blank') : null
					if (!openedWindow) uni.showToast({ title: '无法打开新窗口，请检查浏览器设置', icon: 'none' })
					return
				}
				// 其它业务操作统一保留占位提示，避免误认为已经完成对应业务动作。
				uni.showToast({ title: `${action.label}功能暂未接入`, icon: 'none' })
			},
			searchTalent() {
				const openedWindow = typeof window !== 'undefined' && typeof window.open === 'function'
					? window.open('https://www.texhr.cn/ehr/resumesearch/', '_blank') : null
				if (!openedWindow) uni.showToast({ title: '无法打开新窗口，请检查浏览器设置', icon: 'none' })
			},
			openHistoryJobPublish() {
				// 职位列表为空时，在新窗口打开职位发布页，避免打断当前聊天页面。
				const openedWindow = typeof window !== 'undefined' && typeof window.open === 'function'
					? window.open('https://www.texhr.cn/ehr/jobpost/', '_blank') : null
				if (!openedWindow) uni.showToast({ title: '无法打开新窗口，请检查浏览器设置', icon: 'none' })
				// 完成发布入口操作后关闭空职位弹窗，并结束等待职位选择的流程。
				this.cancelHistoryJobPicker()
			},
			closeReportModal() {
				this.reportModalVisible = false
				this.reportModalUrl = ''
			}
		}
	}
</script>

<style lang="scss" scoped>
	.pc-chat-page {
		box-sizing: border-box;
		min-width: 1140px;
		min-height: 100vh;
		overflow: auto;
		color: #333333;
		background: #f5f6f7;
		font-family: "Microsoft YaHei", Arial, sans-serif;
	}

	.chat-shell {
		width: 1140px;
		margin: 20px auto 0;
	}

	.top-bar {
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		height: 49px;
		padding: 0 15px;
	}

	.main-tabs {
		display: flex;
		height: 49px;
	}

	.main-tab {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 137px;
		height: 49px;
		font-size: 16px;
		color: #424242;
		cursor: pointer;

		&.main-tab--active {
			color: #f37324;
			background: #eef0f2;
			border-radius: 14px 14px 0 0;
		}
	}

	.service-phone {
		display: flex;
		align-items: center;
		height: 49px;
		font-family: Arial, sans-serif;
		font-size: 14px;
		color: #929ba4;
	}

	.phone-icon {
		display: inline-block;
		margin-right: 5px;
		width: 18px;
		height: 18px;
	}

	.chat-workspace {
		display: flex;
		box-sizing: border-box;
		height: calc(100vh - 89px);
		min-height: 560px;
		padding: 15px;
		background: #eef0f2;
	}

	.chat-sidebar,
	.chat-content {
		box-sizing: border-box;
		background: #ffffff;
	}

	.chat-sidebar {
		flex: 0 0 291px;
		width: 291px;
		height: 100%;
		border-right: 1px solid #e1e5e8;
	}

	.message-tabs {
		display: flex;
		height: 49px;
		border-bottom: 1px solid #f4f4f4;
	}

	.message-tab {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 50%;
		height: 49px;
		font-size: 14px;
		color: #a4a9ae;
		cursor: pointer;

		&.message-tab--active {
			color: #f37324;

			&::after {
				position: absolute;
				bottom: 0;
				left: 50%;
				width: 14px;
				height: 2px;
				content: '';
				background: #f37324;
				transform: translateX(-50%);
			}
		}
	}

	.tab-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-width: 18px;
		height: 18px;
		margin: -19px 0 0 4px;
		padding: 0 5px;
		font-size: 12px;
		line-height: 18px;
		color: #ffffff;
		background: #f04438;
		border-radius: 10px;
	}

	.conversation-list {
		height: calc(100% - 50px);
		overflow-y: auto;
	}

	.conversation-list--full {
		height: 100%;
	}

	.conversation-item {
		position: relative;
		display: flex;
		align-items: center;
		box-sizing: border-box;
		height: 75px;
		padding: 0 14px;
		cursor: pointer;
		transition: background-color 0.15s ease;

		&:hover,
		&.conversation-item--selected {
			background: #fff8f3;
		}

		&.conversation-item--opening {
			background: #ffefe4;
			cursor: progress;
		}
	}

	.avatar {
		position: relative;
		flex: 0 0 44px;
		box-sizing: border-box;
		width: 44px;
		height: 44px;
		margin-right: 15px;
		border-radius: 50%;
	}

	.conversation-copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.conversation-name,
	.conversation-preview {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.conversation-name {
		font-size: 14px;
		line-height: 22px;
		color: #202020;
	}

	.conversation-preview {
		font-size: 14px;
		line-height: 20px;
		color: #9aa1a8;
	}

	.conversation-meta {
		display: flex;
		flex: 0 0 80px;
		align-items: flex-end;
		align-self: stretch;
		flex-direction: column;
		padding-top: 16px;
	}

	.conversation-time {
		font-size: 12px;
		line-height: 18px;
		color: #929ba2;
	}

	.unread-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-width: 30px;
		height: 18px;
		margin-top: 5px;
		padding: 0 8px;
		font-size: 12px;
		line-height: 18px;
		color: #ffffff;
		background: #ff4d43;
		border-radius: 10px;

		&.unread-badge--dot {
			width: 8px;
			min-width: 8px;
			height: 8px;
			margin-top: 10px;
			padding: 0;
			border-radius: 50%;
		}
	}

	.conversation-empty {
		padding-top: 46px;
		font-size: 14px;
		text-align: center;
		color: #a4a9ae;

		&.conversation-empty--error {
			color: #f37324;
			cursor: pointer;
		}
	}

	.pinned-corner {
		position: absolute;
		top: 0;
		right: 0;
		width: 0;
		height: 0;
		border-top: 15px solid #ffdd00;
		border-left: 15px solid transparent;
	}

	.chat-content {
		position: relative;
		flex: 1;
		min-width: 0;
		height: 100%;
		border-radius: 6px 6px 0 0;
	}

	.chat-loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 14px;
		color: #929ba4;
	}

	.history-job-picker-mask {
		position: fixed;
		z-index: 25;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, .32);
	}

	.history-job-picker {
		box-sizing: border-box;
		width: min(520px, calc(100vw - 48px));
		max-height: min(560px, calc(100vh - 48px));
		padding: 0 20px 18px;
		background: #fff;
		box-shadow: 0 8px 28px rgba(0, 0, 0, .18);
	}

	.history-job-picker-header {
		display: flex;
		align-items: center;
		min-height: 58px;
		border-bottom: 1px solid #edf0f3;
	}

	.history-job-picker-title {
		flex: 1;
		font-size: 16px;
		color: #30353a;
	}

	.history-job-picker-close {
		width: 30px;
		height: 30px;
		padding: 0;
		border: 0;
		font-size: 24px;
		line-height: 30px;
		color: #9aa1a8;
		background: transparent;
		cursor: pointer;
	}

	.history-job-picker-close::after { border: 0; }
	.history-job-picker-state {
		display: block;
		width: 100%;
		padding: 38px 0;
		border: 0;
		font-size: 14px;
		line-height: 24px;
		text-align: center;
		color: #929ba4;
		background: transparent;
	}
	.history-job-picker-empty {
		display: flex;
		align-items: center;
		flex-direction: column;
		padding: 38px 0 28px;
	}
	.history-job-picker-empty-text {
		font-size: 14px;
		line-height: 24px;
		text-align: center;
		color: #929ba4;
	}
	.history-job-publish-button {
		box-sizing: border-box;
		min-width: 104px;
		height: 36px;
		margin-top: 20px;
		padding: 0 18px;
		border: 1px solid #f37324;
		border-radius: 3px;
		font-size: 14px;
		line-height: 34px;
		color: #fff;
		background: #f37324;
		cursor: pointer;
	}
	.history-job-publish-button::after { border: 0; }
	.history-job-publish-button:hover { background: #d95f0b; }
	.history-job-picker-error { color: #c65d5d; cursor: pointer; }
	.history-job-picker-list { max-height: 420px; }
	.history-job-picker-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		box-sizing: border-box;
		width: 100%;
		min-height: 64px;
		padding: 12px 8px;
		border: 0;
		border-bottom: 1px solid #f0f2f4;
		text-align: left;
		background: #fff;
		cursor: pointer;
	}
	.history-job-picker-item::after { border: 0; }
	.history-job-picker-item:hover { background: #fff6f0; }
	.history-job-picker-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: #333b42; }
	.history-job-picker-detail { flex: 0 0 auto; max-width: 58%; margin-left: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: #7d8790; }

	.empty-state {
		display: flex;
		align-items: center;
		flex-direction: column;
		padding-top: 70px;
	}

	.report-modal-mask {
		position: fixed;
		z-index: 30;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, .32);
	}

	.report-modal {
		position: relative;
		box-sizing: border-box;
		width: min(650px, calc(100vw - 80px));
		height: min(400px, calc(100vh - 80px));
		background: #fff;
		box-shadow: 0 8px 28px rgba(0, 0, 0, .22);
	}

	.report-modal-frame {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		background: #fff;
	}

	.report-modal-close {
		position: absolute;
		top: -22px;
		right: -42px;
		z-index: 1;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		font-size: 32px;
		font-weight: 300;
		line-height: 30px;
		color: #fff;
		background: transparent;
		cursor: pointer;
	}

	.report-modal-close::after {
		border: 0;
	}

	.report-modal-close:hover {
		color: #e8edf3;
	}

	.empty-image {
		display: block;
		width: 330px;
		height: 175px;
	}

	.empty-tip {
		margin-top: 5px;
		font-size: 14px;
		line-height: 20px;
		color: #59626b;
	}

	.search-button {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 114px;
		height: 36px;
		margin-top: 29px;
		font-size: 18px;
		font-weight: 700;
		color: #ffffff;
		background: #f66b20;
		cursor: pointer;
		transition: background-color 0.15s ease;

		&:hover {
			background: #ed5e15;
		}
	}
</style>
