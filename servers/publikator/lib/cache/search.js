const debug = require('debug')('publikator:cache:search')
const elasticsearch = require('@orbiting/backend-modules-base/lib/elastic')
const utils = require('@orbiting/backend-modules-search/lib/utils')

const client = elasticsearch.client()

/**
 * Determines desired sorting of data when querying ElasticSearch due to
 * passed arguments. Currently relies on {orderBy.field}, {orderBy.direction}
 * @param  {[type]} args [description]
 * @return {[type]}      [description]
 */
const getSort = (args) => {
  // Default sorting
  if (!args.orderBy) {
    return { sort: { 'latestCommit.date': 'desc' } }
  }

  // see https://developer.github.com/v4/enum/repositoryorderfield/
  const map = {
    'CREATED_AT': 'createdAt',
    'NAME': 'name.keyword',
    'PUSHED_AT': 'latestCommit.date',
    'UPDATED_AT': 'updatedAt'
    // 'STARGAZERS' is not implemented. Keeping in sync is hard.
  }

  const field = map[args.orderBy.field]

  if (!field) {
    throw new Error(
      `Unable to order by "${args.orderBy.field}", probably missing or not implemented.`
    )
  }

  return {
    sort: {
      [field]:
        args.orderBy.direction
          ? args.orderBy.direction.toLowerCase()
          : 'asc' // Default direction if not available.
    }
  }
}

/**
 * Fields ElasticSearch shall return. Excludes contentString, contentMeta and
 * other fields as they are not used to created a resolved document but for mere
 * index, query and search purposes.
 *
 * @return {Object} {_source} object for ElasticSearch client body.
 */
const getSourceFilter = () => ({
  _source: {
    excludes: [
      'contentMeta',
      'contentString',
      'createdAt',
      'name',
      'updatedAt'
    ]
  }
})

/**
 * Finds data in ElasticSearch index using passed arguments. Includes
 * pagination and sorting.
 *
 * @param  {[type]}  args [description]
 * @return {Promise}      [description]
 */
const find = async (args) => {
  debug(args)

  const fields = [
    'contentMeta.description',
    'contentMeta.facebookDescription',
    'contentMeta.facebookTitle',
    'contentMeta.format',
    'contentMeta.seriesMaster.episodes.document',
    'contentMeta.seriesMaster.episodes.label',
    'contentMeta.seriesMaster.episodes.title',
    'contentMeta.seriesMaster.title',
    'contentMeta.slug',
    'contentMeta.subject',
    'contentMeta.template',
    'contentMeta.title',
    'contentMeta.twitterDescription',
    'contentMeta.twitterTitle',
    'contentString',
    'name'
  ]

  const query = { bool: { must: [] } }

  if (args.search) {
    query.bool.must.push({
      simple_query_string: {
        query: args.search,
        fields,
        default_operator: 'AND'
      }
    })
  }

  if (args.template) {
    query.bool.must.push({
      term: { 'contentMeta.template': args.template }
    })
  }

  if (Object.keys(query.bool.must).length < 1) {
    delete query.bool
    query.match_all = {}
  }

  const docs = client.search({
    index: utils.getIndexAlias('repo', 'read'),
    from: args.from,
    size: args.first,
    body: {
      ...getSort(args),
      ...getSourceFilter(),
      query
    }
  })

  return docs
}

module.exports = {
  find
}
