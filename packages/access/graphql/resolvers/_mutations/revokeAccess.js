const debug = require('debug')('access:mutation:revokeAccess')

const grantsLib = require('../../../lib/grants')

module.exports = async (_, args, { req, pgdb, t }) => {
  const { id } = args
  const { user } = req

  debug('begin', { id, user: user.id })

  const transaction = await pgdb.transactionBegin()

  try {
    const result = await grantsLib.revoke(id, user, t, pgdb)
    await transaction.transactionCommit()

    debug('commit', { id, user: user.id })

    return result
  } catch (e) {
    await transaction.transactionRollback()

    debug('rollback', { id, user: user.id })

    throw e
  }
}
