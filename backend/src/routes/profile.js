
const router = require('express').Router()
const auth   = require('../middleware/auth')
const User   = require('../models/User')

const serializeUser = (user) => ({
  _id: user._id,
  email: user.email,
  name: user.name,
  occupation: user.occupation,
  role: user.role,
  monthlyGoal: user.monthlyGoal,
})

router.get('/', auth, async (req, res) => {
  res.json({ user: serializeUser(req.user) })
})

router.put('/', auth, async (req, res) => {
  try {
    const { name, occupation, monthlyGoal } = req.body
    const updates = {}
    if (name !== undefined) updates.name = name.trim()
    if (occupation !== undefined) updates.occupation = occupation.trim()
    if (monthlyGoal !== undefined) updates.monthlyGoal = Math.max(0, Math.min(100, Number(monthlyGoal)))
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-__v')
    res.json({ user: serializeUser(user) })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

module.exports = router
