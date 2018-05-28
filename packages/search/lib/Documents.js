const {
  termEntry,
  countEntry
} = require('./schema')

const {
  rangeAggBuilder
} = require('./aggregations')

const {
  dateRangeCriteriaBuilder,
  rangeCriteriaBuilder
} = require('./filters')

// mean German, see http://iovs.arvojournals.org/article.aspx?articleid=2166061
const WORDS_PER_MIN = 180

const SHORT_DURATION_MINS = 5
const MIDDLE_DURATION_MINS = 15
const LONG_DURATION_MINS = 30

const schema = {
  type: termEntry('__type'),
  dossier: termEntry('meta.dossier'),
  format: termEntry('meta.format'),
  template: termEntry('meta.template'),
  repoId: termEntry('meta.repoId'),
  seriesMaster: termEntry('meta.seriesMaster'),
  userId: {
    ...termEntry('meta.credits.url'),
    parser: (value) => `/~${value}`
  },
  // path: {
  //  fieldPath: 'meta.path',
  //  criteriaBuilder: termCriteriaBuilder,
  //  aggBuilder: termAggBuilder
  // },
  publishedAt: {
    criteria: dateRangeCriteriaBuilder('meta.publishDate'),
    parser: (value) => {
      const [from, to] = value.split(',')
      return {
        from: new Date(from),
        to: new Date(to)
      }
    }
  },
  discussion: countEntry('meta.discussion'),
  feed: countEntry('meta.feed'),
  audio: countEntry('meta.audioSource.mp3'),
  textLength: {
    criteria: rangeCriteriaBuilder('contentString.count'),
    agg: rangeAggBuilder('contentString.count'),
    options: {
      ranges: [
        { key: 'short',
          to: WORDS_PER_MIN * SHORT_DURATION_MINS },
        { key: 'medium',
          from: WORDS_PER_MIN * SHORT_DURATION_MINS,
          to: WORDS_PER_MIN * MIDDLE_DURATION_MINS },
        { key: 'long',
          from: WORDS_PER_MIN * MIDDLE_DURATION_MINS,
          to: WORDS_PER_MIN * LONG_DURATION_MINS },
        { key: 'epic',
          from: WORDS_PER_MIN * LONG_DURATION_MINS }
      ]
    }
  }
}

const mdastToString = require('mdast-util-to-string')
const { mdastFilter } = require('./utils.js')
const uuid = require('uuid/v4')

const getElasticDoc = ({ indexName, indexType, doc }) => {
  const meta = doc.content.meta
  return {
    id: `${meta.repoId}/${uuid()}`,
    index: indexName,
    type: indexType,
    body: {
      __type: indexType,
      __sort: {
        date: meta.publishDate
      },
      id: doc.id, // is: Buffer.from(`repo:${repoId}:${commitId}`).toString('base64')
      meta,
      content: doc.content,
      contentString: mdastToString(
        mdastFilter(
          doc.content,
          node => node.type === 'code'
        )
      )
    }
  }
}

module.exports = {
  schema,
  getElasticDoc
}
