/**
 * 仅在 H5 测试环境启用 VConsole。
 *
 * HBuilderX/uni-app 的 H5 构建会注入 NODE_ENV；部署测试环境时请设置
 * VUE_APP_ENV=test。开发模式也默认开启，便于本地联调。生产环境在未显式
 * 设置 test 标识时不会初始化 VConsole。
 */
export function initVConsole() {
	// #ifndef H5
	return null
	// #endif

	// #ifdef H5
	if (typeof window === 'undefined') return null

	const nodeEnv = typeof process !== 'undefined' && process.env
		? process.env.NODE_ENV
		: ''
	const appEnv = typeof process !== 'undefined' && process.env
		? process.env.VUE_APP_ENV
		: ''
	const isTestEnvironment = appEnv === 'test' || nodeEnv === 'development'
	if (!isTestEnvironment || window.__vconsole__) return window.__vconsole__ || null

	// 使用 require 延迟加载，确保非 H5 端和非测试环境不会执行调试库。
	const VConsoleModule = require('vconsole')
	const VConsole = VConsoleModule.default || VConsoleModule
	const vConsole = new VConsole()
	window.__vconsole__ = vConsole
	return vConsole
	// #endif
}
