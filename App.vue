<script>
	import { initAndLoginNim } from './services/nim'
	import { AUTH_COOKIE_KEYS, setEncodedCookie } from './services/request'

	const CFW_PERSONAL_COOKIE_VALUE = '%7B%22personId%22%3A1380685%2C%22token%22%3A%22x81MvT43pqrDYk74xYXB%22%7D'

	export default {
		onLaunch: async function() {
			// 先写入当前用户态 Cookie，创建云信账号接口会读取其中的 PersonId 和 Token。
			setEncodedCookie(AUTH_COOKIE_KEYS.PERSONAL, CFW_PERSONAL_COOKIE_VALUE)

			try {
				// 初始化云信、获取云信账号密码，并使用返回的凭证完成登录。
				await initAndLoginNim()
				console.log('App Launch, NIM initialized and logged in')
			} catch (error) {
				// 只记录错误信息，避免将登录凭证输出到控制台。
				const message = error && (error.message || error.errMsg)
					? error.message || error.errMsg
					: '未知错误'
				console.error('[NIM] 初始化或登录失败', message)
			}
		},
		onShow: function() {
			console.log('App Show')
		},
		onHide: function() {
			console.log('App Hide')
		}
	}
</script>

<style>
	/*每个页面公共css */
</style>
