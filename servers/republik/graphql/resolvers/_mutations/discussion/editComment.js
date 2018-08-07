const { Roles } = require('@orbiting/backend-modules-auth')
const slack = require('../../../../lib/slack')

module.exports = async (_, args, context) => {
  const { id, content } = args
  const { pgdb, user, t, pubsub } = context

  Roles.ensureUserHasRole(user, 'member')

  if (!content || !content.trim().length) {
    throw new Error(t('api/comment/empty'))
  }

  const transaction = await pgdb.transactionBegin()
  try {
    // ensure comment exists and belongs to user
    const comment = await transaction.public.comments.findOne({ id })
    if (!comment) {
      throw new Error(t('api/comment/404'))
    }
    if (comment.userId !== user.id) {
      throw new Error(t('api/comment/notYours'))
    }

    const discussion = await transaction.public.discussions.findOne({
      id: comment.discussionId
    })

    if (discussion.closed) {
      throw new Error(t('api/comment/closed'))
    }
    // ensure comment length is within limit
    if (discussion.maxLength && content.length > discussion.maxLength) {
      throw new Error(t('api/comment/tooLong', { maxLength: discussion.maxLength }))
    }

    const newComment = await transaction.public.comments.updateAndGetOne({
      id: comment.id
    }, {
      content,
      published: true,
      updatedAt: new Date()
    })

    await transaction.transactionCommit()

    await pubsub.publish('comment', { comment: {
      mutation: 'UPDATED',
      node: newComment
    }})

    await slack.publishCommentUpdate(newComment, comment, discussion, context)

    return newComment
  } catch (e) {
    await transaction.transactionRollback()
    throw e
  }
}
