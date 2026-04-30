
const mongoose = require('mongoose')

const ProofSubmissionSchema = new mongoose.Schema({
  fileName: { type: String, trim: true, default: '' },
  mimeType: { type: String, trim: true, default: '' },
  size: { type: Number, default: 0 },
  data: { type: Buffer },
  submittedAt: { type: Date },
  status: {
    type: String,
    enum: ['pending_review', 'rejected', 'approved'],
  },
  rejectionReason: { type: String, trim: true, default: '' },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: false })

const TaskSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category:     { type: String, enum: ['Personal', 'Assigned'], default: 'Personal', index: true },
  title:        { type: String, required: true, maxlength: 200, trim: true },
  priority:     { type: String, enum: ['Important', 'Urgent', 'Medium'], default: 'Medium' },
  status:       { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
  isLocked:     { type: Boolean, default: false },
  creationTime: { type: Date, default: Date.now },
  deadline:     { type: Date, required: true },
  completedAt:  { type: Date },
  proofSubmission: { type: ProofSubmissionSchema, default: null },
}, { timestamps: true })

TaskSchema.index({ userId: 1, creationTime: -1 })
TaskSchema.index({ createdBy: 1, creationTime: -1 })
TaskSchema.index({ userId: 1, category: 1, creationTime: -1 })
TaskSchema.index({ createdBy: 1, category: 1, creationTime: -1 })
TaskSchema.index({ deadline: 1, isLocked: 1 })

module.exports = mongoose.model('Task', TaskSchema)
