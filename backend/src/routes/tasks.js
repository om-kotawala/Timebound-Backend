const multer = require('multer')
const router = require('express').Router()
const auth = require('../middleware/auth')
const Task = require('../models/Task')
const User = require('../models/User')
const { getVisibleTaskQuery } = require('../utils/taskVisibility')
const {
  getDateKeyForTimezone,
  getEndOfDayForTimezone,
  getStartOfDayForTimezone,
  getEndOfTodayInIST,
  parseDateInput,
} = require('../utils/date')

const PRIORITY_ORDER = { Important: 0, Urgent: 1, Medium: 2 }
const ASSIGNABLE_ROLE_MAP = {
  Principal: ['HOD', 'Professor', 'Student'],
  HOD: ['Professor', 'Student'],
  Professor: ['Student'],
  Student: [],
}

const uploadProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

const sortByPriority = (a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)
const sameId = (left, right) => String(left) === String(right)
const canAssignRole = (fromRole, toRole) => (ASSIGNABLE_ROLE_MAP[fromRole] || []).includes(toRole)
const isAssignedTask = (task) => task.category === 'Assigned'
const getTaskCreator = (task) => task.createdBy || task.userId
const buildApiBaseUrl = (req) => `${req.protocol}://${req.get('host')}`
const getDeadline = () => getEndOfTodayInIST()

const populateTaskQuery = (query) => query
  .populate('userId', 'name email role')
  .populate('createdBy', 'name email role')
  .populate('proofSubmission.reviewedBy', 'name email role')

const isTaskVisibleToUser = (task, userId) => {
  if (!task) return false
  if (!isAssignedTask(task)) return sameId(task.userId?._id || task.userId, userId)
  return sameId(task.userId?._id || task.userId, userId) || sameId(getTaskCreator(task)?._id || getTaskCreator(task), userId)
}

const getTaskView = (task, currentUserId) => {
  if (!isAssignedTask(task)) return 'Personal'
  if (sameId(task.userId?._id || task.userId, currentUserId)) return 'AssignedToMe'
  if (sameId(getTaskCreator(task)?._id || getTaskCreator(task), currentUserId)) return 'AssignedByMe'
  return 'Personal'
}

const serializeProofSubmission = (task, apiBaseUrl) => {
  const proof = task.proofSubmission
  if (!proof?.fileName) return null

  return {
    fileName: proof.fileName,
    mimeType: proof.mimeType,
    size: proof.size,
    submittedAt: proof.submittedAt,
    status: proof.status,
    rejectionReason: proof.rejectionReason || '',
    reviewedAt: proof.reviewedAt || null,
    reviewedBy: proof.reviewedBy || null,
    fileUrl: `${apiBaseUrl}/api/tasks/${task._id}/proof/file`,
  }
}

const serializeTask = (task, currentUserId, apiBaseUrl) => {
  const taskView = getTaskView(task, currentUserId)
  const locked = task.isLocked || new Date(task.deadline) < new Date()
  const creator = getTaskCreator(task)
  const isAssignee = sameId(task.userId?._id || task.userId, currentUserId)
  const isCreator = sameId(creator?._id || creator, currentUserId)
  const proofStatus = task.proofSubmission?.status || 'not_submitted'
  const canManage = !isAssignedTask(task) ? isAssignee : isCreator

  return {
    ...task,
    createdBy: creator,
    category: isAssignedTask(task) ? 'Assigned' : 'Personal',
    isLocked: locked,
    taskView,
    proofSubmission: serializeProofSubmission(task, apiBaseUrl),
    permissions: {
      canEdit: canManage && task.status !== 'Completed' && !locked,
      canDelete: canManage && task.status !== 'Completed' && !locked,
      canComplete: !isAssignedTask(task) && isAssignee && task.status !== 'Completed' && !locked,
      canSubmitProof: isAssignedTask(task) && isAssignee && task.status !== 'Completed' && !locked && proofStatus !== 'pending_review',
      canReviewProof: isAssignedTask(task) && isCreator && task.status !== 'Completed' && !locked && proofStatus === 'pending_review',
    },
  }
}

const loadTaskForResponse = async (taskId, currentUserId, apiBaseUrl) => {
  const task = await populateTaskQuery(Task.findById(taskId)).lean()
  if (!task) return null
  return serializeTask(task, currentUserId, apiBaseUrl)
}

