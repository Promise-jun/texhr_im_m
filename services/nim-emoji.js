// 网易云信官方 UniApp UI Kit 使用的表情标记和 NOS 静态资源。
// 消息中只发送稳定的 key（例如 [大笑]），展示时再从网易云信 CDN 加载对应图片。
const NIM_EMOJI_CONFIG = [
	['[大笑]', 'https://yx-web-nosdn.netease.im/common/7c2e2c6ff08f4ed60f3ca7d5ab6d38ac/icon-a-1.png'],
	['[开心]', 'https://yx-web-nosdn.netease.im/common/bb61c05013350e980b3acf77a00aa7b7/icon-a-2.png'],
	['[色]', 'https://yx-web-nosdn.netease.im/common/bfe80222635ec3f07e41b2819d002a4c/icon-a-3.png'],
	['[酷]', 'https://yx-web-nosdn.netease.im/common/e6dd252af94a4716edc191f7d3812042/icon-a-4.png'],
	['[奸笑]', 'https://yx-web-nosdn.netease.im/common/4e01e93f3e795d8aeb140e924d8b1206/icon-a-5.png'],
	['[亲]', 'https://yx-web-nosdn.netease.im/common/a1fa1174a588a984845ba871b1f1e3b0/icon-a-6.png'],
	['[伸舌头]', 'https://yx-web-nosdn.netease.im/common/e0e30470561cf90446ec31c6d5b206a5/icon-a-7.png'],
	['[眯眼]', 'https://yx-web-nosdn.netease.im/common/e44ceea2c764bfbe773e61483ae857eb/icon-a-8.png'],
	['[可爱]', 'https://yx-web-nosdn.netease.im/common/f4e5b303cb77d9ce67a0baf4efaa1125/icon-a-9.png'],
	['[鬼脸]', 'https://yx-web-nosdn.netease.im/common/28e46e6cc468c4ff6f44532bd6b7f464/icon-a-10.png'],
	['[偷笑]', 'https://yx-web-nosdn.netease.im/common/f265ea5a782cebabae08a079045caf2c/icon-a-11.png'],
	['[喜悦]', 'https://yx-web-nosdn.netease.im/common/20043e6f8d619ab7bca69f1a0d5a0e56/icon-a-12.png'],
	['[狂喜]', 'https://yx-web-nosdn.netease.im/common/c2b2d52a97eea83efb10c9bbc34dc104/icon-a-13.png'],
	['[惊讶]', 'https://yx-web-nosdn.netease.im/common/37486551a8bd31e3446ae862cddd3067/icon-a-14.png'],
	['[流泪]', 'https://yx-web-nosdn.netease.im/common/e383cc57dcb7a903887031ed0d341fef/icon-a-15.png'],
	['[流汗]', 'https://yx-web-nosdn.netease.im/common/73e2f9507f8aac7238896a3f1ee8305a/icon-a-16.png'],
	['[天使]', 'https://yx-web-nosdn.netease.im/common/51a80e8e81a8aa531d1c68e6f79f7d58/icon-a-17.png'],
	['[笑哭]', 'https://yx-web-nosdn.netease.im/common/20f8c6153ba0f51c038e04f2fbedf767/icon-a-18.png'],
	['[尴尬]', 'https://yx-web-nosdn.netease.im/common/47d420b5251ca7b9ddc564b42564eb01/icon-a-19.png'],
	['[惊恐]', 'https://yx-web-nosdn.netease.im/common/8fad6b9427b49f5bfd1a8ec0f8a77fac/icon-a-20.png'],
	['[大哭]', 'https://yx-web-nosdn.netease.im/common/6fa17035135cebe4ca1512b454fa38c2/icon-a-21.png'],
	['[烦躁]', 'https://yx-web-nosdn.netease.im/common/12189563eea22258b847cf900dcbc4d4/icon-a-22.png'],
	['[恐怖]', 'https://yx-web-nosdn.netease.im/common/3b7dcfe14788bd7d8c2da8aad6c24baa/icon-a-23.png'],
	['[两眼冒星]', 'https://yx-web-nosdn.netease.im/common/6bb0879272c8a3c73524f3b728a93c10/icon-a-24.png'],
	['[害羞]', 'https://yx-web-nosdn.netease.im/common/1f93dac2bdef1f91ca2f7302065954d5/icon-a-25.png'],
	['[睡着]', 'https://yx-web-nosdn.netease.im/common/aa3c8e63ee6c6d605f4606a8094f2094/icon-a-26.png'],
	['[冒星]', 'https://yx-web-nosdn.netease.im/common/000447b3172d70d1b739a170c377eae2/icon-a-27.png'],
	['[口罩]', 'https://yx-web-nosdn.netease.im/common/27c3b8d1acb6f234a7591c2358b549bf/icon-a-28.png'],
	['[OK]', 'https://yx-web-nosdn.netease.im/common/fbae68926f43367022d0b0c95c15adcf/icon-a-29.png'],
	['[好吧]', 'https://yx-web-nosdn.netease.im/common/61c0b6c12bc6ad2b7e0511d843b03265/icon-a-30.png'],
	['[鄙视]', 'https://yx-web-nosdn.netease.im/common/202e7abeaecf651f6da3f7f695ef8752/icon-a-31.png'],
	['[难受]', 'https://yx-web-nosdn.netease.im/common/6ef4958d39866165212c1b60bc7c6a55/icon-a-32.png'],
	['[不屑]', 'https://yx-web-nosdn.netease.im/common/18f8b53d57a6b47c3876b6938f2f57b9/icon-a-33.png'],
	['[不舒服]', 'https://yx-web-nosdn.netease.im/common/84d7491e6d5a6d53848b6a3d12a739b2/icon-a-34.png'],
	['[愤怒]', 'https://yx-web-nosdn.netease.im/common/f03fe01986e9e25f3faf1a17c0ef78c8/icon-a-35.png'],
	['[鬼怪]', 'https://yx-web-nosdn.netease.im/common/4617253245617bcd38ed7165bdb592d8/icon-a-36.png'],
	['[发怒]', 'https://yx-web-nosdn.netease.im/common/9168b11333f59b0ff948003dedb24c84/icon-a-37.png'],
	['[生气]', 'https://yx-web-nosdn.netease.im/common/1a3cd5d62e92895dbab3d356112b5079/icon-a-38.png'],
	['[不高兴]', 'https://yx-web-nosdn.netease.im/common/b465db737c737ab4308c9272a00a1fdf/icon-a-39.png'],
	['[皱眉]', 'https://yx-web-nosdn.netease.im/common/6bca766a4904e10934ea2f2450c341b5/icon-a-40.png'],
	['[心碎]', 'https://yx-web-nosdn.netease.im/common/12d5055618b619b568342f0619cacf0c/icon-a-41.png'],
	['[心动]', 'https://yx-web-nosdn.netease.im/common/8851ccd815375180bd7f8728ead1cdf1/icon-a-42.png'],
	['[好的]', 'https://yx-web-nosdn.netease.im/common/1ac7cacc9d0063d165f8e2bc3020bfff/icon-a-43.png'],
	['[低级]', 'https://yx-web-nosdn.netease.im/common/5735260c7e240beaabc360365e6d60c5/icon-a-44.png'],
	['[赞]', 'https://yx-web-nosdn.netease.im/common/07372c06915a7d0a977a4f042522e2a7/icon-a-45.png'],
	['[鼓掌]', 'https://yx-web-nosdn.netease.im/common/40c5b2b5769166b51c968942f4abed95/icon-a-46.png'],
	['[给力]', 'https://yx-web-nosdn.netease.im/common/9334c3ec8c8d54a9a3271a3536ff7c62/icon-a-47.png'],
	['[打你]', 'https://yx-web-nosdn.netease.im/common/5630ab646533dd6de7e3c1accc3d2ca1/icon-a-48.png'],
	['[阿弥陀佛]', 'https://yx-web-nosdn.netease.im/common/f2412538fa0da38549c23fd44b25bdfb/icon-a-49.png'],
	['[拜拜]', 'https://yx-web-nosdn.netease.im/common/1f28ffd1413aa3fcce1c17aff3694d41/icon-a-50.png'],
	['[第一]', 'https://yx-web-nosdn.netease.im/common/a99b57b586a85c23cbd8ed65d1a16765/icon-a-51.png'],
	['[拳头]', 'https://yx-web-nosdn.netease.im/common/ce6f64bbe45a42108fd1b1a7b1dae606/icon-a-52.png'],
	['[手掌]', 'https://yx-web-nosdn.netease.im/common/ba5dc56bf8f550da8c2dc1c94e2ee7fb/icon-a-53.png'],
	['[剪刀]', 'https://yx-web-nosdn.netease.im/common/81f5b3b693d9133030c013f0f21462ab/icon-a-54.png'],
	['[招手]', 'https://yx-web-nosdn.netease.im/common/758ed38dea207d60855969689a5dd68b/icon-a-55.png'],
	['[不要]', 'https://yx-web-nosdn.netease.im/common/a20bee2372cbe399191af3d76a5aad31/icon-a-56.png'],
	['[举着]', 'https://yx-web-nosdn.netease.im/common/a17fbdbc64cf4b55be377f18ed81879a/icon-a-57.png'],
	['[思考]', 'https://yx-web-nosdn.netease.im/common/784b31cda55da76d8278a5bd53c2c7e4/icon-a-58.png'],
	['[猪头]', 'https://yx-web-nosdn.netease.im/common/c716afbc25b8809dfb9ca80a09051f6f/icon-a-59.png'],
	['[不听]', 'https://yx-web-nosdn.netease.im/common/54de44be20c5d21ffad08176b24560a0/icon-a-60.png'],
	['[不看]', 'https://yx-web-nosdn.netease.im/common/0628fd4507e2a3455028f376d8d5d80a/icon-a-61.png'],
	['[不说]', 'https://yx-web-nosdn.netease.im/common/fa336dc373d5e395a1e9a541dc9953d2/icon-a-62.png'],
	['[猴子]', 'https://yx-web-nosdn.netease.im/common/868ee8c664b32b34d554d02fc406ab70/icon-a-63.png'],
	['[炸弹]', 'https://yx-web-nosdn.netease.im/common/4e33aadf3ca3b918e73ef07e21eb96ac/icon-a-64.png'],
	['[睡觉]', 'https://yx-web-nosdn.netease.im/common/c6e5563811d94c82426036b9f96d6de5/icon-a-65.png'],
	['[筋斗云]', 'https://yx-web-nosdn.netease.im/common/8baa1f43b4e523e524c54f3340ef21cb/icon-a-66.png'],
	['[火箭]', 'https://yx-web-nosdn.netease.im/common/307c3426dccf1252b5967956bcdcf58a/icon-a-67.png'],
	['[救护车]', 'https://yx-web-nosdn.netease.im/common/196f62aa8e8a38bbbcd818ad42729714/icon-a-68.png'],
	['[便便]', 'https://yx-web-nosdn.netease.im/common/fb54482390faf9d8d9d607d7e3ab691f/icon-a-70.png']
]

export const NIM_EMOJIS = Object.freeze(NIM_EMOJI_CONFIG.map(([key, url]) => Object.freeze({ key, url })))

const NIM_EMOJI_URL_MAP = NIM_EMOJI_CONFIG.reduce((result, [key, url]) => {
	result[key] = url
	return result
}, Object.create(null))

/**
 * 将云信文本消息拆分成普通文本和表情图片片段。
 * 未识别的方括号内容会原样显示，不会误当成表情。
 */
export function parseNimEmojiText(value) {
	const text = value === undefined || value === null ? '' : String(value)
	const segments = []
	const tokenRegExp = /\[[^\[\]]+\]/g
	let textStart = 0
	let match

	while ((match = tokenRegExp.exec(text))) {
		const key = match[0]
		const url = NIM_EMOJI_URL_MAP[key]
		if (!url) continue

		if (match.index > textStart) {
			segments.push({ type: 'text', content: text.slice(textStart, match.index) })
		}
		segments.push({ type: 'emoji', key, url })
		textStart = match.index + key.length
	}

	if (textStart < text.length) {
		segments.push({ type: 'text', content: text.slice(textStart) })
	}
	if (!segments.length) segments.push({ type: 'text', content: text })

	return segments
}
