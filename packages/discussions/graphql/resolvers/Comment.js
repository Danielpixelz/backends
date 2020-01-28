const crypto = require('crypto')

const { Roles } = require('@orbiting/backend-modules-auth')
const { mdastToString } = require('@orbiting/backend-modules-utils')

// TODO don't require from servers
const {
  portrait: getPortrait,
  name: getName,
  slug: getSlug
} = require('../../../../servers/republik/graphql/resolvers/User')
const remark = require('../../lib/remark')
const { clipNamesInText } = require('../../lib/nameClipper')
const {
  linkPreview: {
    getLinkPreviewByUrl,
    clipUrlFromText
  }
} = require('@orbiting/backend-modules-embeds')

const {
  DISPLAY_AUTHOR_SECRET
} = process.env
if (!DISPLAY_AUTHOR_SECRET) {
  throw new Error('missing required DISPLAY_AUTHOR_SECRET')
}

const showLinkPreviewForComment = async ({ linkPreviewUrl, discussionId, depth }, context) => {
  if (!linkPreviewUrl) {
    return false
  }
  const discussion = await context.loaders.Discussion.byId.load(discussionId)
  if (discussion && discussion.isBoard && depth === 0) {
    return true
  }
  return false
}

const textForComment = async (
  comment,
  prettify = false,
  context
) => {
  const {
    userId,
    content,
    published,
    adminUnpublished,
    discussionId,
    linkPreviewUrl
  } = comment
  const {
    user: me
  } = context

  const isPublished = !!(published && !adminUnpublished)
  const isMine = !!(me && userId && userId === me.id)
  if (!isMine && !isPublished) {
    return null
  }

  let newContent = content
  if (!isMine && !Roles.userIsInRoles(me, ['member'])) {
    const namesToClip = await context.loaders.Discussion.byIdCommenterNamesToClip.load(discussionId)
    newContent = clipNamesInText(namesToClip, content)
  }
  if (prettify && await showLinkPreviewForComment(comment, context)) {
    newContent = clipUrlFromText(content, linkPreviewUrl)
  }
  return newContent
}

/**
 * @typedef {Object} Preview
 * @property {String}  string Preview string
 * @property {Boolean} more   If transformUser string was shortened
 * @property {Boolean} done   If true, char limit (<length>) has was reached
 */

/**
 * Stringifies an mdast tree into a single, plain string in a human readable
 * manner.
 *
 * @param  {Object}  node         mdast Object
 * @param  {Number}  [length=500] Maximum chars string should contain
 * @return {Preview}
 */
const mdastToHumanString = (node, length = 500) => {
  let string = ''
  const parts = mdastToString(node)
    .split(/\s+/)
    .filter(Boolean)

  do {
    const part = parts.shift()

    if (!part || string.length + part.length > length) {
      break
    }

    string += `${part} `
  } while (string.length <= length && parts.length > 0)

  return { string: string.trim(), more: parts.length > 0 }
}

