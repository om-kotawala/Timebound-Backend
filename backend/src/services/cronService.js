const Task = require('../models/Task')
const User = require('../models/User')
const {
  sendDailyReport,
  sendDeadlineWarning,
} = require('./emailService')

// ================== LOCK EXPIRED TASKS ==================
exports.lockExpiredTasks = async () => {
  try {
    const now = new Date()

    const result = await Task.updateMany(
      { deadline: { $lt: now }, isLocked: false },
      { $set: { isLocked: true } }
    )

    if (result.modifiedCount > 0) {
      console.log(`🔒 Locked ${result.modifiedCount} expired tasks`)
    }
  } catch (e) {
    console.error('❌ lockExpiredTasks error:', e.message)
  }
}

// ================== DEADLINE WARNINGS ==================
exports.sendDeadlineWarnings = async () => {
  try {
    const now = new Date()
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000)

    const tasks = await Task.find({
      status: 'Pending',
      isLocked: false,
      deadline: { $gte: now, $lte: twoHoursLater },
    }).populate('userId', 'email')

    if (!tasks.length) return

    // Group by user email
    const byUser = new Map()

    for (const t of tasks) {
      if (!t.userId?.email) continue

      const email = t.userId.email
      if (!byUser.has(email)) byUser.set(email, [])

      byUser.get(email).push({
        title: t.title,
        priority: t.priority,
      })
    }

    // Send emails in parallel (faster 🚀)
    await Promise.all(
      Array.from(byUser.entries()).map(([email, userTasks]) =>
        sendDeadlineWarning(email, userTasks).catch((err) =>
          console.error(`❌ Deadline mail failed for ${email}:`, err.message)
        )
      )
    )

    console.log(`⚠️ Deadline warnings sent to ${byUser.size} users`)
  } catch (e) {
    console.error('❌ sendDeadlineWarnings error:', e.message)
  }
}

// ================== DAILY REPORTS ==================
exports.sendDailyReports = async () => {
  try {
    const start = new Date()
    start.setHours(0, 0, 0, 0)

    const end = new Date()
    end.setHours(23, 59, 59, 999)

    // 🚀 Optimized aggregation instead of loop
    const reports = await Task.aggregate([
      {
        $match: {
          creationTime: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: '$userId',
          total: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0],
            },
          },
        },
      },
    ])

    if (!reports.length) return

    // Fetch user emails
    const userIds = reports.map((r) => r._id)
    const users = await User.find({ _id: { $in: userIds } }).select('email')

    const userMap = new Map()
    users.forEach((u) => userMap.set(u._id.toString(), u.email))

    // Send emails in parallel
    await Promise.all(
      reports.map((r) => {
        const email = userMap.get(r._id.toString())
        if (!email) return

        const pending = r.total - r.completed
        const pct = r.total ? Math.round((r.completed / r.total) * 100) : 0

        return sendDailyReport(email, {
          total: r.total,
          completed: r.completed,
          pending,
          pct,
        }).catch((err) =>
          console.error(`❌ Daily report failed for ${email}:`, err.message)
        )
      })
    )

    console.log(`📊 Daily reports sent to ${reports.length} users`)
  } catch (e) {
    console.error('❌ sendDailyReports error:', e.message)
  }
}