const debug = require('debug')('crowdfundings:lib:scheduler')
const PgDb = require('@orbiting/backend-modules-base/lib/PgDb')
const Redis = require('@orbiting/backend-modules-base/lib/Redis')
const { intervalScheduler } = require('@orbiting/backend-modules-schedulers')

const surplus = require('../../../../graphql/resolvers/RevenueStats/surplus')
const evolution = require('../../../../graphql/resolvers/MembershipStats/evolution')

const init = async (_context) => {
  debug('init')

  const pgdb = await PgDb.connect()
  const redis = Redis.connect()
  const context = {
    ..._context,
    pgdb,
    redis
  }

  const schedulers = [
    // stats-cache scheduler
    // @TODO: Keep or move elsewhere
    intervalScheduler.init({
      name: 'stats-cache',
      context,
      runFunc: (args, context) =>
        Promise.all([
          surplus(null, { min: '2019-12-01', forceRecache: true }, context),
          evolution(null, { min: '2019-12', max: '2020-03', forceRecache: true }, context)
        ]),
      lockTtlSecs: 6,
      runIntervalSecs: 8
    })
  ]

  const close = async () => {
    await Promise.all(
      schedulers.map(scheduler => scheduler.close())
    )
    await Promise.all([
      PgDb.disconnect(pgdb),
      Redis.disconnect(redis)
    ])
  }

  return {
    close
  }
}

module.exports = {
  init
}
