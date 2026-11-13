<template>
	<view class="error-page">
		<view class="site-header">
			<view class="site-header-inner">
				<a class="site-logo" href="http://www.texhr.cn" target="_blank" rel="noopener noreferrer"
					aria-label="CFW 首页">
					<image class="site-logo-image" src="/static/pc/logo.png" mode="aspectFit"></image>
				</a>
				<nav class="site-nav" aria-label="企业导航">
					<view class="site-nav-group">
						<a class="site-nav-link" href="http://www.texhr.cn/ehr/jobrecruit/?Active=1" target="_blank"
							rel="noopener noreferrer">职位管理<image class="nav-arrow" src="/static/pc/icon_down.png">
							</image></a>
						<view class="site-submenu">
							<a href="http://www.texhr.cn/ehr/jobpost/" target="_blank"
								rel="noopener noreferrer">发布职位</a>
							<a href="http://www.texhr.cn/ehr/jobrecruit/?Active=1" target="_blank"
								rel="noopener noreferrer">标准职位</a>
							<a href="http://www.texhr.cn/ehr/jobtemplate/" target="_blank"
								rel="noopener noreferrer">职位模板</a>
							<a href="http://www.texhr.cn/ehr/jobcomment/" target="_blank"
								rel="noopener noreferrer">职位留言</a>
						</view>
					</view>
					<view class="site-nav-group">
						<a class="site-nav-link" href="http://www.texhr.cn/ehr/resumereceive/" target="_blank"
							rel="noopener noreferrer">应聘管理<image class="nav-arrow" src="/static/pc/icon_down.png">
							</image></a>
						<view class="site-submenu">
							<a href="http://www.texhr.cn/ehr/resumereceive/" target="_blank"
								rel="noopener noreferrer">标准简历</a>
							<a href="http://www.texhr.cn/ehr/interviewtemplate/" target="_blank"
								rel="noopener noreferrer">面试模板</a>
						</view>
					</view>
				</nav>
				<view class="site-nav-right">
					<a class="site-nav-link" href="http://www.texhr.cn/ehr/resumesearch/" target="_blank"
						rel="noopener noreferrer">
						<image class="nav-icon" src="/static/pc/icon_search.png"></image>简历搜索
					</a>
					<a class="site-nav-link" href="/pages/ehr/pc/chat">
						<image class="nav-icon" src="/static/pc/icon_chat.png"></image>沟通
					</a>
					<view class="site-nav-group company-menu">
						<a class="site-nav-link company-link" href="http://www.texhr.cn/ehr/basicinformation/"
							target="_blank" rel="noopener noreferrer" :title="companyName || '企业账号'"><text
								class="company-name">{{ companyName || '企业账号' }}</text>
							<image class="nav-arrow" src="/static/pc/icon_down.png"></image>
						</a>
						<view class="site-submenu site-submenu--right">
							<a href="http://www.texhr.cn/ehr/basicinformation/" target="_blank"
								rel="noopener noreferrer">账号设置</a>
							<view class="site-submenu-action" role="button" tabindex="0" @click="confirmLogout"
								@keydown.enter.prevent="confirmLogout" @keydown.space.prevent="confirmLogout">退出登录
							</view>
						</view>
					</view>
				</view>
			</view>
		</view>
		<view class="error-content">
			<!-- 原图来自 texhr 静态站点，本地引用避免 HTTPS 页面加载 HTTP 图片被拦截。 -->
			<image class="error-image" src="/static/pc/commomerror.jpg" mode="aspectFit"></image>
			<text class="error-message">{{ tips || '操作失败' }}</text>
			<button v-if="stepName" class="error-action" :disabled="isSubmitting" @click="handleStepAction">
				{{ isSubmitting ? '提交中...' : stepName }}
			</button>
		</view>
	</view>
</template>

