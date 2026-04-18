
const mongoose = require('mongoose')

const ROLES = ['Principal', 'HOD', 'Professor', 'Student']

const UserSchema = new mongoose.Schema({
  email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:        { type: String, trim: true, default: '' },
  occupation:  { type: String, trim: true, default: '' },
  role:        { type: String, enum: ROLES, required: true, default: 'Student' },
  monthlyGoal: { type: Number, default: 30, min: 0, max: 100 },
}, { timestamps: true })

module.exports = mongoose.model('User', UserSchema)
