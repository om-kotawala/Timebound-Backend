const router = require('express').Router()
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const OTP = require('../models/OTP')
const auth = require('../middleware/auth')
const { sendOTPEmail } = require('../services/emailService')

const genOTP = () => Math.floor(100000 + Math.random() * 900000).toString()
const signToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET || 'secret_change_me', { expiresIn: '24h' })
const ROLES = ['Principal', 'HOD', 'Professor', 'Student']

const serializeUser = (user) => ({
  _id: user._id,
  email: user.email,
  name: user.name,
  occupation: user.occupation,
  role: user.role,
  monthlyGoal: user.monthlyGoal,
})

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, occupation, role, monthlyGoal } = req.body

    if (!name?.trim() || !email?.trim() || !occupation?.trim() || !role?.trim()) {
      return res.status(400).json({ message: 'Name, email, occupation, and role are required' })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const normalizedRole = role.trim()
    const existingUser = await User.findOne({ email: normalizedEmail })

    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered. Please log in.' })
    }

    if (!ROLES.includes(normalizedRole)) {
      return res.status(400).json({ message: 'Invalid role selected' })
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      occupation: occupation.trim(),
      role: normalizedRole,
      monthlyGoal: Math.max(0, Math.min(100, Number(monthlyGoal ?? 80))),
    })

    res.status(201).json({
      message: 'Registration successful',
      user: serializeUser(user),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ message: 'Email required' })

    const normalizedEmail = email.toLowerCase().trim()
    const user = await User.findOne({ email: normalizedEmail })
    if (!user) return res.status(404).json({ message: 'Email not registered. Please register first.' })

    const otp = genOTP()
    await OTP.create({ email: normalizedEmail, otp, expiresAt: new Date(Date.now() + 5 * 60000) })
    await sendOTPEmail(email, otp)
    res.json({ message: 'OTP sent' })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' })

    const normalizedEmail = email.toLowerCase().trim()
    const record = await OTP.findOne({
      email: normalizedEmail,
      otp,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 })

    if (!record) return res.status(400).json({ message: 'Invalid or expired OTP' })

    await OTP.updateOne({ _id: record._id }, { isUsed: true })
    const user = await User.findOne({ email: normalizedEmail })
    if (!user) return res.status(404).json({ message: 'User not found' })

    const token = signToken(user._id)
    res.json({
      token,
      user: serializeUser(user),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  res.json({ user: serializeUser(req.user) })
})

module.exports = router
