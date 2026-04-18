
const router = require('express').Router()
const auth   = require('../middleware/auth')
const Task   = require('../models/Task')
const { getVisibleTaskQuery } = require('../utils/taskVisibility')
const {
  getDateKey,
  getDateKeyForTimezone,
  getDayOfMonthForTimezone,
  getEndOfDayForTimezone,
  getMonthForTimezone,
  getStartOfDayForTimezone,
  getTimezoneOffsetMinutes,
  parseDateInput,
  shiftDateToClientTimezone,
} = require('../utils/date')

router.get('/daily/:date', auth, async (req, res) => {
  try {
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(req.get('x-timezone-offset'))
    const d = parseDateInput(req.params.date)
    if (!d) return res.status(400).json({ message: 'Invalid date' })

    const start = getStartOfDayForTimezone(req.params.date, timezoneOffsetMinutes)
    const end = getEndOfDayForTimezone(req.params.date, timezoneOffsetMinutes)
    const tasks = await Task.find({
      ...getVisibleTaskQuery(req.user),
      creationTime: { $gte: start, $lte: end },
    }).select('status creationTime').lean()
    const total = tasks.length, completed = tasks.filter(t => t.status === 'Completed').length
    const pct = total === 0 ? 0 : Math.round((completed/total)*100)

    const rangeStart = new Date(start)
    rangeStart.setUTCDate(rangeStart.getUTCDate() - 6)

    const weeklyTasks = await Task.find({
      ...getVisibleTaskQuery(req.user),
      creationTime: { $gte: rangeStart, $lte: end },
    }).select('status creationTime').lean()

    const weeklyMap = weeklyTasks.reduce((map, task) => {
      const key = getDateKeyForTimezone(task.creationTime, timezoneOffsetMinutes)
      const entry = map.get(key) || { total: 0, completed: 0 }
      entry.total += 1
      if (task.status === 'Completed') entry.completed += 1
      map.set(key, entry)
      return map
    }, new Map())

    const data = Array.from({ length: 7 }, (_, index) => {
      const current = new Date(rangeStart)
      current.setUTCDate(rangeStart.getUTCDate() + index)
      const key = getDateKeyForTimezone(current, timezoneOffsetMinutes)
      const entry = weeklyMap.get(key)
      const labelDate = shiftDateToClientTimezone(current, timezoneOffsetMinutes)
      return {
        day: labelDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        pct: !entry?.total ? 0 : Math.round((entry.completed / entry.total) * 100),
      }
    })

    res.json({ pct, completed, total, pending: total - completed, data })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

router.get('/monthly/:month/:year', auth, async (req, res) => {
  try {
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(req.get('x-timezone-offset'))
    const month = Number(req.params.month)
    const year = Number(req.params.year)
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 1970) {
      return res.status(400).json({ message: 'Invalid month or year' })
    }

    const monthStartKey = `${year}-${String(month).padStart(2, '0')}-01`
    const monthEndKey = getDateKey(new Date(year, month, 0))
    const start = getStartOfDayForTimezone(monthStartKey, timezoneOffsetMinutes)
    const end = getEndOfDayForTimezone(monthEndKey, timezoneOffsetMinutes)
    const tasks = await Task.find({
      ...getVisibleTaskQuery(req.user),
      creationTime: { $gte: start, $lte: end },
    }).select('status creationTime').lean()

    const dayMap = tasks.reduce((map, task) => {
      const day = getDayOfMonthForTimezone(task.creationTime, timezoneOffsetMinutes)
      const entry = map.get(day) || { day, total: 0, completed: 0 }
      entry.total += 1
      if (task.status === 'Completed') entry.completed += 1
      map.set(day, entry)
      return map
    }, new Map())

    const result = Array.from(dayMap.values())
      .sort((left, right) => left.day - right.day)
      .map((entry) => ({
        day: entry.day,
        pct: entry.total === 0 ? 0 : Math.round((entry.completed / entry.total) * 100),
      }))

    const avgPct = result.length === 0 ? 0 : Math.round(result.reduce((s, r) => s + r.pct, 0) / result.length)
    res.json({ pct: avgPct, daysWithTasks: result.length, data: result })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

router.get('/yearly/:year', auth, async (req, res) => {
  try {
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(req.get('x-timezone-offset'))
    const year = Number(req.params.year)
    if (!Number.isInteger(year) || year < 1970) {
      return res.status(400).json({ message: 'Invalid year' })
    }

    const start = getStartOfDayForTimezone(`${year}-01-01`, timezoneOffsetMinutes)
    const end = getEndOfDayForTimezone(`${year}-12-31`, timezoneOffsetMinutes)
    const tasks = await Task.find({
      ...getVisibleTaskQuery(req.user),
      creationTime: { $gte: start, $lte: end },
    }).select('status creationTime').lean()

    const monthMap = tasks.reduce((map, task) => {
      const month = getMonthForTimezone(task.creationTime, timezoneOffsetMinutes)
      const entry = map.get(month) || { month, total: 0, completed: 0 }
      entry.total += 1
      if (task.status === 'Completed') entry.completed += 1
      map.set(month, entry)
      return map
    }, new Map())

    const result = Array.from(monthMap.values())
      .sort((left, right) => left.month - right.month)
      .map((entry) => ({
        month: entry.month,
        pct: entry.total === 0 ? 0 : Math.round((entry.completed / entry.total) * 100),
      }))

    const avgPct = result.length === 0 ? 0 : Math.round(result.reduce((s, r) => s + r.pct, 0) / result.length)
    res.json({ pct: avgPct, monthsWithData: result.length, data: result })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

module.exports = router
