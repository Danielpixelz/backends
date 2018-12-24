const {
  contentUrlResolver,
  metaUrlResolver
} = require('../../lib/resolve')
const {
  processMembersOnlyZonesInContent,
  processRepoImageUrlsInContent,
  processRepoImageUrlsInMeta,
  processImageUrlsInContent
} = require('../../lib/process')
const { getMeta } = require('../../lib/meta')

const getDocuments = require('./_queries/documents')

const { addRelatedDocs } = require('@orbiting/backend-modules-search/lib/Documents')

const { lib: { webp: {
  addSuffix: addWebpSuffix
} } } = require('@orbiting/backend-modules-assets')

const shouldDeliverWebP = (argument = 'auto', req) => {
  if (argument === 'auto') {
    return req && req.get('Accept').indexOf('image/webp') > -1
  }
  return !!argument
}

module.exports = {
  content (doc, { urlPrefix, searchString, webp }, context, info) {
    // we only do auto slugging when in a published documents context
    // - this is easiest detectable by _all being present from documents resolver
    // - alt check info.path for documents / document being the root
    //   https://gist.github.com/tpreusse/f79833a023706520da53647f9c61c7f6
    if (doc._all) {
      contentUrlResolver(doc, doc._all, doc._usernames, undefined, urlPrefix, searchString, context.user || null)

      if (shouldDeliverWebP(webp, context.req)) {
        processRepoImageUrlsInContent(doc.content, addWebpSuffix)
        processImageUrlsInContent(doc.content, addWebpSuffix)
      }

      processMembersOnlyZonesInContent(doc.content, context.user)
    }
    return doc.content
  },
  meta (doc, { urlPrefix, searchString, webp }, context, info) {
    const meta = getMeta(doc)
    if (doc._all) {
      metaUrlResolver(meta, doc._all, doc._usernames, undefined, urlPrefix, searchString)

      if (shouldDeliverWebP(webp, context.req)) {
        processRepoImageUrlsInMeta(doc.content, addWebpSuffix)
      }
    }
    return meta
  },
  children (doc, { first, last, before, after, only, urlPrefix, searchString, webp }, context, info) {
    if (!doc || !doc.content || !doc.content.children) {
      return {
        pageInfo: {
          endCursor: null,
          startCursor: null,
          hasNextPage: false,
          hasPreviousPage: false
        },
        totalCount: 0,
        nodes: []
      }
    }
    if (doc._all) {
      contentUrlResolver(doc, doc._all, doc._usernames, undefined, urlPrefix, searchString, context.user || null)

      if (shouldDeliverWebP(webp, context.req)) {
        processRepoImageUrlsInContent(doc.content, addWebpSuffix)
        processImageUrlsInContent(doc.content, addWebpSuffix)
      }

      processMembersOnlyZonesInContent(doc.content, context.user)
    }

    const children = (doc.content.children.length && doc.content.children) || []
    const totalCount = children.length
    const firstIndex = 0
    const lastIndex = totalCount - 1
    const beginOffset = after
      ? children.findIndex(v => v.data.id === after) + 1
      : firstIndex
    // slice extracts up to but not including end
    const endOffset = before
      ? children.findIndex(v => v.data.id === before)
      : lastIndex + 1

    const isLast = last && !first
    const childrenSubset = only
      ? children.filter(child => child.data.id === only)
      : children.slice(beginOffset, endOffset)
    const nodes = isLast
      ? childrenSubset.slice(-1 * last)
      : childrenSubset.slice(0, first)
    const startCursor = nodes.length && nodes[0].data.id
    const endCursor = nodes.length && nodes.slice(-1)[0].data.id

    const hasNextPage = !!endCursor &&
      children.some((v, i) => v.data.id === endCursor && i < lastIndex)
    const hasPreviousPage = !!startCursor &&
      children.some((v, i) => v.data.id === startCursor && i > firstIndex)

    return {
      pageInfo: {
        startCursor,
        endCursor,
        hasNextPage,
        hasPreviousPage
      },
      totalCount,
      nodes
    }
  },
  async links (doc, args, context) {
    if (!doc._all) {
      throw new Error('Links not supported in this context.')
    }
    // if requested we have to resolve the related docs
    const nodes = doc._all.map(d => ({
      entity: {
        ...d,
        _all: doc._all
      },
      type: 'Document'
    }))
    await addRelatedDocs({
      connection: { nodes },
      context
    })
    return nodes
  },
  linkedDocuments (doc, args, context, info) {
    const hasDossierRepoId =
      doc.meta.template === 'dossier' &&
      doc.meta.repoId

    const hasFormatRepoId =
      doc.meta.template === 'format' &&
      doc.meta.repoId

    if (!hasDossierRepoId && !hasFormatRepoId) {
      return {
        pageInfo: {
          endCursor: null,
          startCursor: null,
          hasNextPage: false,
          hasPreviousPage: false
        },
        totalCount: 0,
        nodes: []
      }
    }

    if (hasDossierRepoId) {
      args.dossier = doc.id
    }

    if (hasFormatRepoId) {
      args.format = doc.id
    }

    return getDocuments(doc, args, context, info)
  }
}
