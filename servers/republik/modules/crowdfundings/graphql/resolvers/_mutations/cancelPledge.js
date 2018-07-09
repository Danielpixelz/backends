const logger = console
const { Roles } = require('@orbiting/backend-modules-auth')
const cancelMembership = require('./cancelMembership')

const moment = require('moment')
const { publishMonitor } = require('../../../../../lib/slack')

const {
  PARKING_PLEDGE_ID,
  PARKING_USER_ID
} = process.env

if (!PARKING_PLEDGE_ID || !PARKING_USER_ID) {
  console.warn('missing env PARKING_PLEDGE_ID and/or PARKING_USER_ID, cancelPledge will not work.')
}

module.exports = async (_, args, {
  pgdb,
  req,
  t,
  mail: { enforceSubscriptions }
}) => {
  if (!PARKING_PLEDGE_ID || !PARKING_USER_ID) {
    console.error('cancelPledge: missing PARKING_PLEDGE_ID and/or PARKING_USER_ID')
    throw new Error(t('api/unexpected'))
  }

  Roles.ensureUserHasRole(req.user, 'supporter')
  const {
    pledgeId,
    skipEnforceSubscriptions = false,
    transaction: externalTransaction
  } = args
  const now = new Date()
  const transaction = externalTransaction || await pgdb.transactionBegin()
  try {
    const pledge = await transaction.public.pledges.findOne({id: pledgeId})
    if (!pledge) {
      logger.error('pledge not found', { req: req._log(), pledgeId })
      throw new Error(t('api/pledge/404'))
    }
    if (pledge.id === PARKING_PLEDGE_ID || pledge.userId === PARKING_USER_ID) {
      const message = 'pledge PARKING_PLEDGE_ID by PARKING_USER_ID can not be cancelled'
      logger.error(message, { req: req._log(), pledge })
      throw new Error(message)
    }
    const pkg = await transaction.public.packages.findOne({
      id: pledge.packageId
    })

    if (pledge.status === 'DRAFT') {
      await transaction.public.pledges.deleteOne({
        id: pledgeId
      })
    } else {
      // MONTHLY can only be cancelled 14 days max after pledge
      const maxDays = 14
      if (pkg.name === 'MONTHLY_ABO' && moment().diff(moment(pledge.createdAt), 'days') > maxDays) {
        throw new Error(t('api/pledge/cancel/tooLate', { maxDays }))
      }

      await transaction.public.pledges.updateOne({id: pledgeId}, {
        status: 'CANCELLED',
        updatedAt: now
      })
    }

    const payments = await transaction.query(`
      SELECT
        pay.*
      FROM
        payments pay
      JOIN
        "pledgePayments" pp
        ON pp."paymentId" = pay.id
      JOIN
        pledges p
        ON pp."pledgeId" = p.id
      WHERE
        p.id = :pledgeId
    `, {
      pledgeId
    })

    for (let payment of payments) {
      let newStatus
      switch (payment.status) {
        case 'WAITING':
          newStatus = 'CANCELLED'
          break
        case 'PAID':
          newStatus = 'WAITING_FOR_REFUND'
          break
        default:
          newStatus = payment.status
      }
      if (newStatus !== payment.status) {
        await transaction.public.payments.updateOne({
          id: payment.id
        }, {
          status: newStatus,
          updatedAt: now
        })
      }
    }

    if (pkg.name === 'MONTHLY_ABO') {
      const memberships = await transaction.public.memberships.find({
        pledgeId
      })
      if (memberships.length) { // 0 for draft pledges
        await cancelMembership(
          null,
          {
            id: memberships[0].id,
            immediately: true
          },
          { pgdb: transaction, req, t }
        )
      }
    }
    await transaction.public.memberships.update({
      pledgeId: pledgeId
    }, {
      pledgeId: PARKING_PLEDGE_ID,
      userId: PARKING_USER_ID,
      updatedAt: now
    })

    if (!externalTransaction) {
      await transaction.transactionCommit()
    }

    if (!skipEnforceSubscriptions) {
      enforceSubscriptions({ pgdb, userId: pledge.userId })
    }

    await publishMonitor(
      req.user,
      `cancelPledge pledgeId: ${pledge.id} pkgName: ${pkg.name}`
    )
  } catch (e) {
    await transaction.transactionRollback()
    logger.info('transaction rollback', { req: req._log(), args, error: e })
    throw e
  }

  return pgdb.public.pledges.findOne({id: pledgeId})
}
