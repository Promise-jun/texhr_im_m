<template>
	<view class="chat-list-page">
		<view class="navigation-bar">
			<view class="back-button" aria-label="返回" @click="navigateBack">
				<text class="back-icon"></text>
			</view>
			<view class="navigation-title-wrap">
				<text class="navigation-title">消息列表</text>
				<!-- 全局新消息提示：即使 SDK 会话未及时回推未读数，也先给出红点反馈。 -->
				<text v-if="hasNewMessage" class="navigation-dot"></text>
			</view>
		</view>

		<view class="tabs">
			<view v-for="tab in tabs" :key="tab.key" class="tab-item" :class="{ active: activeTab === tab.key }"
				@click="activeTab = tab.key">
				{{ tab.label }}
			</view>
		</view>

		<view class="conversation-list">
			<view v-for="conversation in visibleConversations" :key="conversation.id" class="conversation-swipe-item"
				@touchstart="handleSwipeStart($event, conversation)" @touchmove="handleSwipeMove"
				@touchend="handleSwipeEnd($event, conversation)" @touchcancel="handleSwipeCancel">
				<view v-if="!conversation.isHistory" class="conversation-actions">
					<view class="conversation-action stick-action" @click.stop="toggleConversationStickTop(conversation)">
						<text>{{ conversation.stickTop ? '取消\n置顶' : '置顶' }}</text>
					</view>
					<view class="conversation-action delete-action" @click.stop="confirmDeleteConversation(conversation)">
						<text>删除</text>
					</view>
				</view>
			<view class="conversation-item" :class="{ 'is-stick-top': conversation.stickTop }"
				:style="getConversationItemStyle(conversation)" @click="openConversation(conversation)">
				<image v-if="conversation.stickTop" src="/static/icon_top.png" class="top-icon" mode="aspectFit"></image>
				<view class="avatar-wrap">
					<image :src="conversation.avatar" class="avatar" mode="aspectFill"></image>
					<text v-if="conversation.unreadCount > 0 || conversation.hasNewMessage" class="unread-badge"
						:class="{ 'is-muted': conversation.mute, 'is-dot': conversation.hasNewMessage && conversation.unreadCount <= 0 }">
						{{ conversation.mute || conversation.unreadCount <= 0 ? '' : conversation.unreadText }}
					</text>
				</view>
				<view class="conversation-content">
					<view class="conversation-heading">
						<text class="company-name">{{ conversation.name }}</text>
						<text class="time">{{ conversation.time }}</text>
					</view>
					<view class="message-row">
						<text class="message">{{ conversation.message }}</text>
					</view>
				</view>
			</view>
			</view>

			<view v-if="visibleIsLoading && !visibleConversations.length" class="list-state">
				<text>正在加载会话...</text>
			</view>
			<view v-else-if="visibleLoadError && !visibleConversations.length" class="list-state is-error"
				@click="retryVisibleConversations">
				<text>{{ visibleLoadError }}，点击重试</text>
			</view>
			<view v-else-if="!visibleConversations.length" class="list-state">
				<text>{{ activeTab === 'recent' ? '七天内暂无会话' : '暂无历史会话' }}</text>
			</view>
		</view>
	</view>
</template>

