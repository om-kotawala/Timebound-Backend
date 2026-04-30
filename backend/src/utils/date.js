const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (value) => String(value).padStart(2, '0')
const IST_TIMEZONE = 'Asia/Kolkata'
const IST_OFFSET_MINUTES = -330

const parseDateInput = (value) => {
  if (value instanceof Date) return new Date(value.getTime())
  if (typeof value === 'string') {
    const match = value.match(DATE_ONLY_RE)
    if (match) {
      const [, year, month, day] = match
      return new Date(Number(year), Number(month) - 1, Number(day))
    }
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const getISTParts = (value) => {
  const date = parseDateInput(value)
  if (!date) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  return parts.reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
}

const getTimezoneOffsetMinutes = () => IST_OFFSET_MINUTES

const getDateKey = (value) => {
  const date = parseDateInput(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const getDateKeyForTimezone = (value) => {
  const parts = getISTParts(value)
  if (!parts) return ''
  return `${parts.year}-${parts.month}-${parts.day}`
}

const shiftDateToClientTimezone = (value) => {
  const dateKey = getDateKeyForTimezone(value)
  if (!dateKey) return null
  return new Date(`${dateKey}T00:00:00.000+05:30`)
}

const getStartOfDay = (value) => {
  const date = parseDateInput(value)
  if (!date) return null
  date.setHours(0, 0, 0, 0)
  return date
}

const getEndOfDay = (value) => {
  const date = parseDateInput(value)
  if (!date) return null
  date.setHours(23, 59, 59, 999)
  return date
}

const getStartOfDayForTimezone = (value) => {
  const dateKey = typeof value === 'string' && DATE_ONLY_RE.test(value)
    ? value
    : getDateKeyForTimezone(value)

  const match = dateKey.match(DATE_ONLY_RE)
  if (!match) return null

  const [, year, month, day] = match
  return new Date(`${year}-${month}-${day}T00:00:00.000+05:30`)
}

const getEndOfDayForTimezone = (value) => {
  const dateKey = typeof value === 'string' && DATE_ONLY_RE.test(value)
    ? value
    : getDateKeyForTimezone(value)

  const match = dateKey.match(DATE_ONLY_RE)
  if (!match) return null

  const [, year, month, day] = match
  return new Date(`${year}-${month}-${day}T23:59:59.999+05:30`)
}

const getMonthForTimezone = (value) => {
  const parts = getISTParts(value)
  return parts ? Number(parts.month) : null
}

const getDayOfMonthForTimezone = (value) => {
  const parts = getISTParts(value)
  return parts ? Number(parts.day) : null
}

const getEndOfTodayInIST = () => getEndOfDayForTimezone(new Date())

module.exports = {
  IST_TIMEZONE,
  IST_OFFSET_MINUTES,
  parseDateInput,
  getTimezoneOffsetMinutes,
  shiftDateToClientTimezone,
  getStartOfDay,
  getEndOfDay,
  getDateKey,
  getDateKeyForTimezone,
  getStartOfDayForTimezone,
  getEndOfDayForTimezone,
  getMonthForTimezone,
  getDayOfMonthForTimezone,
  getEndOfTodayInIST,
}
