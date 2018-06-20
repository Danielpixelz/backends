const { descending } = require('d3-array')
const uniqBy = require('lodash/uniqBy')
const yaml = require('../../lib/yaml')
const zipArray = require('../../lib/zipArray')
const {
  createGithubClients,
  commitNormalizer,
  getHeads,
  getCommit,
  getAnnotatedTags,
  getAnnotatedTag
} = require('../../lib/github')
const { transformUser } = require('@orbiting/backend-modules-auth')
const debug = require('debug')('publikator:repo')

const UNCOMMITTED_CHANGES_TTL = 7 * 24 * 60 * 60 * 1000 // 1 week in ms

module.exports = {
  commits: async (repo, { page }) => {
    const { githubRest } = await createGithubClients()
    const refs = await getHeads(repo.id)

    const [login, repoName] = repo.id.split('/')
    return Promise.all(
      refs.map(({ target: { oid } }) => {
        return githubRest
          .repos.getCommits({
            owner: login,
            repo: repoName,
            sha: oid,
            per_page: 100,
            page: page || 1
          })
          .then(response => response ? response.data : response)
          .then(commits => commits
            .map(commit => commitNormalizer({
              ...commit,
              repo
            }))
          )
      })
    )
      .then(commits => [].concat.apply([], commits))
      .then(commits => uniqBy(commits, 'id'))
      .then(commits => commits.sort((a, b) => descending(a.date, b.date)))
  },
  latestCommit: async (repo, args, context) => {
    if (repo.latestCommit) {
      return repo.latestCommit
    }
    return getHeads(repo.id)
      .then(refs => refs
        .map(ref => ref.target)
        .sort((a, b) => descending(a.author.date, b.author.date))
        .shift()
      )
      .then(({ oid: sha }) =>
        getCommit(repo, { id: sha }, context)
      )
  },
  commit: getCommit,
  uncommittedChanges: async (
    { id: repoId },
    args,
    { redis, pgdb }
  ) => {
    const minScore = new Date().getTime() - UNCOMMITTED_CHANGES_TTL
    const result = await redis.zrangeAsync(repoId, 0, -1, 'WITHSCORES')
      .then(objs => zipArray(objs))
    let userIds = []
    let expiredUserIds = []
    for (let r of result) {
      if (r.score > minScore) {
        userIds.push(r.value)
      } else {
        expiredUserIds.push(r.value)
      }
    }
    for (let expiredKey of expiredUserIds) {
      await redis.zremAsync(repoId, expiredKey)
    }
    return userIds.length
      ? pgdb.public.users.find({ id: userIds })
        .then(users => users.map(transformUser))
      : []
  },
  milestones: (repo) => {
    if (repo.tags && repo.tags.nodes) { // repos query
      return repo.tags.nodes
    }
    debug('milestones needs to query getAnnotatedTags repo %O', repo)
    return getAnnotatedTags(repo.id)
  },
  latestPublications: async (repo) => {
    const { id: repoId } = repo

    const publicationMetaDecorator = (publication) => {
      const {
        scheduledAt = undefined,
        updateMailchimp = false
      } = yaml.parse(publication.message)

      return {
        ...publication,
        meta: {
          scheduledAt,
          updateMailchimp
        }
      }
    }

    const liveRefs = [
      'publication',
      'prepublication'
    ]
    const refs = [
      ...liveRefs,
      'scheduled-publication',
      'scheduled-prepublication'
    ]

    if (!repo.latestPublications) {
      debug('latestPublications needs getAnnotatedTag for repo %O', repo)
    }

    // repos query gets the refs for us
    let annotatedTags = repo.latestPublications
      ? repo.latestPublications
      : await Promise.all(
        refs.map(ref => getAnnotatedTag(repoId, ref))
      )

    return Promise.all(
      annotatedTags
    )
      .then(tags => tags
        .filter(tag => !!tag)
        .map(tag => ({
          ...tag,
          sha: tag.oid,
          live: liveRefs.indexOf(tag.refName) > -1
        })
        )
      )
      .then(tags => uniqBy(tags, 'name').map(publicationMetaDecorator))
  },
  meta: async (repo) => {
    let message
    if (repo.meta) {
      return repo.meta
    } else if (repo.metaTag !== undefined) {
      message = repo.metaTag && repo.metaTag.target
        ? repo.metaTag.target.message
        : ''
    } else {
      debug('meta needs to query tag for repo %O', repo)
      const tag = await getAnnotatedTag(
        repo.id,
        'meta'
      )
      message = tag && tag.message
    }
    if (!message || message.length === 0) {
      return {}
    }
    return yaml.parse(message)
  }
}
