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
				<view class="load-status">
					<text v-if="isLoadingHistory">正在加载更早消息...</text>
					<text v-else-if="historyExhausted">没有更早的消息了</text>
					<text v-else>下滑加载更多消息</text>
				</view>

				<template v-for="message in earlierMessages">
					<view v-if="message.type === 'time'" :id="messageAnchor(message.id)" :key="message.id"
						class="time-divider">
						{{ message.content }}
					</view>
					<view v-else :id="messageAnchor(message.id)" :key="message.id" class="message-row"
						:class="message.direction">
						<image src="../../static/default_avatar.png" class="message-avatar" mode="aspectFill"></image>
						<view class="message-bubble">{{ message.content }}</view>
					</view>
				</template>

				<view class="company-card">
					<text class="company-name">金华智联信息科技有限公司</text>
					<view class="company-tags">
						<view class="item">
							<image src="../../static/icon_location.png" style="width: 20rpx; height: 24rpx;"></image>
							<text class="text">西城林芝</text>
						</view>
						<view class="item">
							<image src="../../static/icon_work.png" style="width: 24rpx; height: 22rpx;"></image>
							<text class="text">经验不限</text>
						</view>
						<view class="item">
							<image src="../../static/icon_edu.png" style="width: 24rpx; height: 21rpx;"></image>
							<text class="text">学历不限</text>
						</view>
					</view>
					<view class="contact-row">
						<image src="../../static/default_avatar.png" class="company-logo" mode="aspectFill"></image>
						<text>叶子 叶子</text>
					</view>
					<view class="communication-note">08月13日 10:53由您发起了沟通</view>
				</view>

				<template v-for="message in messages">
					<view v-if="message.type === 'time'" :id="messageAnchor(message.id)" :key="message.id"
						class="time-divider">
						{{ message.content }}
					</view>
					<view v-else :id="messageAnchor(message.id)" :key="message.id" class="message-row"
						:class="message.direction">
						<image src="../../static/default_avatar.png" class="message-avatar" mode="aspectFill"></image>
						<view class="message-bubble">{{ message.content }}</view>
					</view>
				</template>

				<view id="message-bottom" class="message-bottom"></view>
			</view>
		</scroll-view>

		<view class="composer">
			<view class="composer-main">
				<button class="phrase-button" @click="togglePanel('phrases')">常用语</button>
				<input v-model.trim="draft" class="message-input" :focus="inputFocused" confirm-type="send"
					cursor-spacing="18" maxlength="500" placeholder="输入消息" @focus="handleInputFocus"
					@confirm="sendMessage" />
				<image src="../../static/icon_emoji.png" class="round-button" @click="togglePanel('emoji')"></image>
				<button v-if="draft" class="send-button" @click="sendMessage">发送</button>
				<image v-else src="../../static/icon_add.png" class="round-button" @click="togglePanel('more')"></image>
			</view>

			<view v-if="activePanel" class="extension-panel">
				<view v-if="activePanel === 'phrases'" class="phrase-list">
					<view v-for="phrase in commonPhrases" :key="phrase" class="phrase-item" @click="usePhrase(phrase)">
						{{ phrase }}
					</view>
				</view>

				<view v-else-if="activePanel === 'emoji'" class="emoji-list">
					<view v-for="emoji in emojis" :key="emoji" class="emoji-item" @click="appendEmoji(emoji)">
						{{ emoji }}</view>
				</view>

				<view v-else class="more-list">
					<view v-for="item in moreActions" :key="item.key" class="more-item" @click="handleMoreAction(item)">
						<image :src="item.iconUrl" class="more-icon" mode="aspectFill"></image>
						<text>{{ item.label }}</text>
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
				isLoadingHistory: false,
				historyIndex: 0,
				messageSequence: 100,
				earlierMessages: [],
				messages: [{
						id: 1,
						type: 'text',
						direction: 'self',
						content: '您好，我对贵公司职位很感兴趣，希望能有进一步沟通'
					},
					{
						id: 2,
						type: 'text',
						direction: 'self',
						content: '图我'
					},
					{
						id: 3,
						type: 'text',
						direction: 'other',
						content: '你好，对我司该职位感兴趣么？正在急招，请考虑下~'
					},
					{
						id: 4,
						type: 'text',
						direction: 'other',
						content: '图像佳节'
					},
					{
						id: 5,
						type: 'time',
						content: '17:07'
					},
					{
						id: 6,
						type: 'text',
						direction: 'self',
						content: '我正在求职，请问贵公司还招人吗？'
					}
				],
				historyBatches: [
					[{
							id: 'h1',
							type: 'time',
							content: '08月12日 16:42'
						},
						{
							id: 'h2',
							type: 'text',
							direction: 'other',
							content: '您好，看过您的资料，想和您聊聊这个岗位。'
						},
						{
							id: 'h3',
							type: 'text',
							direction: 'self',
							content: '好的，可以先介绍一下工作内容吗？'
						}
					],
					[{
							id: 'h4',
							type: 'time',
							content: '08月11日 09:25'
						},
						{
							id: 'h5',
							type: 'text',
							direction: 'self',
							content: '请问工作地点在哪里？'
						},
						{
							id: 'h6',
							type: 'text',
							direction: 'other',
							content: '工作地点在西城林芝，具体地址面试时可以详聊。'
						}
					]
				],
				commonPhrases: [
					'您好，请问现在方便沟通吗？',
					'方便发一份简历过来吗？',
					'我们可以约个时间面试。',
					'好的，收到后我会尽快回复。'
				],
				emojis: ['😀', '😁', '😂', '😊', '😍', '🤝', '👍', '🎉', '🌹', '加油', '收到', '谢谢'],
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
			historyExhausted() {
				return this.historyIndex >= this.historyBatches.length
			},
			scrollTopStyle() {
				return `calc(${this.statusBarHeight}px + 220rpx)`
			}
		},
		onLoad() {
			const systemInfo = uni.getSystemInfoSync()
			this.statusBarHeight = systemInfo.statusBarHeight || 0
		},
		onReady() {
			this.$nextTick(() => {
				this.scrollToBottom(false)
				setTimeout(() => this.scrollToBottom(false), 60)
			})
		},
		methods: {
			messageAnchor(id) {
				return `message-${id}`
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
			loadEarlierMessages() {
				if (this.isLoadingHistory || this.historyExhausted) return

				this.isLoadingHistory = true
				const anchorMessage = this.earlierMessages[0] || this.messages[0]
				const anchorId = anchorMessage ? this.messageAnchor(anchorMessage.id) : ''

				setTimeout(() => {
					const batch = this.historyBatches[this.historyIndex] || []
					this.earlierMessages = batch.concat(this.earlierMessages)
					this.historyIndex += 1
					this.isLoadingHistory = false
					if (anchorId) this.scrollToAnchor(anchorId, false)
				}, 450)
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
				this.$nextTick(() => this.scrollToBottom(false))
			},
			closePanel() {
				if (this.activePanel) this.activePanel = ''
			},
			handleInputFocus() {
				this.inputFocused = true
				this.activePanel = ''
				this.$nextTick(() => this.scrollToBottom(false))
			},
			usePhrase(phrase) {
				this.draft = phrase
				this.activePanel = ''
				this.inputFocused = true
			},
			appendEmoji(emoji) {
				this.draft += emoji
			},
			sendMessage() {
				const content = this.draft.trim()
				if (!content) {
					uni.showToast({
						title: '请输入消息',
						icon: 'none'
					})
					return
				}

				this.messageSequence += 1
				this.messages.push({
					id: `new-${this.messageSequence}`,
					type: 'text',
					direction: 'self',
					content
				})
				this.draft = ''
				this.activePanel = ''
				this.$nextTick(() => this.scrollToBottom(true))
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
	}

	.company-card {
		box-sizing: border-box;
		margin: 0 -8rpx 36rpx;
		padding: 20rpx 26rpx 26rpx;
		background: #ffffff;

		.company-name {
			display: block;
			font-size: 28rpx;
			color: #696969;
		}

		.company-tags {
			display: flex;
			flex-wrap: wrap;
			gap: 12rpx 24rpx;
			margin-top: 20rpx;
			.text {
				margin-left: 8rpx;
				font-size: 24rpx;
				color: #777777;
			}
		}

		.contact-row {
			display: flex;
			align-items: center;
			margin-top: 24rpx;
			font-size: 28rpx;
			color: #555555;

			.company-logo {
				width: 40rpx;
				height: 40rpx;
				margin-right: 12rpx;
				border-radius: 50%;
			}
		}

		.communication-note {
			margin-top: 20rpx;
			padding-top: 18rpx;
			border-top: 1rpx solid #eeeeee;
			font-size: 22rpx;
			color: #a0a0a0;
		}
	}

	.time-divider {
		padding: 12rpx 0 28rpx;
		text-align: center;
		font-size: 22rpx;
		color: #a8a8a8;
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
	}

	.phrase-list {
		.phrase-item {
			padding: 20rpx 22rpx;
			font-size: 26rpx;
			color: #555555;
			background: #ffffff;
			border-bottom: 1rpx solid #eeeeee;

			&:first-child {
				border-radius: 10rpx 10rpx 0 0;
			}

			&:last-child {
				border-bottom: none;
				border-radius: 0 0 10rpx 10rpx;
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
			font-size: 32rpx;
			background: #ffffff;
			border-radius: 10rpx;
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