module.exports = {
  discussion: ({ discussion, discussionId }, args, { loaders }) =>
    loaders.Discussion.byId.load(discussionId),

  published: ({ published, adminUnpublished }) =>
    published && !adminUnpublished,

  adminUnpublished: ({ userId, adminUnpublished }, args, { user }) =>
    Roles.userIsInRoles(user, ['editor', 'admin']) || (user && userId && userId === user.id)
      ? adminUnpublished
      : null,

  content: async (comment, args, context) => {
    const text = await textForComment(comment, true, context)
    if (!text) {
      return text
    }
    return remark.parse(text)
  },

  text: (comment, args, context) =>
    textForComment(comment, false, context),

  preview: async (comment, { length = 500 }, context) => {
    const text = await textForComment(comment, true, context)
    if (!text) {
      return null
    }
    return mdastToHumanString(remark.parse(text), length)
  },

  linkPreview: async (comment, args, context) => {
    if (await showLinkPreviewForComment(comment, context)) {
      return getLinkPreviewByUrl(comment.linkPreviewUrl, context)
    }
  },

  contentLength: async (comment, args, context) => {
    const text = await textForComment(comment, true, context)
    if (!text) {
      return null
    }
    return text.length
  },

  score: comment =>
    comment.upVotes - comment.downVotes,

  userCanEdit: ({ userId }, args, { user }) =>
    user && userId === user.id,

  userVote: ({ votes }, args, { user }) => {
    const userVote = user && votes.find(v => v.userId === user.id)
    if (userVote) {
      return userVote.vote === -1
        ? 'DOWN'
        : 'UP'
    }
    return null
  },

  parentIds: ({ parentIds }) =>
    parentIds || [],

  parent: ({ parentIds }, args, { loaders }, info) => {
    if (!parentIds) {
      return null
    }
    const parentId = parentIds.slice(-1).pop()
    const selections = info.fieldNodes[0].selectionSet.selections
    if (selections.length === 1 && selections[0].name.value === 'id') {
      return {
        id: parentId
      }
    }
    return loaders.Comment.byId.load(parentId)
  },

  author: async (comment, args, { user, loaders }) => {
    if (!comment.userId || !Roles.userIsInRoles(user, ['editor', 'admin'])) {
      return null
    }
    return loaders.User.byId.load(comment.userId)
  },

  displayAuthor: async (
    comment,
    args,
    context
  ) => {
    const {
      t,
      loaders
    } = context

    const id = crypto
      .createHmac('sha256', DISPLAY_AUTHOR_SECRET)
      .update(`${comment.discussionId}${comment.userId ? comment.userId : ''}`)
      .digest('hex')

    const anonymousComment = {
      id,
      name: t('api/comment/anonymous/displayName'),
      profilePicture: null,
      anonymity: true,
      username: null
    }

    if (!comment.userId) {
      return anonymousComment
    }

    const [discussion, commenter, commenterPreferences] = await Promise.all([
      loaders.Discussion.byId.load(comment.discussionId),
      loaders.User.byId.load(comment.userId),
      loaders.Discussion.Commenter.discussionPreferences.load({
        userId: comment.userId,
        discussionId: comment.discussionId
      })
    ])

    const credential = commenterPreferences && commenterPreferences.credential

    let anonymous
    if (discussion.anonymity === 'ENFORCED') {
      anonymous = true
    } else { // FORBIDDEN or ALLOWED
      if (commenterPreferences && commenterPreferences.anonymous != null) {
        anonymous = commenterPreferences.anonymous
      } else {
        anonymous = false
      }
    }

    const profilePicture = getPortrait(commenter, (args && args.portrait), context)
    const name = getName(commenter, null, context)
    const slug = getSlug(commenter, null, context)

    return anonymous
      ? {
        ...anonymousComment,
        credential
      }
      : {
        id,
        name: name || t('api/noname'),
        profilePicture: profilePicture,
        credential,
        anonymity: false,
        username: slug,
        slug
      }
  },

  comments: async (comment, args, { loaders, t }) => {
    if (comment.comments) {
      return comment.comments
    }

    const children = await loaders.Comment.byParentId.load(comment.id)
    const nodes = children.filter(child => child.parentIds.length === comment.depth + 1)

    if (children) {
      return {
        totalCount: children.length,
        directTotalCount: nodes.length,
        nodes
      }
    }

    throw new Error(t('api/unexpected'))
  },

  tags: (comment) =>
    comment.tags || [],

  mentioningDocument: async ({
    repoId,
    documentFragmentId: fragmentId
  }, args, { loaders }) => {
    if (!repoId) {
      return null
    }
    const doc = await loaders.Document.byRepoId.load(repoId)
    if (doc) {
      return {
        document: doc,
        fragmentId
      }
    }
  },

  userReportedAt: ({ reports }, args, { user: me }) =>
    me && reports && reports.reduce(
      (acc, r) => acc || (r.userId === me.id) ? r.reportedAt : null,
      null
    ),

  numReports: ({ reports }, args, { user: me }) =>
    Roles.userIsInRoles(me, ['editor', 'admin'])
      ? reports ? reports.length : 0
      : null
}