<script>
	import {
		createRequestPayload,
		requestApi
	} from '../../../services/request'

	const COMPANY_INFORMATION_API = 'Enterprise.BasicInformation.GetById'
	const UPGRADE_SERVICE_API = 'Enterprise.Service.UpGrade'

	export default {
		data() {
			return {
				tips: '',
				stepName: '',
				companyName: '',
				isSubmitting: false
			}
		},
		onLoad(options = {}) {
			// 外链通过 URL 编码传递 Tips 和 StepName；均作为纯文本使用。
			this.tips = String(options.tips || options.Tips || '')
			this.stepName = String(options.stepName || options.StepName || '').trim()
			this._errorPageAlive = true
		},
		onShow() {
			this.loadCompanyName()
		},
		onUnload() {
			this._errorPageAlive = false
		},
		methods: {
			handleStepAction() {
				if (!this._errorPageAlive || this.isSubmitting) return
				const name = String(this.stepName || '').trim()
				if (['升级', '立即升级', '立即开通', '申请开通'].includes(name)) {
					return this.requestChatUpgrade()
				}
				if (name === '立即上传' && typeof window !== 'undefined') {
					// 错误页无需保留，直接在当前页面进入企业资质上传页。
					window.location.href = 'https://www.texhr.cn/ehr/qualification/'
				}
				// “知道了”及未支持的 StepName 仅展示按钮，不执行其它操作。
			},
			async requestChatUpgrade() {
				if (this.isSubmitting || !this._errorPageAlive) return
				this.isSubmitting = true
				try {
					// 与 PC 聊天页一致：Type=9 表示申请增加直聊数量。
					const response = await requestApi({
						Name: UPGRADE_SERVICE_API,
						Content: {
							Type: 9
						}
					})
					if (!this._errorPageAlive) return
					if (!response || Number(response.Code) !== 0) throw new Error('提交升级申请失败，请重试')
					let data = response.Data
					if (data === undefined || data === null || data === '') data = {}
					if (typeof data === 'string') data = JSON.parse(data)
					if (!data || typeof data !== 'object' || Array.isArray(data) ||
						(data.Code !== undefined && Number(data.Code) !== 0)) {
						throw new Error('升级申请返回的数据格式不正确')
					}
					uni.showModal({
						title: '提示',
						content: '已成功接收您的需求,工作人员会在1个工作日内与您联系.',
						confirmText: '确定',
						showCancel: false,
						success: result => {
							if (result && result.confirm && this._errorPageAlive &&
								typeof window !== 'undefined' && typeof window.close === 'function') window
								.close()
						}
					})
				} catch (error) {
					if (this._errorPageAlive) uni.showToast({
						title: error && error.message ? error.message : '提交升级申请失败，请重试',
						icon: 'none'
					})
				} finally {
					if (this._errorPageAlive) this.isSubmitting = false
				}
			},
			async loadCompanyName() {
				try {
					const auth = createRequestPayload({
						Name: COMPANY_INFORMATION_API
					})
					const response = await requestApi({
						Name: COMPANY_INFORMATION_API,
						Content: {
							EnterpriseId: String(auth.EnterpriseId),
							AccountToken: auth.Token,
							EnterpriseType: String(auth.EnterpriseType)
						}
					})
					if (!response || Number(response.Code) !== 0) return
					const data = typeof response.Data === 'string' ? JSON.parse(response.Data) : response.Data
					if (this._errorPageAlive && data && typeof data === 'object' && !Array.isArray(data) &&
						(data.Code === undefined || Number(data.Code) === 0)) {
						this.companyName = typeof data.CompanyName === 'string' ? data.CompanyName.trim() : ''
					}
				} catch (error) {
					console.error('[PC Chat] 获取企业名称失败', error)
				}
			},
			confirmLogout() {
				uni.showModal({
					title: '退出登录',
					content: '确定退出登录吗？',
					confirmText: '退出登录',
					confirmColor: '#f37324',
					success: result => {
						if (result.confirm && typeof window !== 'undefined') window.location.href =
							'http://www.texhr.cn/ehr/loginout/'
					}
				})
			}
		}
	}