<script>
	import {
		NIM_EVENT,
		getActiveConversationId,
		getNimInstance,
		getNimLoginError,
		isNimLoggedIn
	} from '../../../services/nim'
	import {
		getAllHistoryConversations,
		getAllNimConversations,
		markNimConversationRead,
		normalizeAndSortConversations
	} from '../../../services/conversation'
	import {
		requestApi
	} from '../../../services/request'

	const CHAT_SAVE_API = 'Chat.Chat.Save'
	const CHAT_DELETE_API = 'Chat.Chat.Delete'
	const CHAT_GET_SINGLE_API = 'Chat.Chat.GetSingleChat'

	function parseResponseData(data, errorMessage = '接口返回的数据格式不正确') {
		if (typeof data !== 'string') return data || {}
		if (!data.trim()) return {}

		try {
			return JSON.parse(data) || {}
		} catch (error) {
			throw new Error(errorMessage)
		}
	}

	export default {
		data() {
			return {
				activeTab: 'recent',
				tabs: [{
						key: 'recent',
						label: '七天内会话'
					},
					{
						key: 'history',
						label: '历史会话'
					}
				],
				rawConversations: [],
				historyConversations: [],
				isLoading: true,
				isHistoryLoading: true,
				loadError: '',
				historyLoadError: '',
				currentTime: Date.now(),
				swipeConversationId: '',
				swipeOffset: 0,
				swipeTransitionEnabled: true,
				updatingPinConversationId: '',
				deletingConversationId: '',
				openingConversationId: '',
				// 新消息事件是页面级兜底状态，列表项上的 hasNewMessage 会进一步定位到具体会话。
				hasNewMessage: false
			}
		},
		computed: {
			conversationList() {
				return normalizeAndSortConversations(this.rawConversations, this.currentTime)
			},
			conversations() {
				// “七天内会话”使用 SDK 实时会话；“历史会话”使用 texhr 数据库的全部会话接口。
				return {
					recent: this.conversationList,
					history: this.historyConversations
				}
			},
			visibleConversations() {
				return this.conversations[this.activeTab]
			},
			visibleIsLoading() {
				return this.activeTab === 'history' ? this.isHistoryLoading : this.isLoading
			},
			visibleLoadError() {
				return this.activeTab === 'history' ? this.historyLoadError : this.loadError
			}
		},
		async onLoad() {
			this._conversationPageAlive = true
			this.bindConversationEvents()
		},
		onShow() {
			// 从聊天页返回时同时刷新 SDK 实时会话与 texhr 历史会话。
			this.currentTime = Date.now()
			this.loadConversations()
			this.loadHistoryConversations()
		},
		onUnload() {
			this._conversationPageAlive = false
			this.unbindConversationEvents()
			if (this._conversationRefreshTimer) clearTimeout(this._conversationRefreshTimer)
		},
		methods: {
			getTouchPoint(event) {
				const touch = event && ((event.touches && event.touches[0]) ||
					(event.changedTouches && event.changedTouches[0]))
				if (!touch) return null
				return {
					x: touch.clientX !== undefined ? touch.clientX : touch.pageX,
					y: touch.clientY !== undefined ? touch.clientY : touch.pageY
				}
			},
			getSwipeActionWidth() {
				if (!this._swipeActionWidth) {
					this._swipeActionWidth = typeof uni !== 'undefined' && typeof uni.upx2px === 'function' ?
						uni.upx2px(160) : 160
				}
				return this._swipeActionWidth
			},
			getConversationItemStyle(conversation) {
				const offset = this.swipeConversationId === conversation.id ? this.swipeOffset : 0
				return {
					transform: `translate3d(${offset}px, 0, 0)`,
					transition: this.swipeTransitionEnabled ? 'transform 180ms ease-out' : 'none'
				}
			},
			handleSwipeStart(event, conversation) {
				const touch = this.getTouchPoint(event)
				if (!touch) return
				if (conversation.isHistory) {
					this.closeSwipedConversation()
					return
				}
				if (this.swipeConversationId && this.swipeConversationId !== conversation.id) {
					this.closeSwipedConversation()
				}

				this.swipeTransitionEnabled = false
				this._swipeTouch = {
					conversationId: conversation.id,
					startX: touch.x,
					startY: touch.y,
					startOffset: this.swipeConversationId === conversation.id ? this.swipeOffset : 0,
					isHorizontal: false
				}
			},
			handleSwipeMove(event) {
				const gesture = this._swipeTouch
				const touch = this.getTouchPoint(event)
				if (!gesture || !touch) return

				const deltaX = touch.x - gesture.startX
				const deltaY = touch.y - gesture.startY
				if (!gesture.isHorizontal) {
					if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) {
						this._swipeTouch = null
						this.closeSwipedConversation()
						return
					}
					if (Math.abs(deltaX) < 8) return
					gesture.isHorizontal = true
				}

				this.swipeConversationId = gesture.conversationId
				this.swipeTransitionEnabled = false
				const maxOffset = this.getSwipeActionWidth()
				this.swipeOffset = Math.max(-maxOffset, Math.min(0, gesture.startOffset + deltaX))
			},
			handleSwipeEnd(event, conversation) {
				const gesture = this._swipeTouch
				if (!gesture || gesture.conversationId !== conversation.id) return
				this._swipeTouch = null
				if (!gesture.isHorizontal) {
					this.swipeTransitionEnabled = true
					return
				}

				const shouldOpen = this.swipeOffset <= -this.getSwipeActionWidth() / 2
				this.swipeTransitionEnabled = true
				this.swipeOffset = shouldOpen ? -this.getSwipeActionWidth() : 0
				this._ignoreConversationClick = true
				setTimeout(() => {
					this._ignoreConversationClick = false
				}, 220)
			},
			handleSwipeCancel() {
				this._swipeTouch = null
				this.closeSwipedConversation()
			},
			closeSwipedConversation() {
				this.swipeTransitionEnabled = true
				this.swipeConversationId = ''
				this.swipeOffset = 0
			},
			async toggleConversationStickTop(conversation) {
				if (!conversation || conversation.isHistory || !conversation.id || this.updatingPinConversationId ||
					this.deletingConversationId) return
				if (!isNimLoggedIn()) {
					uni.showToast({ title: '聊天服务尚未就绪', icon: 'none' })
					return
				}

				const loginService = getNimInstance().V2NIMLoginService
				const personAccId = loginService && typeof loginService.getLoginUser === 'function' ?
					String(loginService.getLoginUser() || '').trim() : ''
				const enterpriseAccId = conversation.targetId ? String(conversation.targetId).trim() : ''
				if (!personAccId || !enterpriseAccId) {
					uni.showToast({ title: '未获取到会话账号信息', icon: 'none' })
					return
				}

				const shouldStickTop = !conversation.stickTop
				let businessUpdated = false
				let toastTitle = ''
				this.updatingPinConversationId = conversation.id
				this.closeSwipedConversation()
				uni.showLoading({
					title: shouldStickTop ? '置顶中' : '取消中',
					mask: true
				})
				try {
					const response = await requestApi({
						Name: CHAT_SAVE_API,
						Content: {
							EnterpriseAccId: enterpriseAccId,
							PersonAccId: personAccId,
							IsTop: shouldStickTop
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

					// 业务接口保存成功后同步网易云本地会话，保持与 chat.vue 一致。
					businessUpdated = true
					this.rawConversations = this.rawConversations.map(item => item.conversationId === conversation.id ?
						{ ...item, stickTop: shouldStickTop } : item)
					this.currentTime = Date.now()

					const conversationService = getNimInstance().V2NIMLocalConversationService
					if (!conversationService || typeof conversationService.stickTopConversation !== 'function') {
						throw new Error('当前网易云信 SDK 不支持会话置顶')
					}
					await conversationService.stickTopConversation(conversation.id, shouldStickTop)
					toastTitle = shouldStickTop ? '会话已置顶' : '已取消置顶'
				} catch (error) {
					toastTitle = businessUpdated ?
						'状态已保存，会话列表同步失败' :
						error && error.message ? error.message : '更新置顶状态失败'
					console.error('[NIM] 更新会话置顶状态失败', error)
				} finally {
					uni.hideLoading()
					this.updatingPinConversationId = ''
				}

				if (toastTitle) {
					uni.showToast({
						title: toastTitle,
						icon: 'none'
					})
				}
			},
			confirmDeleteConversation(conversation) {
				if (!conversation || conversation.isHistory || !conversation.id || this.deletingConversationId ||
					this.updatingPinConversationId) return
				this.closeSwipedConversation()
				uni.showModal({
					title: '提示',
					content: '确认删除该条会话所有聊天记录吗？',
					confirmText: '确认删除',
					confirmColor: '#ff5a00',
					success: result => {
						if (result.confirm) this.deleteConversation(conversation)
					}
				})
			},
			async deleteConversation(conversation) {
				if (!conversation || conversation.isHistory || !conversation.id || this.deletingConversationId) return
				if (!isNimLoggedIn()) {
					uni.showToast({ title: '聊天服务尚未就绪', icon: 'none' })
					return
				}

				const nim = getNimInstance()
				const loginService = nim.V2NIMLoginService
				const personAccId = loginService && typeof loginService.getLoginUser === 'function' ?
					String(loginService.getLoginUser() || '').trim() : ''
				const enterpriseAccId = conversation.targetId ? String(conversation.targetId).trim() : ''
				if (!personAccId || !enterpriseAccId) {
					uni.showToast({ title: '未获取到会话账号信息', icon: 'none' })
					return
				}

				const conversationService = nim.V2NIMLocalConversationService
				const messageService = nim.V2NIMMessageService
				if (!conversationService || typeof conversationService.deleteConversation !== 'function') {
					uni.showToast({ title: '当前聊天服务不支持删除会话', icon: 'none' })
					return
				}
				if (!messageService || typeof messageService.clearHistoryMessage !== 'function') {
					uni.showToast({ title: '当前聊天服务不支持清空历史消息', icon: 'none' })
					return
				}
				if (conversation.stickTop && typeof conversationService.stickTopConversation !== 'function') {
					uni.showToast({ title: '当前聊天服务不支持取消置顶', icon: 'none' })
					return
				}

				this.closeSwipedConversation()
				this.deletingConversationId = conversation.id
				let businessDeleted = false
				let historyCleared = false
				let toastTitle = ''
				uni.showLoading({ title: '删除中', mask: true })
				try {
					const response = await requestApi({
						Name: CHAT_DELETE_API,
						Content: {
							EnterpriseAccId: enterpriseAccId,
							PersonAccId: personAccId
						}
					})
					const responseCode = response && response.Code !== undefined ? Number(response.Code) : NaN
					if (!response || responseCode !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`删除会话失败，业务错误码：${code}`)
					}

					const data = parseResponseData(response.Data, '删除会话接口返回的数据格式不正确')
					if (data.Code !== undefined && Number(data.Code) !== 0) {
						throw new Error(`删除会话失败，数据错误码：${data.Code}`)
					}
					businessDeleted = true

					// 网易云删除置顶会话前先取消置顶，再清空 p2p 会话历史消息。
					if (conversation.stickTop) {
						await conversationService.stickTopConversation(conversation.id, false)
						this.rawConversations = this.rawConversations.map(item => item.conversationId === conversation.id ?
							{ ...item, stickTop: false } : item)
					}
					await messageService.clearHistoryMessage({ conversationId: conversation.id })
					historyCleared = true
					await conversationService.deleteConversation(conversation.id, true)
					if (this._newConversationIds) this._newConversationIds.delete(String(conversation.id))
					this.rawConversations = this.rawConversations.filter(item => item.conversationId !== conversation.id)
					this.refreshGlobalNewMessageIndicator()
					toastTitle = '会话已删除'
				} catch (error) {
					toastTitle = !businessDeleted ?
						(error && error.message ? error.message : '删除会话失败') :
						(historyCleared ? '聊天记录已删除，网易云会话同步失败' :
							'业务会话已删除，网易云历史消息清理失败')
					console.error('[NIM] 删除会话失败', error)
				} finally {
					uni.hideLoading()
					this.deletingConversationId = ''
				}

				if (toastTitle) {
					uni.showToast({
						title: toastTitle,
						icon: 'none'
					})
				}
			},
			bindConversationEvents() {
				// SDK 首次同步、登录完成以及增删改都会驱动列表更新。
				uni.$on(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
				uni.$on(NIM_EVENT.LOGIN_FAILED, this.handleNimLoginFailed)
				uni.$on(NIM_EVENT.CONVERSATION_SYNC_FINISHED, this.scheduleConversationReload)
				uni.$on(NIM_EVENT.CONVERSATION_SYNC_FAILED, this.handleConversationLoadFailed)
				uni.$on(NIM_EVENT.CONVERSATION_CREATED, this.handleConversationCreated)
				uni.$on(NIM_EVENT.CONVERSATION_CHANGED, this.handleConversationChanged)
				uni.$on(NIM_EVENT.CONVERSATION_DELETED, this.handleConversationDeleted)
				uni.$on(NIM_EVENT.MESSAGE_RECEIVED, this.handleMessageReceived)
			},
			unbindConversationEvents() {
				uni.$off(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
				uni.$off(NIM_EVENT.LOGIN_FAILED, this.handleNimLoginFailed)
				uni.$off(NIM_EVENT.CONVERSATION_SYNC_FINISHED, this.scheduleConversationReload)
				uni.$off(NIM_EVENT.CONVERSATION_SYNC_FAILED, this.handleConversationLoadFailed)
				uni.$off(NIM_EVENT.CONVERSATION_CREATED, this.handleConversationCreated)
				uni.$off(NIM_EVENT.CONVERSATION_CHANGED, this.handleConversationChanged)
				uni.$off(NIM_EVENT.CONVERSATION_DELETED, this.handleConversationDeleted)
				uni.$off(NIM_EVENT.MESSAGE_RECEIVED, this.handleMessageReceived)
			},
			handleLoginStatus(status) {
				if (status !== 1) return
				this.scheduleConversationReload()
				this.loadHistoryConversations()
			},
			handleNimLoginFailed(error) {
				this.handleConversationLoadFailed(error)
				this.isHistoryLoading = false
				this.historyLoadError = error && (error.message || error.desc) ?
					error.message || error.desc :
					'历史会话加载失败'
			},
			handleConversationLoadFailed(error) {
				this.isLoading = false
				this.loadError = error && (error.message || error.desc) ?
					error.message || error.desc :
					'会话加载失败'
			},
			handleConversationCreated(conversation) {
				this.upsertConversations([conversation])
			},
			handleConversationChanged(conversationList) {
				this.upsertConversations(conversationList)
			},
			handleConversationDeleted(conversationIds) {
				const deletedIdSet = new Set(Array.isArray(conversationIds) ? conversationIds : [])
				if (this._newConversationIds) {
					deletedIdSet.forEach(conversationId => this._newConversationIds.delete(String(conversationId)))
				}
				this.rawConversations = this.rawConversations.filter(conversation => {
					return !deletedIdSet.has(conversation.conversationId)
				})
				this.refreshGlobalNewMessageIndicator()
				if (this._conversationLoadPromise) this._conversationReloadPending = true
			},
			handleMessageReceived(messageList) {
				const activeConversationId = getActiveConversationId()
				// 当前聊天页会自己消费当前会话消息；消息列表只提示其它会话，避免重复红点。
				const otherConversationMessages = (Array.isArray(messageList) ? messageList : [])
					.filter(message => message && !message.isSelf && message.conversationId &&
						message.conversationId !== activeConversationId)
				if (!otherConversationMessages.length) return

				this.hasNewMessage = true
				const changedIds = new Set(otherConversationMessages.map(message => String(message.conversationId)))
				this._newConversationIds = this._newConversationIds || new Set()
				changedIds.forEach(conversationId => this._newConversationIds.add(conversationId))
				this.rawConversations = this.rawConversations.map(conversation => {
					if (!conversation || !changedIds.has(String(conversation.conversationId))) return conversation
					return { ...conversation, hasNewMessage: true }
				})
				// 拉取最新会话可同步新会话、消息摘要、时间和排序；定时器会合并同批消息的重复刷新。
				this.scheduleConversationReload()
			},
			upsertConversations(conversationList) {
				if (!Array.isArray(conversationList) || !conversationList.length) return

				const conversationMap = new Map(
					this.rawConversations.map(conversation => [conversation.conversationId, conversation])
				)
				conversationList.forEach(conversation => {
					if (!conversation || !conversation.conversationId) return
					const previous = conversationMap.get(conversation.conversationId) || {}
					const isTrackedNewMessage = this._newConversationIds &&
						this._newConversationIds.has(String(conversation.conversationId))
					conversationMap.set(conversation.conversationId, {
						...previous,
						...conversation,
						// 会话变更事件通常不携带页面兜底标记，不能覆盖已收到的新消息红点。
						hasNewMessage: conversation.hasNewMessage === undefined ?
							Boolean(previous.hasNewMessage || isTrackedNewMessage) : Boolean(conversation.hasNewMessage)
					})
				})

				this.currentTime = Date.now()
				this.rawConversations = Array.from(conversationMap.values())
				this.refreshGlobalNewMessageIndicator()
				if (this._conversationLoadPromise) this._conversationReloadPending = true
			},
			scheduleConversationReload() {
				if (this._conversationRefreshTimer) clearTimeout(this._conversationRefreshTimer)
				// 合并同一批同步产生的多个通知，避免短时间重复分页拉取。
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
					// App.vue 正在异步登录时保留加载态，成功后由 LOGIN_STATUS 再次触发。
					this.isLoading = !this.rawConversations.length
					return
				}
				if (this._conversationLoadPromise) {
					this._conversationReloadPending = true
					return this._conversationLoadPromise
				}

				this.isLoading = !this.rawConversations.length
				this.loadError = ''
				this._conversationLoadPromise = getAllNimConversations()
					.then(conversationList => {
						if (!this._conversationPageAlive) return
						this.currentTime = Date.now()
						const previousFlags = new Map(this.rawConversations.map(conversation => [
							conversation.conversationId,
							Boolean(conversation.hasNewMessage)
						]))
						this.rawConversations = conversationList.map(conversation => ({
							...conversation,
							hasNewMessage: previousFlags.get(conversation.conversationId) ||
								(this._newConversationIds && this._newConversationIds.has(String(conversation.conversationId))) || false
						}))
						this.refreshGlobalNewMessageIndicator()
					})
					.catch(error => {
						if (!this._conversationPageAlive) return
						console.error('[NIM] 获取会话列表失败', error)
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
			async loadHistoryConversations() {
				if (!this._conversationPageAlive) return
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
				this._historyConversationLoadPromise = getAllHistoryConversations()
					.then(conversationList => {
						if (!this._conversationPageAlive) return
						this.historyConversations = conversationList
					})
					.catch(error => {
						if (!this._conversationPageAlive) return
						console.error('[NIM] 获取历史会话列表失败', error)
						this.historyLoadError = error && error.message ?
							error.message :
							'历史会话加载失败'
					})
					.finally(() => {
						if (this._conversationPageAlive) this.isHistoryLoading = false
						this._historyConversationLoadPromise = null
					})

				return this._historyConversationLoadPromise
			},
			retryVisibleConversations() {
				if (this.activeTab === 'history') {
					this.loadHistoryConversations()
					return
				}
				this.loadConversations()
			},
			navigateBack() {
				const pages = getCurrentPages()
				if (pages.length > 1) {
					uni.navigateBack()
				}
			},

			async openConversation(conversation) {
				if (this._ignoreConversationClick) return
				if (this.swipeConversationId) {
					this.closeSwipedConversation()
					return
				}
				if (!conversation || !conversation.id || this.openingConversationId) return
				if (!isNimLoggedIn()) {
					uni.showToast({ title: '聊天服务尚未就绪', icon: 'none' })
					return
				}

				const nim = getNimInstance()
				const loginService = nim.V2NIMLoginService
				const personAccId = loginService && typeof loginService.getLoginUser === 'function' ?
					String(loginService.getLoginUser() || '').trim() : ''
				const enterpriseAccId = conversation.targetId ? String(conversation.targetId).trim() : ''
				if (!personAccId || !enterpriseAccId) {
					uni.showToast({ title: '未获取到会话账号信息', icon: 'none' })
					return
				}

				this.openingConversationId = conversation.id
				uni.showLoading({ title: '加载中', mask: true })
				try {
					const response = await requestApi({
						Name: CHAT_GET_SINGLE_API,
						Content: {
							PersonAccId: personAccId,
							EnterpriseAccId: enterpriseAccId
						}
					})
					const responseCode = response && response.Code !== undefined ? Number(response.Code) : NaN
					if (!response || responseCode !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`获取会话信息失败，业务错误码：${code}`)
					}

					const data = parseResponseData(response.Data, '获取会话信息接口返回的数据格式不正确')
					if (data.Code !== undefined && Number(data.Code) !== 0) {
						throw new Error(`获取会话信息失败，数据错误码：${data.Code}`)
					}
					const jobValue = data.JobId !== undefined ? data.JobId : response.JobId
					const resumeValue = data.ResumeId !== undefined ? data.ResumeId : response.ResumeId
					const jobId = jobValue !== undefined && jobValue !== null ? String(jobValue).trim() : ''
					const resumeId = resumeValue !== undefined && resumeValue !== null ? String(resumeValue).trim() : ''
					if (!jobId || !resumeId) throw new Error('获取会话信息失败：未返回 JobId 或 ResumeId')

					const url = `/pages/person/m/chat?jobId=${encodeURIComponent(jobId)}&resumeId=${encodeURIComponent(resumeId)}`
					uni.navigateTo({
						url,
						success: () => {
							this.clearNewMessageIndicator(conversation.id)
							// 用户已进入会话，清除未读数；SDK 变更事件会同步刷新列表红点。
							if (conversation.isHistory) return
							markNimConversationRead(conversation.id).catch(error => {
								console.warn('[NIM] 标记会话已读失败', error)
							})
						},
						fail: error => {
							console.error('[NIM] 打开聊天页面失败', error)
							uni.showToast({ title: '打开聊天页面失败', icon: 'none' })
						}
					})
				} catch (error) {
					console.error('[NIM] 获取会话详情失败', error)
					uni.showToast({
						title: error && error.message ? error.message : '获取会话信息失败',
						icon: 'none'
					})
				} finally {
					uni.hideLoading()
					this.openingConversationId = ''
				}
			},
			clearNewMessageIndicator(conversationId) {
				if (!conversationId) return
				if (this._newConversationIds) this._newConversationIds.delete(String(conversationId))
				this.rawConversations = this.rawConversations.map(conversation => {
					if (!conversation || conversation.conversationId !== conversationId) return conversation
					return { ...conversation, hasNewMessage: false }
				})
				this.refreshGlobalNewMessageIndicator()
			},
			refreshGlobalNewMessageIndicator() {
				const activeConversationId = getActiveConversationId()
				const hasTrackedMessage = this._newConversationIds && Array.from(this._newConversationIds)
					.some(conversationId => conversationId !== activeConversationId)
				this.hasNewMessage = this.rawConversations.some(conversation => {
					return conversation && conversation.conversationId !== activeConversationId &&
						(Boolean(conversation.hasNewMessage) || Number(conversation.unreadCount) > 0)
				}) || Boolean(hasTrackedMessage)
			}
		}
	}
</script>

<style lang="scss" scoped>
	.chat-list-page {
		min-height: 100vh;
		box-sizing: border-box;
		padding-top: 168rpx;
		background: #ffffff;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		color: #222222;

		.navigation-bar {
			position: fixed;
			top: 0;
			right: 0;
			left: 0;
			z-index: 20;
			display: flex;
			align-items: center;
			justify-content: center;
			box-sizing: border-box;
			height: 88rpx;
			background: #ffffff;
			border-bottom: 1rpx solid #eeeeee;

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
					width: 16rpx;
					height: 16rpx;
					border-bottom: 2rpx solid #333333;
					border-left: 2rpx solid #333333;
					transform: rotate(45deg);
				}
			}

			.navigation-title {
				font-size: 32rpx;
				font-weight: 400;
				color: #222222;
			}

			.navigation-title-wrap {
				position: relative;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			.navigation-dot {
				position: absolute;
				top: -4rpx;
				right: -18rpx;
				width: 14rpx;
				height: 14rpx;
				background: #f04444;
				border: 2rpx solid #ffffff;
				border-radius: 50%;
			}
		}

		.tabs {
			position: fixed;
			top: 88rpx;
			right: 0;
			left: 0;
			z-index: 19;
			display: flex;
			height: 80rpx;
			background: #ffffff;

			.tab-item {
				position: relative;
				display: flex;
				align-items: center;
				justify-content: center;
				width: 220rpx;
				height: 80rpx;
				font-size: 30rpx;
				font-weight: 600;
				color: #8c8c8c;

				&.active {
					color: #111111;

					&::after {
						position: absolute;
						bottom: 0;
						left: 50%;
						width: 70rpx;
						height: 4rpx;
						background: #1d9bf0;
						border-radius: 4rpx;
						content: '';
						transform: translateX(-50%);
					}
				}
			}
		}

		.conversation-list {
			background: #ffffff;
			padding: 20rpx 0;

			.conversation-swipe-item {
				position: relative;
				overflow: hidden;
				width: 100%;
			}

			.conversation-actions {
				position: absolute;
				top: 0;
				right: 0;
				bottom: 0;
				display: flex;
				width: 160rpx;
				height: 100%;

				.conversation-action {
					display: flex;
					align-items: center;
					justify-content: center;
					width: 80rpx;
					font-size: 24rpx;
					line-height: 32rpx;
					text-align: center;
					color: #ffffff;
					white-space: pre-line;

					&.stick-action {
						background: #aebbc4;
					}

					&.delete-action {
						background: #ff5a00;
					}
				}
			}

			.conversation-item {
				position: relative;
				z-index: 1;
				display: flex;
				box-sizing: border-box;
				width: 100%;
				padding: 28rpx;
				background: #ffffff;

				&.is-stick-top {
					background: #f7f7f7;
				}

				.top-icon {
					position: absolute;
					top: 0;
					right: 0;
					z-index: 2;
					width: 30rpx;
					height: 30rpx;
				}

				.avatar-wrap {
					position: relative;
					flex-shrink: 0;
					width: 80rpx;
					height: 80rpx;
					margin: 0 20rpx 0 0;

					.avatar {
						display: block;
						width: 80rpx;
						height: 80rpx;
						background: #f2f2f2;
						border-radius: 50%;
					}

					.unread-badge {
						position: absolute;
						top: -12rpx;
						right: -12rpx;
						display: flex;
						align-items: center;
						justify-content: center;
						box-sizing: border-box;
						min-width: 32rpx;
						height: 32rpx;
						padding: 0 8rpx;
						font-size: 20rpx;
						line-height: 32rpx;
						color: #ffffff;
						background: #f04444;
						border: 2rpx solid #ffffff;
						border-radius: 18rpx;

						&.is-muted {
							top: -2rpx;
							right: -2rpx;
							min-width: 16rpx;
							width: 16rpx;
							height: 16rpx;
							padding: 0;
						}

						&.is-dot {
							min-width: 16rpx;
							width: 16rpx;
							height: 16rpx;
							padding: 0;
							border-radius: 50%;
						}
					}
				}

				.conversation-content {
					flex: 1;
					min-width: 0;
					padding-top: 1rpx;

					.conversation-heading,
					.message-row {
						display: flex;
						align-items: center;
					}

					.conversation-heading {
						justify-content: space-between;
						min-width: 0;

						.company-name {
							min-width: 0;
							overflow: hidden;
							font-size: 28rpx;
							font-weight: 400;
							text-overflow: ellipsis;
							white-space: nowrap;
							color: #313131;
						}

						.time {
							flex-shrink: 0;
							margin-left: 12rpx;
							font-size: 22rpx;
							color: #888888;
						}
					}

					.message-row {
						margin-top: 8rpx;

						.message {
							overflow: hidden;
							font-size: 24rpx;
							text-overflow: ellipsis;
							white-space: nowrap;
							color: #888888;
						}
					}
				}
			}

			.list-state {
				display: flex;
				align-items: center;
				justify-content: center;
				height: 240rpx;
				font-size: 26rpx;
				color: #999999;

				&.is-error {
					color: #1d9bf0;
				}
			}
		}
	}
</style>
