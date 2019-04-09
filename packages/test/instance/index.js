const path = require('path')
const PG = require('./PG')
const Redis = require('@orbiting/backend-modules-base/lib/Redis')
const buildClients = require('./buildClients')
const { getId } = require('./pool')

const debug = require('debug')('instance')

// this utility launches a server for testing
// the port, PG and redis instances are uniquely available to the instance.
// there can be multiple instance processes running simultaniously
// but there can only be one instance started in one process (because process.env is global)
//
// REDIS_URL: if set is has to be a base url, allowing to append '/db'
//
const init = async ({ serverName }) => {
  // checks
  if (global.instance) {
    throw new Error('only one instance per process')
  }
  global.instance = 'init'
  if (!serverName) {
    throw new Error('serverName missing')
  }

  const relativeServerPath = `../../../servers/${serverName}/`

  // load env of server
  require('@orbiting/backend-modules-env').config(
    path.join(__dirname, relativeServerPath, '.test.env')
  )
  require('@orbiting/backend-modules-env').config(
    path.join(__dirname, relativeServerPath, '.env')
  )

  const instanceId = await getId()

  const port = 5000 + instanceId

  // create PG DB
  const db = await PG.createAndMigrate(`test${instanceId}`)
  if (!db) {
    throw new Error('PG db creating failed')
  }

  const redisUrl = `${process.env.REDIS_URL || 'redis://127.0.0.1:6379'}/${instanceId}`

  debug({instanceId, redisUrl, port, databaseUrl: db.url})

  process.env.PORT = port
  process.env.DATABASE_URL = db.url
  process.env.REDIS_URL = redisUrl
  process.env.SEND_MAILS_LOG = false

  // flush redis
  const redis = Redis.connect()
  await redis.flushdbAsync()
  Redis.disconnect(redis)

  // require server's server.js and start
  const Server = require(`${relativeServerPath}server`)
  const server = await Server.start()

  const closeAndCleanup = async () => {
    await server.close()
    await db.drop()
    global.instance = null
  }

  global.instance = {
    server,
    closeAndCleanup,
    apolloFetch: buildClients(port).createApolloFetch(),
    createApolloFetch: buildClients(port).createApolloFetch,
    clients: buildClients(port),
    context: server.createGraphqlContext({})
  }
}

const bootstrapEnv = () => {
  if (!process.env.DEFAULT_MAIL_FROM_ADDRESS) {
    process.env.DEFAULT_MAIL_FROM_ADDRESS = 'test@test.republik.ch'
  }
  if (!process.env.DEFAULT_MAIL_FROM_NAME) {
    process.env.DEFAULT_MAIL_FROM_NAME = 'Test'
  }
}

module.exports = {
  init,
  bootstrapEnv
}
