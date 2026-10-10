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
					<text class="phone-icon">☎</text>
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
							class="conversation-item" :class="{ 'conversation-item--selected': selectedId === conversation.id,
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

						<view v-if="activeMainTab === 'recent' && isLoading && !visibleConversations.length"
							class="conversation-empty">
							正在加载会话...
						</view>
						<view v-else-if="activeMainTab === 'recent' && loadError && !visibleConversations.length"
							class="conversation-empty conversation-empty--error" @click="loadConversations">
							{{ loadError }}，点击重试
						</view>
						<view v-else-if="!visibleConversations.length" class="conversation-empty">
							{{ activeMainTab === 'recent' && activeMessageTab === 'unread' ? '暂无未读消息' : '暂无会话' }}
						</view>
					</view>
				</view>

				<view class="chat-content">
					<!-- 只有业务接口成功后才创建聊天组件，显式传入职位、简历及双方云信账号。 -->
					<pc-chat-panel v-if="chatDetail && activeMainTab === 'recent'" :key="chatDetail.conversationId + '-' + chatDetail.jobId"
						:conversation="activeConversation" :job-id="chatDetail.jobId" :resume-id="chatDetail.resumeId"
						:person-acc-id="chatDetail.personAccId" :enterprise-acc-id="chatDetail.enterpriseAccId"
						:detail="chatDetail" :drafts="conversationDrafts" :visible="pageVisible"
						:opening="Boolean(openingConversationId)" @read="handleConversationRead"
						@changed="scheduleConversationReload" @pin-changed="handleConversationPinChanged" @action="handleChatAction" />
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
		normalizeAndSortConversations
	} from '../../../services/conversation'
	import { requestApi } from '../../../services/request'
	import PcChatPanel from '../../../components/pc-chat-panel/pc-chat-panel.vue'

	const DEFAULT_AVATAR = '/static/default_avatar.png'

	export default {
		components: { PcChatPanel },
		data() {
			return {
				activeMainTab: 'recent',
				activeMessageTab: 'all',
				selectedId: '',
				openingConversationId: '',
				chatDetail: null,
				pageVisible: false,
				// 草稿以会话 ID 隔离，切换会话后仍可恢复，异步发送也不会清空其他会话的草稿。
				conversationDrafts: {},
				rawConversations: [],
				isLoading: true,
				loadError: '',
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
				if (this.activeMainTab === 'history') return []
				// 未读页签只判断 SDK 会话未读数，全部页签不做任何时间或未读过滤。
				if (this.activeMessageTab === 'unread') {
					return this.conversations.filter(conversation => conversation.unreadCount > 0)
				}
				return this.conversations
			}
		},
		onLoad() {
			this._conversationPageAlive = true
			this._openConversationRequestId = 0
			this.bindConversationEvents()
		},
		onShow() {
			this.pageVisible = true
			// 页面恢复显示时主动刷新，覆盖页面隐藏期间发生的会话变化。
			this.currentTime = Date.now()
			this.loadConversations()
		},
		onHide() {
			this.pageVisible = false
			this.cancelOpeningConversation()
		},
		onUnload() {
			this._conversationPageAlive = false
			this.pageVisible = false
			this.cancelOpeningConversation()
			this.unbindConversationEvents()
			if (this._conversationRefreshTimer) clearTimeout(this._conversationRefreshTimer)
		},
		methods: {
			bindConversationEvents() {
				// SDK 单例已把原生监听转成 uni 全局事件；页面只负责订阅和在卸载时解绑。
				uni.$on(NIM_EVENT.LOGIN_STATUS, this.handleLoginStatus)
				uni.$on(NIM_EVENT.LOGIN_FAILED, this.handleConversationLoadFailed)
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
				uni.$off(NIM_EVENT.LOGIN_FAILED, this.handleConversationLoadFailed)
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
				if (status === 1) this.scheduleConversationReload()
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
			switchMainTab(key) {
				if (key === this.activeMainTab) return
				this.cancelOpeningConversation()
				this.activeMainTab = key
			},
			async selectConversation(conversation) {
				if (this.activeMainTab !== 'recent' || !conversation || !conversation.id) return
				if (this.openingConversationId === conversation.id) return
				if (this.selectedId === conversation.id && this.chatDetail) {
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
					this.chatDetail = {
						conversationId: conversation.id, conversation, jobId, resumeId, personAccId, enterpriseAccId,
						jobName: data.JobName === undefined || data.JobName === null ? '' : String(data.JobName),
						isPinned: isTop === undefined ? Boolean(conversation.stickTop)
							: isTop === true || Number(isTop) === 1 || String(isTop).toLowerCase() === 'true',
						chatByQRcode: data.ChatByQRcode || ''
					}
					this.selectedId = conversation.id
				} catch (error) {
					if (!isCurrent()) return
					uni.showToast({ title: error && error.message ? error.message : '打开会话失败', icon: 'none' })
				} finally {
					if (isCurrent()) this.openingConversationId = ''
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
				if (action && action.key === 'select-job' && action.job && action.job.jobId) {
					// 选择新职位后重建聊天面板，让它重新调用 Limits 校验新的职位权限。
					this.chatDetail = {
						...this.chatDetail,
						jobId: String(action.job.jobId),
						jobName: action.job.name || ''
					}
					return
				}
				// 其它业务操作统一保留占位提示，避免误认为已经完成对应业务动作。
				uni.showToast({ title: `${action.label}功能暂未接入`, icon: 'none' })
			},
			searchTalent() {
				uni.showToast({
					title: '搜索人才',
					icon: 'none'
				})
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
			color: #0866d9;
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
		margin-right: 7px;
		font-size: 15px;
		line-height: 1;
		transform: rotate(-18deg);
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
			color: #126bd1;

			&::after {
				position: absolute;
				bottom: 0;
				left: 50%;
				width: 14px;
				height: 2px;
				content: '';
				background: #086ee5;
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
			background: #f8fbfe;
		}

		&.conversation-item--opening {
			background: #eef6ff;
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
			color: #126bd1;
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

	.empty-state {
		display: flex;
		align-items: center;
		flex-direction: column;
		padding-top: 70px;
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
