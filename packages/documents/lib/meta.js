const visit = require('unist-util-visit')
const { metaFieldResolver } = require('./resolve')

// TODO rename: getContentRelatedMeta
const getStaticMeta = doc => {
  let credits = []
  visit(doc.content, 'zone', node => {
    if (node.identifier === 'TITLE') {
      const paragraphs = node.children
        .filter(child => child.type === 'paragraph')
      if (paragraphs.length >= 2) {
        credits = paragraphs[paragraphs.length - 1].children
      }
    }
  })

  const { audioSourceMp3, audioSourceAac, audioSourceOgg } = doc.content.meta
  const audioSource = audioSourceMp3 || audioSourceAac || audioSourceOgg ? {
    mp3: audioSourceMp3,
    aac: audioSourceAac,
    ogg: audioSourceOgg
  } : null

  // added for elastic
  const authors = credits
    .filter(c => c.type === 'link')
    .map(a => a.children[0].value)
  // TODO series

  return {
    credits,
    audioSource,
    authors
  }
}

// TODO rename: getResolvedMeta
const getMeta = doc => {
  if (doc._meta) {
    return doc._meta
  }

  // see _all note in Document.content resolver
  const resolvedFields = doc._all
    ? metaFieldResolver(doc.content.meta, doc._all)
    : { }

  doc._meta = {
    ...doc.content.meta,
    ...getStaticMeta(doc),
    ...resolvedFields
  }
  return doc._meta
}

module.exports = {
  getMeta,
  getStaticMeta
}
