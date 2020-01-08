const throng = require('throng')

const {
  LOCAL_ASSETS_SERVER,
  MAIL_EXPRESS_RENDER,
  WEB_CONCURRENCY = 1
} = process.env

const run = async (workerId, config) => {
  const { memoryUsage } = require('@orbiting/backend-modules-utils')
  const memoryUsageLogger = memoryUsage.run({ instance: `worker-${workerId}`, intervalSecs: 5 })

  require('@orbiting/backend-modules-env').config()

  const { merge } = require('apollo-modules-node')

  const { server: Server } = require('@orbiting/backend-modules-base')
  const { t } = require('@orbiting/backend-modules-translate')
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
    memoryUsageLogger.close()
    server.close()
  }

  process.on('SIGINT', close)
  process.on('SIGTERM', close)

  return {
    ...server,
    close
  }
}

if (WEB_CONCURRENCY === 1) {
  run(WEB_CONCURRENCY)
} else {
  throng(WEB_CONCURRENCY, run)
}

module.exports = {
  run
  // loaderBuilders
}