const proofUploadMiddleware = (req, res, next) => {
  uploadProof.single('proof')(req, res, (err) => {
    if (!err) return next()
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Proof file must be 10 MB or smaller' })
    }
    return res.status(400).json({ message: err.message || 'Invalid proof upload' })
  })
}

const loadVisibleTaskDocument = async (taskId, userId) => {
  const task = await Task.findById(taskId)
  if (!task || !isTaskVisibleToUser(task, userId)) return null
  return task
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
    const responseTask = await loadTaskForResponse(task._id, req.user._id, buildApiBaseUrl(req))
    res.status(201).json({ task: responseTask })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
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
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// GET /api/tasks/today
router.get('/today', auth, async (req, res) => {
  try {
    const todayKey = getDateKeyForTimezone(new Date())
    const start = getStartOfDayForTimezone(todayKey)
    const end = getEndOfDayForTimezone(todayKey)

    const tasks = await populateTaskQuery(Task.find({
      ...getVisibleTaskQuery(req.user),
      creationTime: { $gte: start, $lte: end },
    })).lean()

    const now = new Date()
    const apiBaseUrl = buildApiBaseUrl(req)
    const updated = tasks
      .map((task) => serializeTask({ ...task, isLocked: task.isLocked || new Date(task.deadline) < now }, req.user._id, apiBaseUrl))
    updated.sort(sortByPriority)

    res.json({ tasks: updated })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// GET /api/tasks/date/:date
router.get('/date/:date', auth, async (req, res) => {
  try {
    const parsedDate = parseDateInput(req.params.date)
    if (!parsedDate) return res.status(400).json({ message: 'Invalid date' })

    const start = getStartOfDayForTimezone(req.params.date)
    const end = getEndOfDayForTimezone(req.params.date)
    const tasks = await populateTaskQuery(Task.find({
      ...getVisibleTaskQuery(req.user),
      creationTime: { $gte: start, $lte: end },
    })).lean()

    const apiBaseUrl = buildApiBaseUrl(req)
    const responseTasks = tasks.map((task) => serializeTask(task, req.user._id, apiBaseUrl))
    res.json({ tasks: responseTasks })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// GET /api/tasks/:id/proof/file
router.get('/:id/proof/file', auth, async (req, res) => {
  try {
    const task = await populateTaskQuery(Task.findById(req.params.id))
    if (!task || !isTaskVisibleToUser(task, req.user._id)) {
      return res.status(404).json({ message: 'Task not found' })
    }
    if (!task.proofSubmission?.data?.length) {
      return res.status(404).json({ message: 'Proof file not found' })
    }

    res.setHeader('Content-Type', task.proofSubmission.mimeType || 'application/octet-stream')
    res.setHeader('Content-Length', String(task.proofSubmission.size || task.proofSubmission.data.length))
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(task.proofSubmission.fileName || 'proof-file')}"`)
    return res.send(task.proofSubmission.data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// POST /api/tasks/:id/proof
router.post('/:id/proof', auth, proofUploadMiddleware, async (req, res) => {
  try {
    const task = await loadVisibleTaskDocument(req.params.id, req.user._id)
    if (!task) return res.status(404).json({ message: 'Task not found' })
    if (!isAssignedTask(task)) return res.status(400).json({ message: 'Proof is only required for assigned tasks' })
    if (!sameId(task.userId, req.user._id)) return res.status(403).json({ message: 'Only the assignee can submit proof' })
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed' })
    if (task.status === 'Completed') return res.status(400).json({ message: 'Task already completed' })
    if (!req.file) return res.status(400).json({ message: 'A proof file is required' })

    task.proofSubmission = {
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      data: req.file.buffer,
      submittedAt: new Date(),
      status: 'pending_review',
      rejectionReason: '',
      reviewedAt: null,
      reviewedBy: null,
    }

    await task.save()
    const responseTask = await loadTaskForResponse(task._id, req.user._id, buildApiBaseUrl(req))
    res.json({ task: responseTask })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// PATCH /api/tasks/:id/proof/approve
router.patch('/:id/proof/approve', auth, async (req, res) => {
  try {
    const task = await loadVisibleTaskDocument(req.params.id, req.user._id)
    if (!task) return res.status(404).json({ message: 'Task not found' })
    if (!isAssignedTask(task)) return res.status(400).json({ message: 'This task does not need proof approval' })
    if (!sameId(getTaskCreator(task), req.user._id)) return res.status(403).json({ message: 'Only the assigner can approve proof' })
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed' })
    if (task.status === 'Completed') return res.status(400).json({ message: 'Task already completed' })
    if (!task.proofSubmission?.fileName) return res.status(400).json({ message: 'No proof has been submitted yet' })
    if (task.proofSubmission.status !== 'pending_review') return res.status(400).json({ message: 'There is no pending proof to approve' })

    task.proofSubmission.status = 'approved'
    task.proofSubmission.rejectionReason = ''
    task.proofSubmission.reviewedAt = new Date()
    task.proofSubmission.reviewedBy = req.user._id
    task.status = 'Completed'
    task.completedAt = new Date()

    await task.save()
    const responseTask = await loadTaskForResponse(task._id, req.user._id, buildApiBaseUrl(req))
    res.json({ task: responseTask })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// PATCH /api/tasks/:id/proof/reject
router.patch('/:id/proof/reject', auth, async (req, res) => {
  try {
    const { reason } = req.body
    if (!reason?.trim()) return res.status(400).json({ message: 'Rejection reason is required' })

    const task = await loadVisibleTaskDocument(req.params.id, req.user._id)
    if (!task) return res.status(404).json({ message: 'Task not found' })
    if (!isAssignedTask(task)) return res.status(400).json({ message: 'This task does not need proof review' })
    if (!sameId(getTaskCreator(task), req.user._id)) return res.status(403).json({ message: 'Only the assigner can reject proof' })
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed' })
    if (task.status === 'Completed') return res.status(400).json({ message: 'Task already completed' })
    if (!task.proofSubmission?.fileName) return res.status(400).json({ message: 'No proof has been submitted yet' })
    if (task.proofSubmission.status !== 'pending_review') return res.status(400).json({ message: 'There is no pending proof to reject' })

    task.proofSubmission.status = 'rejected'
    task.proofSubmission.rejectionReason = reason.trim()
    task.proofSubmission.reviewedAt = new Date()
    task.proofSubmission.reviewedBy = req.user._id
    task.completedAt = null

    await task.save()
    const responseTask = await loadTaskForResponse(task._id, req.user._id, buildApiBaseUrl(req))
    res.json({ task: responseTask })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// PUT /api/tasks/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task || !isTaskVisibleToUser(task, req.user._id)) return res.status(404).json({ message: 'Task not found' })

    const canManage = !isAssignedTask(task)
      ? sameId(task.userId, req.user._id)
      : sameId(getTaskCreator(task), req.user._id)

    if (!canManage) return res.status(403).json({ message: 'You cannot edit this task' })
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed, cannot edit' })

    const { title, priority } = req.body
    if (title) task.title = title.trim()
    if (priority) task.priority = priority

    await task.save()
    const responseTask = await loadTaskForResponse(task._id, req.user._id, buildApiBaseUrl(req))
    res.json({ task: responseTask })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// DELETE /api/tasks/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task || !isTaskVisibleToUser(task, req.user._id)) return res.status(404).json({ message: 'Task not found' })

    const canManage = !isAssignedTask(task)
      ? sameId(task.userId, req.user._id)
      : sameId(getTaskCreator(task), req.user._id)

    if (!canManage) return res.status(403).json({ message: 'You cannot delete this task' })
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed, cannot delete' })

    await task.deleteOne()
    res.json({ message: 'Task deleted' })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

// PATCH /api/tasks/:id/complete
router.patch('/:id/complete', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task || !isTaskVisibleToUser(task, req.user._id)) return res.status(404).json({ message: 'Task not found' })
    if (!sameId(task.userId, req.user._id)) return res.status(403).json({ message: 'You cannot complete this task' })
    if (isAssignedTask(task)) {
      return res.status(403).json({ message: 'Assigned tasks can only be completed after proof approval by the assigner' })
    }
    if (task.isLocked || new Date(task.deadline) < new Date()) return res.status(403).json({ message: 'Task deadline has passed' })
    if (task.status === 'Completed') return res.status(400).json({ message: 'Task already completed' })

    task.status = 'Completed'
    task.completedAt = new Date()
    await task.save()

    const responseTask = await loadTaskForResponse(task._id, req.user._id, buildApiBaseUrl(req))
    res.json({ task: responseTask })
  } catch (e) {
    console.error(e)
    res.status(500).json({ message: 'Server error' })
  }
})

module.exports = router
