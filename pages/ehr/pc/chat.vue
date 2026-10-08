<template>
	<view class="pc-chat-page">
		<view class="chat-shell">
			<view class="top-bar">
				<view class="main-tabs">
					<view v-for="tab in mainTabs" :key="tab.key" class="main-tab"
						:class="{ 'main-tab--active': activeMainTab === tab.key }" @click="activeMainTab = tab.key">
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
							class="conversation-item" :class="{ 'conversation-item--selected': selectedId === conversation.id }"
							@click="selectConversation(conversation)">
							<image src="/static/default_avatar.png" class="avatar" mode="aspectFill"></image>
							<view class="conversation-copy">
								<text class="conversation-name">{{ conversation.name }}</text>
								<text class="conversation-preview">{{ conversation.preview }}</text>
							</view>
							<view class="conversation-meta">
								<text class="conversation-time">{{ conversation.time }}</text>
								<text v-if="conversation.unread" class="unread-badge">{{ conversation.unread }}</text>
							</view>
						</view>

						<view v-if="!visibleConversations.length" class="conversation-empty">
							{{ activeMainTab === 'recent' && activeMessageTab === 'unread' ? '暂无未读消息' : '暂无会话' }}
						</view>
					</view>
				</view>

				<view class="chat-content">
					<view class="empty-state">
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
	export default {
		data() {
			return {
				activeMainTab: 'recent',
				activeMessageTab: 'all',
				selectedId: '',
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
				],
				conversations: [{
						id: 1,
						name: '智联叶子',
						preview: '我正在求职，请问…',
						time: '昨天',
						unread: 0,
						pinned: true
					},
					{
						id: 2,
						name: '苏珊娜测试',
						preview: '当前不再考虑新机…',
						time: '昨天',
						unread: 3
					},
					{
						id: 3,
						name: '测试戴',
						preview: '我正在求职，请问…',
						time: '昨天',
						unread: 1
					},
					{
						id: 4,
						name: '金华智联信息科技…',
						preview: '好久没互动了，我…',
						time: '08-20',
						unread: 0
					}
				]
			}
		},
		computed: {
			unreadTotal() {
				return this.conversations.reduce((total, conversation) => total + Number(conversation.unread || 0), 0)
			},
			visibleConversations() {
				if (this.activeMainTab === 'history') return []
				if (this.activeMessageTab === 'unread') {
					return this.conversations.filter(conversation => conversation.unread > 0)
				}
				return this.conversations
			}
		},
		methods: {
			selectConversation(conversation) {
				this.selectedId = conversation.id
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
		flex: 0 0 54px;
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
	}

	.conversation-empty {
		padding-top: 46px;
		font-size: 14px;
		text-align: center;
		color: #a4a9ae;
	}

	.chat-content {
		position: relative;
		flex: 1;
		height: 100%;
		border-radius: 6px 6px 0 0;
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
