const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (value) => String(value).padStart(2, '0')
const DAY_MS = 24 * 60 * 60 * 1000

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

const getTimezoneOffsetMinutes = (rawValue) => {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) ? parsed : 0
}

const shiftDateToClientTimezone = (value, timezoneOffsetMinutes = 0) => {
  const date = parseDateInput(value)
  if (!date) return null
  return new Date(date.getTime() - timezoneOffsetMinutes * 60 * 1000)
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

const getDateKey = (value) => {
  const date = parseDateInput(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const getDateKeyForTimezone = (value, timezoneOffsetMinutes = 0) => {
  const shifted = shiftDateToClientTimezone(value, timezoneOffsetMinutes)
  if (!shifted) return ''
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

const getStartOfDayForTimezone = (value, timezoneOffsetMinutes = 0) => {
  const date = parseDateInput(value)
  if (!date) return null

  const dateKey = getDateKey(value)
  const match = dateKey.match(DATE_ONLY_RE)
  if (!match) return null

  const [, year, month, day] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)) + timezoneOffsetMinutes * 60 * 1000)
}

const getEndOfDayForTimezone = (value, timezoneOffsetMinutes = 0) => {
  const start = getStartOfDayForTimezone(value, timezoneOffsetMinutes)
  if (!start) return null
  return new Date(start.getTime() + DAY_MS - 1)
}

const getMonthForTimezone = (value, timezoneOffsetMinutes = 0) => {
  const shifted = shiftDateToClientTimezone(value, timezoneOffsetMinutes)
  if (!shifted) return null
  return shifted.getUTCMonth() + 1
}

const getDayOfMonthForTimezone = (value, timezoneOffsetMinutes = 0) => {
  const shifted = shiftDateToClientTimezone(value, timezoneOffsetMinutes)
  if (!shifted) return null
  return shifted.getUTCDate()
}

module.exports = {
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
}
