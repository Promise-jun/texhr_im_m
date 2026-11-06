export const DEFAULT_TALENT_AVATAR = '/static/preson_avatar.png'

const MAN_AVATAR = '/static/man_avatar.png'
const WOMAN_AVATAR = '/static/woman_avatar.png'

function resolveGender(value) {
	if (value && typeof value === 'object') {
		value = value.gender !== undefined ? value.gender :
			value.Gender !== undefined ? value.Gender :
			value.GenderName !== undefined ? value.GenderName :
			value.sex !== undefined ? value.sex :
			value.Sex !== undefined ? value.Sex : value.SexName
	}
	return String(value === undefined || value === null ? '' : value).trim().toLowerCase()
}

export function getTalentAvatar(gender) {
	const value = resolveGender(gender)
	if (['1', '男', 'male', 'm'].includes(value)) return MAN_AVATAR
	if (['2', '女', 'female', 'f'].includes(value)) return WOMAN_AVATAR
	return DEFAULT_TALENT_AVATAR
}
