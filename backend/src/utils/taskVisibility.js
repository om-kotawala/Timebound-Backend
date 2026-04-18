const getVisibleTaskQuery = (user) => {
  const basePersonal = {
    userId: user._id,
    $or: [{ category: 'Personal' }, { category: { $exists: false } }],
  }
  const baseAssignedToMe = { userId: user._id, category: 'Assigned' }
  const baseAssignedByMe = { createdBy: user._id, category: 'Assigned' }

  if (user.role === 'Principal') return { $or: [basePersonal, baseAssignedByMe] }
  if (user.role === 'Student') return { $or: [basePersonal, baseAssignedToMe] }
  return { $or: [basePersonal, baseAssignedToMe, baseAssignedByMe] }
}

module.exports = {
  getVisibleTaskQuery,
}
