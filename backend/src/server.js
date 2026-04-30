require('dotenv').config()

const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const cron = require('node-cron')

const authRoutes = require('./routes/auth')
const profileRoutes = require('./routes/profile')
const taskRoutes = require('./routes/tasks')
const progressRoutes = require('./routes/progress')
const { IST_TIMEZONE } = require('./utils/date')
const {
  lockExpiredTasks,
  sendDeadlineWarnings,
  sendDailyReports,
} = require('./services/cronService')

const app = express()

const PORT = process.env.PORT || 5000
const MONGO_URI = process.env.MONGODB_URI
const FRONTEND_URL = process.env.FRONTEND_URL

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}))

app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/tasks', taskRoutes)
app.use('/api/progress', progressRoutes)

app.get('/api/health', (_, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date(),
  })
})

const startCronJobs = () => {
  console.log('Starting cron jobs...')

  cron.schedule('* * * * *', async () => {
    try {
      await lockExpiredTasks()
    } catch (err) {
      console.error('lockExpiredTasks failed:', err.message)
    }
  }, { timezone: IST_TIMEZONE })

  cron.schedule('0 22 * * *', async () => {
    try {
      await sendDeadlineWarnings()
    } catch (err) {
      console.error('sendDeadlineWarnings failed:', err.message)
    }
  }, { timezone: IST_TIMEZONE })

  cron.schedule('59 23 * * *', async () => {
    try {
      await sendDailyReports()
    } catch (err) {
      console.error('sendDailyReports failed:', err.message)
    }
  }, { timezone: IST_TIMEZONE })

  cron.schedule('59 23 * * *', async () => {
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    if (tomorrow.getDate() === 1) {
      console.log('Monthly report hook pending implementation')
    }
  }, { timezone: IST_TIMEZONE })

  cron.schedule('59 23 31 12 *', async () => {
    console.log('Yearly report hook pending implementation')
  }, { timezone: IST_TIMEZONE })
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
  process.exit(1)
})

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err)
})

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected')

    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })

    startCronJobs()

    const shutdown = async () => {
      console.log('Shutting down server...')
      await mongoose.connection.close()
      server.close(() => {
        console.log('Server closed')
        process.exit(0)
      })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message)
    process.exit(1)
  })
