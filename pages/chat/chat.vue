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
				<image v-if="activePanel === 'phrases'" src="../../static/icon_key.png" class="phrase-icon"
					mode="aspectFit" @click="togglePanel('phrases')"></image>
				<button v-else class="phrase-button" @click="togglePanel('phrases')">常用语</button>
				<input v-model.trim="draft" class="message-input" :focus="inputFocused" confirm-type="send"
					cursor-spacing="18" maxlength="500" placeholder="输入消息" @focus="handleInputFocus"
					@confirm="sendMessage" />
				<image src="../../static/icon_emoji.png" class="round-button" @click="togglePanel('emoji')"></image>
				<button v-if="draft" class="send-button" @click="sendMessage">发送</button>
				<image v-else src="../../static/icon_add.png" class="round-button" @click="togglePanel('more')"></image>
			</view>

			<view v-if="activePanel" class="extension-panel"
				:class="{ 'extension-panel--phrases': activePanel === 'phrases' }">
				<view v-if="activePanel === 'phrases'" class="phrase-panel">
					<scroll-view scroll-y class="phrase-list">
						<view v-if="isLoadingCommonPhrases" class="phrase-status">常用语加载中...</view>
						<view v-else-if="commonPhrasesError" class="phrase-status phrase-status--error"
							@click="loadCommonPhrases">
							{{ commonPhrasesError }}
						</view>
						<view v-else-if="!commonPhrases.length" class="phrase-status">暂无常用语</view>
						<view v-for="phrase in commonPhrases" :key="phrase.key" class="phrase-item"
							@click="usePhrase(phrase.message)">
							<text class="phrase-message">{{ phrase.message }}</text>
							<view v-if="isEditingCommonPhrases" class="phrase-item-actions">
								<image src="../../static/icon_edit.png" class="phrase-item-action-icon" mode="aspectFit"
									@click.stop="handleCommonPhraseAction('edit', phrase)"></image>
								<image src="../../static/icon_close.png" class="phrase-item-action-icon"
									:class="{ 'phrase-item-action-icon--disabled': deletingCommonPhraseId === phrase.id }" mode="aspectFit"
									@click.stop="handleCommonPhraseAction('delete', phrase)"></image>
							</view>
						</view>
					</scroll-view>
					<view class="phrase-actions">
						<view class="phrase-add" @click="openQuickReplyModal">
							<image src="../../static/icon_common_add.png" class="phrase-add-icon" mode="aspectFit"></image>
							<text>新增</text>
						</view>
						<image src="../../static/icon_setting.png" class="phrase-setting-icon" mode="aspectFit"
							@click="toggleCommonPhraseEditing"></image>
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

		<view v-if="showQuickReplyModal" class="quick-reply-mask" @click="closeQuickReplyModal">
			<view class="quick-reply-dialog" @click.stop>
				<view class="quick-reply-header">
					<text class="quick-reply-title">快速回复</text>
					<text class="quick-reply-close" @click="closeQuickReplyModal">×</text>
				</view>
				<view class="quick-reply-body">
					<textarea v-model="quickReplyText" class="quick-reply-input" maxlength="300"
						placeholder="可输入300字，可输入您常用回复，请不要填写QQ、微信等联系方式或广告，否则系统将封禁您的账号。"
						placeholder-class="quick-reply-placeholder" />
					<text class="quick-reply-count">{{ quickReplyText.length }}/300</text>
				</view>
				<view class="quick-reply-footer">
					<view class="quick-reply-button" :class="{ 'quick-reply-button--disabled': isSavingCommonPhrase }"
						@click="saveCommonPhrase">
						{{ isSavingCommonPhrase ? '保存中...' : '保存' }}
					</view>
					<view class="quick-reply-button" @click="sendQuickReply">发送</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { requestApi } from '../../services/request'

	const COMMON_LANGUAGE_GET_API = 'Chat.CommonLanguage.Get'
	const COMMON_LANGUAGE_SAVE_API = 'Chat.CommonLanguage.Save'
	const COMMON_LANGUAGE_DELETE_API = 'Chat.CommonLanguage.Del'

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
				commonPhrases: [],
				isLoadingCommonPhrases: false,
				commonPhrasesError: '',
				isEditingCommonPhrases: false,
				showQuickReplyModal: false,
				quickReplyText: '',
				quickReplyId: null,
				isSavingCommonPhrase: false,
				deletingCommonPhraseId: '',
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
			this.loadCommonPhrases()
		},
		onReady() {
			this.$nextTick(() => {
				this.scrollToBottom(false)
				setTimeout(() => this.scrollToBottom(false), 60)
			})
		},
		methods: {
			async loadCommonPhrases() {
				if (this.isLoadingCommonPhrases) return

				this.isLoadingCommonPhrases = true
				this.commonPhrasesError = ''
				try {
					const response = await requestApi({
						Name: COMMON_LANGUAGE_GET_API,
						Content: ''
					})
					if (!response || Number(response.Code) !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`获取常用语失败，业务错误码：${code}`)
					}

					const rows = response.Data && response.Data.Rows
					if (!Array.isArray(rows)) throw new Error('获取常用语失败：接口未返回有效列表')

					this.commonPhrases = rows
						.map((item, index) => {
							const message = item && typeof item.Msg === 'string' ? item.Msg.trim() : ''
							if (!message) return null

							return {
								id: item.Id ? String(item.Id) : null,
								key: item.Id ? String(item.Id) : `phrase-${index}`,
								message,
								isTop: Boolean(item.IsTop),
								originalIndex: index
							}
						})
						.filter(Boolean)
						.sort((left, right) => {
							if (left.isTop !== right.isTop) return left.isTop ? -1 : 1
							return left.originalIndex - right.originalIndex
						})
				} catch (error) {
					this.commonPhrases = []
					this.commonPhrasesError = '常用语加载失败，点击重试'
					console.error('[Chat] 获取常用语失败', error)
				} finally {
					this.isLoadingCommonPhrases = false
				}
			},
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
				if (this.activePanel !== 'phrases') this.isEditingCommonPhrases = false
				if (this.activePanel === 'phrases' && !this.commonPhrases.length) {
					this.loadCommonPhrases()
				}
				this.$nextTick(() => this.scrollToBottom(false))
			},
			closePanel() {
				if (this.activePanel) this.activePanel = ''
				this.isEditingCommonPhrases = false
			},
			handleInputFocus() {
				this.inputFocused = true
				this.activePanel = ''
				this.isEditingCommonPhrases = false
				this.$nextTick(() => this.scrollToBottom(false))
			},
			usePhrase(phrase) {
				this.draft = phrase
				this.activePanel = ''
				this.isEditingCommonPhrases = false
				this.inputFocused = true
			},
			toggleCommonPhraseEditing() {
				this.isEditingCommonPhrases = !this.isEditingCommonPhrases
			},
			openQuickReplyModal(phrase = null) {
				this.quickReplyId = phrase && phrase.id ? phrase.id : null
				this.quickReplyText = phrase && phrase.message ? phrase.message : ''
				this.isEditingCommonPhrases = false
				this.showQuickReplyModal = true
			},
			closeQuickReplyModal() {
				if (this.isSavingCommonPhrase) return
				this.showQuickReplyModal = false
				this.quickReplyText = ''
				this.quickReplyId = null
			},
			async saveCommonPhrase() {
				if (this.isSavingCommonPhrase) return

				const message = this.quickReplyText.trim()
				if (!message) {
					uni.showToast({
						title: '请输入常用语内容',
						icon: 'none'
					})
					return
				}

				this.isSavingCommonPhrase = true
				try {
					const response = await requestApi({
						Name: COMMON_LANGUAGE_SAVE_API,
						Content: {
							Id: this.quickReplyId,
							Msg: message
						}
					})
					const responseCode = response && response.Code !== undefined
						? Number(response.Code)
						: NaN
					const data = response && response.Data ? response.Data : {}
					const dataCode = data.Code !== undefined ? Number(data.Code) : 0

					if (responseCode === 4400003 || dataCode === 4400003) {
						throw new Error('最多只能设置10条常用语')
					}
					if (responseCode !== 0) {
						throw new Error(`保存常用语失败，业务错误码：${responseCode}`)
					}
					if (dataCode !== 0) {
						throw new Error(`保存常用语失败，数据错误码：${dataCode}`)
					}

					this.showQuickReplyModal = false
					this.quickReplyText = ''
					this.quickReplyId = null
					await this.loadCommonPhrases()
					uni.showToast({
						title: '保存成功',
						icon: 'success'
					})
				} catch (error) {
					uni.showToast({
						title: error && error.message ? error.message : '保存常用语失败',
						icon: 'none'
					})
					console.error('[Chat] 保存常用语失败', error)
				} finally {
					this.isSavingCommonPhrase = false
				}
			},
			sendQuickReply() {
				if (this.isSavingCommonPhrase) return

				const message = this.quickReplyText.trim()
				if (!message) {
					uni.showToast({
						title: '请输入回复内容',
						icon: 'none'
					})
					return
				}

				this.showQuickReplyModal = false
				this.quickReplyText = ''
				this.quickReplyId = null
				this.draft = message
				this.sendMessage()
			},
			handleCommonPhraseAction(action, phrase) {
				if (action === 'edit') {
					this.openQuickReplyModal(phrase)
					return
				}
				if (action === 'delete') {
					this.confirmDeleteCommonPhrase(phrase)
					return
				}

				uni.showToast({
					title: '常用语设置功能待接入',
					icon: 'none'
				})
			},
			confirmDeleteCommonPhrase(phrase) {
				if (this.deletingCommonPhraseId) return

				uni.showModal({
					title: '删除常用语',
					content: '确定要删除这条常用语吗？',
					confirmText: '确认删除',
					confirmColor: '#e54d42',
					success: result => {
						if (result.confirm) this.deleteCommonPhrase(phrase)
					}
				})
			},
			async deleteCommonPhrase(phrase) {
				if (this.deletingCommonPhraseId) return

				const phraseId = phrase && phrase.id ? phrase.id : ''
				if (!phraseId) {
					uni.showToast({
						title: '未获取到常用语ID',
						icon: 'none'
					})
					return
				}

				this.deletingCommonPhraseId = phraseId
				try {
					const response = await requestApi({
						Name: COMMON_LANGUAGE_DELETE_API,
						Content: {
							Id: phraseId
						}
					})
					if (!response || Number(response.Code) !== 0) {
						const code = response && response.Code !== undefined ? response.Code : 'unknown'
						throw new Error(`删除常用语失败，业务错误码：${code}`)
					}

					this.commonPhrases = this.commonPhrases.filter(item => item.id !== phraseId)
					uni.showToast({
						title: '删除成功',
						icon: 'success'
					})
					await this.loadCommonPhrases()
				} catch (error) {
					uni.showToast({
						title: error && error.message ? error.message : '删除常用语失败',
						icon: 'none'
					})
					console.error('[Chat] 删除常用语失败', error)
				} finally {
					this.deletingCommonPhraseId = ''
				}
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

		.phrase-icon {
			flex-shrink: 0;
			width: 120rpx;
			height: 70rpx;
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

		&.extension-panel--phrases {
			overflow: hidden;
			padding: 0;
			background: #ffffff;
		}
	}

	.phrase-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.phrase-list {
		flex: 1;
		min-height: 0;
		overflow: hidden;

		.phrase-status {
			padding: 36rpx 22rpx;
			text-align: center;
			font-size: 26rpx;
			color: #999999;
			background: #ffffff;
			border-radius: 10rpx;

			&.phrase-status--error {
				color: #2399ed;
			}
		}

		.phrase-item {
			display: flex;
			align-items: center;
			box-sizing: border-box;
			padding: 20rpx 22rpx;
			font-size: 26rpx;
			color: #555555;
			background: #ffffff;
			border-bottom: 1rpx solid #eeeeee;

			.phrase-message {
				display: block;
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.phrase-item-actions {
				display: flex;
				flex-shrink: 0;
				align-items: center;
				gap: 24rpx;
				margin-left: 24rpx;

				.phrase-item-action-icon {
					width: 30rpx;
					height: 30rpx;

					&.phrase-item-action-icon--disabled {
						opacity: 0.4;
					}
				}
			}

			&:first-child {
				border-radius: 10rpx 10rpx 0 0;
			}

			&:last-child {
				border-bottom: none;
				border-radius: 0 0 10rpx 10rpx;
			}
		}
	}

	.phrase-actions {
		position: relative;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		height: 72rpx;
		background: #ffffff;
		border-top: 1rpx solid #eeeeee;

		.phrase-add {
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 26rpx;
			color: #555555;

			.phrase-add-icon {
				width: 30rpx;
				height: 30rpx;
				margin-right: 8rpx;
			}
		}

		.phrase-setting-icon {
			position: absolute;
			right: 28rpx;
			width: 32rpx;
			height: 32rpx;
		}
	}

	.quick-reply-mask {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 40rpx;
		background: rgba(0, 0, 0, 0.55);
	}

	.quick-reply-dialog {
		overflow: hidden;
		width: 560rpx;
		background: #ffffff;
		border-radius: 8rpx;
		box-shadow: 0 10rpx 40rpx rgba(0, 0, 0, 0.18);
	}

	.quick-reply-header {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 88rpx;

		.quick-reply-title {
			font-size: 32rpx;
			font-weight: 600;
			color: #444444;
		}

		.quick-reply-close {
			position: absolute;
			top: 0;
			right: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 80rpx;
			height: 80rpx;
			font-size: 42rpx;
			font-weight: 300;
			color: #999999;
		}
	}

	.quick-reply-body {
		position: relative;
		padding: 0 36rpx 28rpx;

		.quick-reply-input {
			box-sizing: border-box;
			width: 100%;
			height: 160rpx;
			padding: 16rpx 18rpx 40rpx;
			font-size: 24rpx;
			line-height: 1.45;
			color: #555555;
			background: #f3f5f6;
			border: 1rpx solid #e2e5e7;
			border-radius: 4rpx;
		}

		.quick-reply-placeholder {
			color: #999999;
		}

		.quick-reply-count {
			position: absolute;
			right: 50rpx;
			bottom: 40rpx;
			font-size: 20rpx;
			color: #aaaaaa;
		}
	}

	.quick-reply-footer {
		display: flex;
		height: 88rpx;
		border-top: 1rpx solid #eeeeee;

		.quick-reply-button {
			display: flex;
			flex: 1;
			align-items: center;
			justify-content: center;
			font-size: 30rpx;
			color: #2399ed;

			& + .quick-reply-button {
				border-left: 1rpx solid #eeeeee;
			}

			&.quick-reply-button--disabled {
				opacity: 0.55;
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
