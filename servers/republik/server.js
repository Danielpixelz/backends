const { merge } = require('apollo-modules-node')
const cluster = require('cluster')
const Promise = require('bluebird')

const { NotifyListener: SearchNotifyListener } = require('@orbiting/backend-modules-search')
const { server: Server } = require('@orbiting/backend-modules-base')
const { t } = require('@orbiting/backend-modules-translate')
const SlackGreeter = require('@orbiting/backend-modules-slack/lib/SlackGreeter')
const { graphql: documents } = require('@orbiting/backend-modules-documents')
const { graphql: redirections } = require('@orbiting/backend-modules-redirections')
const { graphql: search } = require('@orbiting/backend-modules-search')
const { graphql: notifications } = require('@orbiting/backend-modules-notifications')
const { graphql: voting } = require('@orbiting/backend-modules-voting')
const { graphql: discussions } = require('@orbiting/backend-modules-discussions')
const { graphql: collections } = require('@orbiting/backend-modules-collections')
const { graphql: crowdsourcing } = require('@orbiting/backend-modules-crowdsourcing')
const { graphql: subscriptions } = require('@orbiting/backend-modules-subscriptions')
const { graphql: cards } = require('@orbiting/backend-modules-cards')
const { graphql: maillog } = require('@orbiting/backend-modules-maillog')
const { intervalScheduler } = require('@orbiting/backend-modules-schedulers')
const PgDb = require('@orbiting/backend-modules-base/lib/PgDb')
const Redis = require('@orbiting/backend-modules-base/lib/Redis')

const loaderBuilders = {
  ...require('@orbiting/backend-modules-voting/loaders'),
  ...require('@orbiting/backend-modules-discussions/loaders'),
  ...require('@orbiting/backend-modules-documents/loaders'),
  ...require('@orbiting/backend-modules-auth/loaders'),
  ...require('@orbiting/backend-modules-collections/loaders'),
  ...require('@orbiting/backend-modules-subscriptions/loaders'),
  ...require('@orbiting/backend-modules-cards/loaders')
}

const { graphql: access } = require('@orbiting/backend-modules-access')
const { preview: previewLib } = require('@orbiting/backend-modules-preview')

const mail = require('./modules/crowdfundings/lib/Mail')

const {
  LOCAL_ASSETS_SERVER,
  MAIL_EXPRESS_RENDER,
  SEARCH_PG_LISTENER
} = process.env

const start = async () => {
  const server = await run()
  const _runOnce = await runOnce({ clusterMode: false })

  const close = async () => {
    await server.close()
    await _runOnce.close()
  }

  return {
    ...server,
    close
  }
}

// in cluster mode, this runs after runOnce otherwise before
const run = async (workerId, config) => {
  const localModule = require('./graphql')
  const graphqlSchema = merge(
    localModule,
    [
      documents,
      search,
      redirections,
      discussions,
      notifications,
      access,
      voting,
      collections,
      crowdsourcing,
      subscriptions,
      cards,
      maillog
    ]
  )

  // middlewares
  const middlewares = [
    require('./modules/crowdfundings/express/paymentWebhooks'),
    require('./express/gsheets'),
    require('@orbiting/backend-modules-maillog/express/Mandrill/webhook')
  ]

  if (MAIL_EXPRESS_RENDER) {
    middlewares.push(require('@orbiting/backend-modules-mail/express/render'))
  }

  if (LOCAL_ASSETS_SERVER) {
    const { express } = require('@orbiting/backend-modules-assets')
    for (const key of Object.keys(express)) {
      middlewares.push(express[key])
    }
  }

  // signin hooks
  const signInHooks = [
    ({ userId, pgdb }) =>
      mail.sendPledgeConfirmations({ userId, pgdb, t }),
    ({ userId, isNew, contexts, pgdb }) =>
      previewLib.begin({ userId, contexts, pgdb, t })
  ]

  const createGraphQLContext = (defaultContext) => {
    const loaders = {}
    const context = {
      ...defaultContext,
      t,
      signInHooks,
      mail,
      loaders
    }
    Object.keys(loaderBuilders).forEach(key => {
      loaders[key] = loaderBuilders[key](context)
    })
    return context
  }

  const server = await Server.start(
    graphqlSchema,
    middlewares,
    t,
    createGraphQLContext,
    workerId,
    config
  )

  const close = () => {
    return server.close()
  }

  process.once('SIGTERM', close)

  return {
    ...server,
    close
  }
}

// in cluster mode, this runs before run otherwise after
const runOnce = async () => {
  if (cluster.isWorker) {
    throw new Error('runOnce must only be called on cluster.isMaster')
  }

  const slackGreeter = await SlackGreeter.start()

  let searchNotifyListener
  if (SEARCH_PG_LISTENER && SEARCH_PG_LISTENER !== 'false') {
    searchNotifyListener = await SearchNotifyListener.start()
  }

  const statsCacheScheduler = await intervalScheduler.init({
    name: 'stats-cache',
    context: await Promise.props({ pgdb: PgDb.connect(), redis: Redis.connect() }),
    runFunc: require('./modules/crowdfundings/lib/scheduler/stats-cache'),
    lockTtlSecs: 6,
    runIntervalSecs: 8
  })

  const close = async () => {
    slackGreeter && await slackGreeter.close()
    searchNotifyListener && await searchNotifyListener.close()
    statsCacheScheduler && await statsCacheScheduler.close()
  }

  process.once('SIGTERM', close)

  return {
    close
  }
}

module.exports = {
  start,
  run,
  runOnce,
  loaderBuilders
}
