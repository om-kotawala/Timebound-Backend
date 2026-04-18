require('dotenv').config()

const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const cron = require('node-cron')

// Routes
const authRoutes = require('./routes/auth')
const profileRoutes = require('./routes/profile')
const taskRoutes = require('./routes/tasks')
const progressRoutes = require('./routes/progress')

// Cron services
const {
  lockExpiredTasks,
  sendDeadlineWarnings,
  sendDailyReports,
} = require('./services/cronService')

const app = express()

// ================== CONFIG ==================
const PORT = process.env.PORT || 5000
const MONGO_URI =
  process.env.MONGODB_URI
const FRONTEND_URL =
  process.env.FRONTEND_URL

// ================== MIDDLEWARE ==================
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
)

app.use(express.json())

// ================== ROUTES ==================
app.use('/api/auth', authRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/tasks', taskRoutes)
app.use('/api/progress', progressRoutes)

// ================== HEALTH CHECK ==================
app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date(),
  })
})

// ================== CRON JOBS ==================
const startCronJobs = () => {
  console.log('⏳ Starting cron jobs...')

  // 🔒 Every minute → lock expired tasks
  cron.schedule('* * * * *', async () => {
    try {
      await lockExpiredTasks()
    } catch (err) {
      console.error('❌ lockExpiredTasks failed:', err.message)
    }
  })

  // ⚠️ 10 PM → deadline warning
  cron.schedule('0 22 * * *', async () => {
    console.log('⚠️ Running deadline warnings...')
    try {
      await sendDeadlineWarnings()
    } catch (err) {
      console.error('❌ sendDeadlineWarnings failed:', err.message)
    }
  })

  // 📊 11:59 PM → daily report
  cron.schedule('59 23 * * *', async () => {
    console.log('📊 Running daily reports...')
    try {
      await sendDailyReports()
    } catch (err) {
      console.error('❌ sendDailyReports failed:', err.message)
    }
  })

  // 📅 Monthly report (last day)
  cron.schedule('59 23 * * *', async () => {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    if (tomorrow.getDate() === 1) {
      console.log('📅 Running monthly report...')
      // TODO: add monthly report logic
    }
  })

  // 🎉 Yearly report (Dec 31)
  cron.schedule('59 23 31 12 *', async () => {
    console.log('🎉 Running yearly report...')
    // TODO: add yearly report logic
  })
}

// ================== ERROR HANDLING ==================
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err)
  process.exit(1)
})

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err)
})

// ================== DB CONNECTION ==================
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected')

    // Start server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`)
    })

    // Start cron after DB is ready
    startCronJobs()

    // ================== GRACEFUL SHUTDOWN ==================
    const shutdown = async () => {
      console.log('🛑 Shutting down server...')

      await mongoose.connection.close()
      server.close(() => {
        console.log('✅ Server closed')
        process.exit(0)
      })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message)
    process.exit(1)
  })