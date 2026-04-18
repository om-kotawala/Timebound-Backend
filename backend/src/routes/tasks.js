
const router  = require('express').Router()
const auth    = require('../middleware/auth')
const Task    = require('../models/Task')
const User    = require('../models/User')
const { getVisibleTaskQuery } = require('../utils/taskVisibility')
const {
  getDateKeyForTimezone,
  getEndOfDayForTimezone,
  getStartOfDayForTimezone,
  getTimezoneOffsetMinutes,
  parseDateInput,
} = require('../utils/date')

const getDeadline = () => { const d = new Date(); d.setHours(23,59,0,0); return d }
const PRIORITY_ORDER = { Important: 0, Urgent: 1, Medium: 2 }
const sortByPriority = (a, b) => (PRIORITY_ORDER[a.priority]??3) - (PRIORITY_ORDER[b.priority]??3)
const ASSIGNABLE_ROLE_MAP = {
  Principal: ['HOD', 'Professor', 'Student'],
  HOD: ['Professor', 'Student'],
  Professor: ['Student'],
  Student: [],
}

const sameId = (left, right) => String(left) === String(right)
const canAssignRole = (fromRole, toRole) => (ASSIGNABLE_ROLE_MAP[fromRole] || []).includes(toRole)
const isAssignedTask = (task) => task.category === 'Assigned'
const getTaskCreator = (task) => task.createdBy || task.userId

const getTaskView = (task, currentUserId) => {
  if (!isAssignedTask(task)) return 'Personal'
  if (sameId(task.userId?._id || task.userId, currentUserId)) return 'AssignedToMe'
  if (sameId(getTaskCreator(task)?._id || getTaskCreator(task), currentUserId)) return 'AssignedByMe'
  return 'Personal'
}

const serializeTask = (task, currentUserId) => {
  const taskView = getTaskView(task, currentUserId)
  const locked = task.isLocked || new Date(task.deadline) < new Date()
  const creator = getTaskCreator(task)
  const canManage = !isAssignedTask(task)
    ? sameId(task.userId?._id || task.userId, currentUserId)
    : sameId(creator?._id || creator, currentUserId)
  const canComplete = sameId(task.userId?._id || task.userId, currentUserId)

  return {
    ...task,
    createdBy: creator,
    category: isAssignedTask(task) ? 'Assigned' : 'Personal',
    isLocked: locked,
    taskView,
    permissions: {
      canEdit: canManage && task.status !== 'Completed' && !locked,
      canDelete: canManage && task.status !== 'Completed' && !locked,
      canComplete: canComplete && task.status !== 'Completed' && !locked,
    },
  }
}

const loadTaskForResponse = async (taskId, currentUserId) => {
  const task = await Task.findById(taskId)
    .populate('userId', 'name email role')
    .populate('createdBy', 'name email role')
    .lean()

  return serializeTask(task, currentUserId)
}

