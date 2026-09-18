<template>
	<view class="chat-list-page">
		<view class="navigation-bar">
			<view class="back-button" aria-label="返回" @click="navigateBack">
				<text class="back-icon"></text>
			</view>
			<text class="navigation-title">消息列表</text>
		</view>

		<view class="tabs">
			<view
				v-for="tab in tabs"
				:key="tab.key"
				class="tab-item"
				:class="{ active: activeTab === tab.key }"
				@click="activeTab = tab.key"
			>
				{{ tab.label }}
			</view>
		</view>

		<view class="conversation-list">
			<view
				v-for="conversation in visibleConversations"
				:key="conversation.id"
				class="conversation-item"
				@click="openConversation(conversation)"
			>
				<image src="../../static/default_avatar.png" class="avatar"></image>
				<view class="conversation-content">
					<view class="conversation-heading">
						<text class="company-name">{{ conversation.name }}</text>
						<text class="time">{{ conversation.time }}</text>
					</view>
					<view class="message-row">
						<text class="read-status">[已读]</text>
						<text class="message">{{ conversation.message }}</text>
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
				activeTab: 'recent',
				tabs: [
					{ key: 'recent', label: '七天内会话' },
					{ key: 'history', label: '历史会话' }
				],
				conversations: {
					recent: [
						{
							id: 1,
							name: '智联科技',
							time: '15:04',
							message: '[自定义消息]'
						},
						{
							id: 2,
							name: '纺织招聘有限公司',
							time: '15:59',
							message: '好的，收到'
						}
					],
					history: [
						{
							id: 2,
							name: '金华智联信息科技有限公司',
							time: '昨天',
							message: '[历史消息]'
						}
					]
				}
			}
		},
		computed: {
			visibleConversations() {
				return this.conversations[this.activeTab]
			}
		},
		methods: {
			navigateBack() {
				const pages = getCurrentPages()
				if (pages.length > 1) {
					uni.navigateBack()
				}
			},

			openConversation(conversation) {
				uni.navigateTo({
					url: `/pages/chat/chat?id=${conversation.id}&name=${encodeURIComponent(conversation.name)}`
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

			.avatar {
				flex-shrink: 0;
				width: 80rpx;
				height: 80rpx;
				margin: 0 20rpx 0 0;
				border-radius: 50%;
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

					.read-status {
						flex-shrink: 0;
						font-size: 24rpx;
						color: #1e9df0;
					}

					.message {
						margin-left: 8rpx;
						overflow: hidden;
						font-size: 24rpx;
						text-overflow: ellipsis;
						white-space: nowrap;
						color: #888888;
					}
				}
			}
		}
	}
}
</style>
