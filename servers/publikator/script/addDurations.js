#!/usr/bin/env node
/**
 * This script adds duration to the embeds and audioSource of
 * all published articles.
 *
 * Usage: (run from servers/publikator)
 * node script/addDurations.js [-n [num]] [--dry]
 * -n: stop after n fixes
 * -- dry: don't commit/publish
 */

const transformPublications = require('./lib/transformPublications')
const visit = require('unist-util-visit')

const getEmbed = require('../graphql/resolvers/_queries/embed')

const platformToEmbedType = {
  vimeo: 'VimeoEmbed',
  youtube: 'YoutubeEmbed'
}

const transform = async (doc, context) => {
  const mdast = doc.content
  const promises = []
  visit(mdast, 'zone', (node, i, parent) => {
    promises.push(new Promise(async (resolve, reject) => {
      if (node.identifier === 'EMBEDVIDEO') {
        if (['vimeo', 'youtube'].includes(node.data.platform)) {
          let newEmbed
          try {
            newEmbed = await getEmbed(
              null,
              {
                embedType: platformToEmbedType[node.data.platform],
                id: node.data.id
              },
              context
            )
          } catch (e) {
            console.log('error getEmbed', e, { newEmbed, node })
          }
          if (newEmbed && newEmbed.durationMs && !node.data.durationMs) {
            node.data.durationMs = newEmbed.durationMs
            resolve(true)
          }
        }
      }
      resolve(false)
    }))
  })
  const results = await Promise.all(promises)
  if (
    results.find(r => !!r) ||
    // simple republish will augment audioSource with duration
    (doc.meta && doc.meta.audioSource && !doc.meta.audioSource.durationMs)
  ) {
    return 'hinzugefügt: abspieldauer video/audio'
  }
  return false
}

transformPublications({
  transform
})