// POST /api/tasks
router.post('/', auth, async (req, res) => {
  try {
    const { title, priority, taskType = 'Personal', assigneeId } = req.body
    if (!title?.trim()) return res.status(400).json({ message: 'Title required' })

    let taskPayload = {
      userId: req.user._id,
      createdBy: req.user._id,
      category: 'Personal',
      title: title.trim(),
      priority: priority || 'Medium',
      creationTime: new Date(),
      deadline: getDeadline(),
    }

    if (taskType === 'Assigned') {
      if (!assigneeId) return res.status(400).json({ message: 'Assignee is required for assigned tasks' })
      if (sameId(assigneeId, req.user._id)) return res.status(400).json({ message: 'Use a personal task when assigning to yourself' })

      const assignee = await User.findById(assigneeId).select('name role')
      if (!assignee) return res.status(404).json({ message: 'Assignee not found' })
      if (!canAssignRole(req.user.role, assignee.role)) {
        return res.status(403).json({ message: `A ${req.user.role} cannot assign tasks to a ${assignee.role}` })
      }

      taskPayload = {
        ...taskPayload,
        userId: assignee._id,
        category: 'Assigned',
      }
    }

    const task = await Task.create(taskPayload)
    const responseTask = await loadTaskForResponse(task._id, req.user._id)
    res.status(201).json({ task: responseTask })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

// GET /api/tasks/assignable-users
router.get('/assignable-users', auth, async (req, res) => {
  try {
    const roles = ASSIGNABLE_ROLE_MAP[req.user.role] || []
    if (!roles.length) return res.json({ users: [] })

    const users = await User.find({
      _id: { $ne: req.user._id },
      role: { $in: roles },
    })
      .select('name email role')
      .sort({ role: 1, name: 1 })
      .lean()

    res.json({ users })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

// GET /api/tasks/today
router.get('/today', auth, async (req, res) => {
  try {
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(req.get('x-timezone-offset'))
    const todayKey = getDateKeyForTimezone(new Date(), timezoneOffsetMinutes)
    const start = getStartOfDayForTimezone(todayKey, timezoneOffsetMinutes)
    const end = getEndOfDayForTimezone(todayKey, timezoneOffsetMinutes)

    const tasks = await Task.find({
      ...getVisibleTaskQuery(req.user),
      creationTime: { $gte: start, $lte: end },
    })
      .populate('userId', 'name email role')
      .populate('createdBy', 'name email role')
      .lean()

    // Update lock status
    const now = new Date()
    const updated = tasks
      .map((t) => serializeTask({ ...t, isLocked: t.isLocked || new Date(t.deadline) < now }, req.user._id))
    updated.sort(sortByPriority)
    res.json({ tasks: updated })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

// GET /api/tasks/date/:date
router.get('/date/:date', auth, async (req, res) => {
  try {
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(req.get('x-timezone-offset'))
    const parsedDate = parseDateInput(req.params.date)
    if (!parsedDate) return res.status(400).json({ message: 'Invalid date' })

    const start = getStartOfDayForTimezone(req.params.date, timezoneOffsetMinutes)
    const end = getEndOfDayForTimezone(req.params.date, timezoneOffsetMinutes)
    const tasks = await Task.find({
      ...getVisibleTaskQuery(req.user),
      creationTime: { $gte: start, $lte: end },
    })
      .populate('userId', 'name email role')
      .populate('createdBy', 'name email role')
      .lean()

    const responseTasks = tasks.map((task) => serializeTask(task, req.user._id))
    res.json({ tasks: responseTasks })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

// PUT /api/tasks/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ message: 'Task not found' })
    const canManage = !isAssignedTask(task)
      ? sameId(task.userId, req.user._id)
      : sameId(getTaskCreator(task), req.user._id)
    if (!canManage) return res.status(403).json({ message: 'You cannot edit this task' })
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed, cannot edit' })
    const { title, priority } = req.body
    if (title) task.title = title.trim()
    if (priority) task.priority = priority
    await task.save()
    const responseTask = await loadTaskForResponse(task._id, req.user._id)
    res.json({ task: responseTask })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

// DELETE /api/tasks/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ message: 'Task not found' })
    const canManage = !isAssignedTask(task)
      ? sameId(task.userId, req.user._id)
      : sameId(getTaskCreator(task), req.user._id)
    if (!canManage) return res.status(403).json({ message: 'You cannot delete this task' })
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed, cannot delete' })
    await task.deleteOne()
    res.json({ message: 'Task deleted' })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

// PATCH /api/tasks/:id/complete
router.patch('/:id/complete', auth, async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.user._id })
    if (!task) return res.status(404).json({ message: 'Task not found' })
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed' })
    if (task.status === 'Completed') return res.status(400).json({ message: 'Task already completed' })
    task.status = 'Completed'; task.completedAt = new Date()
    await task.save()
    const responseTask = await loadTaskForResponse(task._id, req.user._id)
    res.json({ task: responseTask })
  } catch (e) { res.status(500).json({ message: 'Server error' }) }
})

module.exports = router
