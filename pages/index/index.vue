<template>
	<view class="chat-list-page">
		<view class="navigation-bar">
			<view class="back-button" aria-label="返回" @click="navigateBack">
				<text class="back-icon"></text>
			</view>
			<text class="navigation-title">消息列表</text>
		</view>

		<view class="tabs">
			<view v-for="tab in tabs" :key="tab.key" class="tab-item" :class="{ active: activeTab === tab.key }"
				@click="activeTab = tab.key">
				{{ tab.label }}
			</view>
		</view>

		<view class="conversation-list">
			<view v-for="conversation in visibleConversations" :key="conversation.id" class="conversation-item"
				:class="{ 'is-stick-top': conversation.stickTop }" @click="openConversation(conversation)">
				<view class="avatar-wrap">
					<image :src="conversation.avatar" class="avatar" mode="aspectFill"></image>
					<text v-if="conversation.unreadCount > 0" class="unread-badge"
						:class="{ 'is-muted': conversation.mute }">
						{{ conversation.mute ? '' : conversation.unreadText }}
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
		getNimLoginError,
		isNimLoggedIn
	} from '../../services/nim'
	import {
		getAllHistoryConversations,
		getAllNimConversations,
		markNimConversationRead,
		normalizeAndSortConversations
	} from '../../services/conversation'
	import {
		requestApi
	} from '../../services/request'

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
				currentTime: Date.now()
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
			// try {
			// 	const response = await requestApi({
			// 		Name: "Chat.MyChat.Limits",
			// 		Content: {
			// 			JobId: '86171',
			// 			ResumeId: '155883'
			// 		}
			// 	})
			// 	console.log(123, response)
			// } catch (e) {
			// 	//TODO handle the exception
			// 	console.log(456)
			// }

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
			bindConversationEvents() {
				// SDK 首次同步、登录完成以及增删改都会驱动列表更新。
				uni.$on(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
				uni.$on(NIM_EVENT.LOGIN_FAILED, this.handleNimLoginFailed)
				uni.$on(NIM_EVENT.CONVERSATION_SYNC_FINISHED, this.scheduleConversationReload)
				uni.$on(NIM_EVENT.CONVERSATION_SYNC_FAILED, this.handleConversationLoadFailed)
				uni.$on(NIM_EVENT.CONVERSATION_CREATED, this.handleConversationCreated)
				uni.$on(NIM_EVENT.CONVERSATION_CHANGED, this.handleConversationChanged)
				uni.$on(NIM_EVENT.CONVERSATION_DELETED, this.handleConversationDeleted)
			},
			unbindConversationEvents() {
				uni.$off(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
				uni.$off(NIM_EVENT.LOGIN_FAILED, this.handleNimLoginFailed)
				uni.$off(NIM_EVENT.CONVERSATION_SYNC_FINISHED, this.scheduleConversationReload)
				uni.$off(NIM_EVENT.CONVERSATION_SYNC_FAILED, this.handleConversationLoadFailed)
				uni.$off(NIM_EVENT.CONVERSATION_CREATED, this.handleConversationCreated)
				uni.$off(NIM_EVENT.CONVERSATION_CHANGED, this.handleConversationChanged)
				uni.$off(NIM_EVENT.CONVERSATION_DELETED, this.handleConversationDeleted)
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
				this.rawConversations = this.rawConversations.filter(conversation => {
					return !deletedIdSet.has(conversation.conversationId)
				})
				if (this._conversationLoadPromise) this._conversationReloadPending = true
			},
			upsertConversations(conversationList) {
				if (!Array.isArray(conversationList) || !conversationList.length) return

				const conversationMap = new Map(
					this.rawConversations.map(conversation => [conversation.conversationId, conversation])
				)
				conversationList.forEach(conversation => {
					if (!conversation || !conversation.conversationId) return
					const previous = conversationMap.get(conversation.conversationId) || {}
					conversationMap.set(conversation.conversationId, {
						...previous,
						...conversation
					})
				})

				this.currentTime = Date.now()
				this.rawConversations = Array.from(conversationMap.values())
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
						this.rawConversations = conversationList
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

			openConversation(conversation) {
				uni.navigateTo({
					url: `/pages/chat/chat?id=${encodeURIComponent(conversation.id)}&name=${encodeURIComponent(conversation.name)}`,
					success: () => {
						// 用户已进入会话，清除未读数；SDK 变更事件会同步刷新列表红点。
						if (conversation.isHistory) return
						markNimConversationRead(conversation.id).catch(error => {
							console.warn('[NIM] 标记会话已读失败', error)
						})
					}
				})
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

			.conversation-item {
				display: flex;
				box-sizing: border-box;
				padding: 28rpx;

				&.is-stick-top {
					background: #f7f7f7;
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