</script>

<style scoped>
	.error-page {
		min-height: 100vh;
		background: #fff;
	}

	.site-header {
		box-sizing: border-box;
		height: 68px;
		background: #fff;
		border-bottom: 1px solid #eee;
	}

	.site-header-inner {
		display: flex;
		align-items: center;
		width: min(1140px, 100%);
		height: 100%;
		margin: 0 auto;
	}

	.site-logo {
		display: flex;
		align-items: center;
		flex: 0 0 120px;
		margin-right: 48px;
	}

	.site-logo-image {
		width: 120px;
		height: 42px;
	}

	.site-nav,
	.site-nav-right {
		display: flex;
		align-items: stretch;
		height: 100%;
	}

	.site-nav-right {
		margin-left: auto;
	}

	.site-nav-group {
		position: relative;
		height: 100%;
	}

	.site-nav-link {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		height: 100%;
		padding: 0 16px;
		color: #465365;
		font-size: 14px;
		text-decoration: none;
		white-space: nowrap;
	}

	.site-nav-link:hover,
	.site-nav-link:focus {
		color: #f37324;
	}

	.nav-arrow {
		width: 10px;
		height: 10px;
		margin-left: 7px;
	}

	.nav-icon {
		width: 15px;
		height: 15px;
		margin-right: 5px;
	}

	.site-nav-link:hover .nav-icon,
	.site-nav-link:focus .nav-icon {
		filter: brightness(0) saturate(100%) invert(55%) sepia(92%) saturate(1943%) hue-rotate(341deg) brightness(100%) contrast(91%);
	}

	.company-link {
		padding-right: 0;
	}

	.company-name {
		display: block;
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.site-submenu {
		display: none;
		position: absolute;
		z-index: 20;
		top: 100%;
		left: 0;
		min-width: 100px;
		padding: 5px 0;
		background: #fff;
		box-shadow: 0 2px 5px rgba(0, 0, 0, .12);
	}

	.site-submenu--right {
		right: 0;
		left: auto;
	}

	.site-nav-group:hover .site-submenu,
	.site-nav-group:focus-within .site-submenu {
		display: block;
	}

	.site-submenu a,
	.site-submenu-action {
		display: block;
		box-sizing: border-box;
		padding: 9px 21px;
		color: #465365;
		font-size: 14px;
		text-decoration: none;
		white-space: nowrap;
	}

	.site-submenu a:hover,
	.site-submenu a:focus,
	.site-submenu-action:hover,
	.site-submenu-action:focus {
		color: #f37324;
		background: #f5f7fa;
	}

	.site-submenu-action {
		cursor: pointer;
	}

	.error-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		box-sizing: border-box;
		min-height: 530px;
		padding: 32px 16px 34px;
		background: #fff;
	}

	.error-image {
		width: min(750px, 100%);
		height: 360px;
	}

	.error-message {
		display: block;
		max-width: 750px;
		margin-top: 56px;
		color: #465365;
		font-size: 14px;
		line-height: 24px;
		text-align: center;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.error-action {
		box-sizing: border-box;
		width: 154px;
		height: 44px;
		margin-top: 20px;
		padding: 0 12px;
		color: #fff;
		font-size: 14px;
		line-height: 44px;
		text-align: center;
		background: #f37324;
		border: 0;
		border-radius: 4px;
		cursor: pointer;
	}

	.error-action:hover:not(:disabled),
	.error-action:focus:not(:disabled) {
		background: #e86618;
	}

	.error-action:disabled {
		background: #f6ad80;
		cursor: wait;
	}

	@media (max-width: 700px) {
		.site-header {
			overflow-x: auto;
		}

		.site-header-inner {
			width: 700px;
			padding: 0 12px;
		}

		.site-logo {
			margin-right: 16px;
		}

		.site-nav-link {
			padding: 0 10px;
		}

		.error-image {
			height: 280px;
		}
	}
</style>