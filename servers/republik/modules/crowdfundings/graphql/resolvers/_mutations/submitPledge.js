const logger = console
const postfinanceSHA = require('../../../lib/payments/postfinance/sha')
const uuid = require('uuid/v4')
const { minTotal, regularTotal, getPledgeOptionsTree } = require('../../../lib/Pledge')
const { resolvePackages, getCustomOptions } = require('../../../lib/CustomPackages')
const debug = require('debug')('crowdfundings:pledge')
const {
  Consents: {
    ensureAllRequiredConsents,
    saveConsents
  },
  AccessToken: {
    getUserByAccessToken,
    ensureCanPledgePackage
  }
} = require('@orbiting/backend-modules-auth')

module.exports = async (_, args, context) => {
  const { pgdb, req, t } = context
  const transaction = await pgdb.transactionBegin()
  try {
    const { pledge, consents } = args
    const pledgeOptions = pledge.options
    debug('submitPledge %O', pledge)

    // load original of chosen packageOptions
    const pledgeOptionsTemplateIds = pledgeOptions.map((plo) => plo.templateId)
    const packageOptions = await transaction.public.packageOptions.find({id: pledgeOptionsTemplateIds})

    const packageId = packageOptions[0].packageId
    const pkg = await pgdb.public.packages.findOne({ id: packageId })

    const resolvedPackage = (await resolvePackages({
      packages: [pkg],
      pledger: req.user,
      pgdb: transaction
    })).shift()

    debug({ resolvedPackage })

    const resolvedOptions = resolvedPackage.custom
      ? await getCustomOptions(resolvedPackage)
      : []

    debug({ resolvedOptions })

    // check if packageOptions are all from the same package
    // check if minAmount <= amount <= maxAmount
    // we don't check the pledgeOption price here, because the frontend always
    // sends whats in the templating packageOption, so we always copy the price
    // into the pledgeOption (for record keeping)
    pledgeOptions.forEach((plo) => {
      // Mutually exclusive membership options: Can only be requested once
      // within all options.
      if (
        plo.membershipId &&
        pledgeOptions.filter(
          o => o.membershipId === plo.membershipId && o.amount > 0
        ).length > 1
      ) {
        logger.error(
          'options w/ membershipIds must be mutually exclusive!',
          { req: req._log(), args, plo }
        )
        throw new Error(t('api/unexpected'))
      }

      // Check if passed options are valid custom package options.
      if (
        resolvedOptions.length > 0 &&
        !resolvedOptions
          .find(option =>
            option.templateId === plo.templateId &&
            option.membership.id === plo.membershipId
          )
      ) {
        logger.error(
          'options must be valid combination of templateId and membershipId',
          { req: req._log(), args, plo }
        )
        throw new Error(t('api/unexpected'))
      }

      const pko = packageOptions.find((pko) => pko.id === plo.templateId)

      if (packageId !== pko.packageId) {
        logger.error(
          'options must all be part of the same package!',
          { req: req._log(), args, plo, pko }
        )
        throw new Error(t('api/unexpected'))
      }

      if (!(pko.minAmount <= plo.amount && plo.amount <= pko.maxAmount)) {
        logger.error(
          `amount in option (templateId: ${plo.templateId}) out of range`,
          { req: req._log(), args, pko, plo }
        )
        throw new Error(t('api/unexpected'))
      }
    })

    // check if crowdfunding is still open
    const crowdfunding = await pgdb.public.crowdfundings.findOne({id: pkg.crowdfundingId})
    const now = new Date()
    const gracefullEnd = new Date(crowdfunding.endDate)
    gracefullEnd.setMinutes(now.getMinutes() + 20)
    if (gracefullEnd < now) {
      logger.error('crowdfunding already closed', { req: req._log(), args })
      throw new Error(t('api/crowdfunding/tooLate'))
    }

    // check total
    const pledgeMinTotal = minTotal(pledgeOptions, packageOptions)
    if (pledge.total < pledgeMinTotal) {
      logger.error(`pledge.total (${pledge.total}) must be >= (${pledgeMinTotal})`, { req: req._log(), args, pledgeMinTotal })
      throw new Error(t('api/unexpected'))
    }

    // calculate donation
    const pledgeRegularTotal = regularTotal(pledgeOptions, packageOptions)
    const donation = pledge.total - pledgeRegularTotal
    // check reason
    if (donation < 0 && !pledge.reason) {
      logger.error('you must provide a reason for reduced pledges', { req: req._log(), args, donation })
      throw new Error(t('api/pledge/reason'))
    }

    // check user
    let user = null
    let pfAliasId = null
    // wrong tokens are just ignored
    const accessTokenUser = pledge.accessToken && await getUserByAccessToken(pledge.accessToken, context)
    if (accessTokenUser) {
      ensureCanPledgePackage(accessTokenUser, pkg.name)
    }
    if (req.user) { // user logged in
      if (
        req.user.email !== pledge.user.email ||
        (accessTokenUser && req.user.email !== accessTokenUser.email)
      ) {
        logger.error('req.user.email and pledge.user.email dont match, signout first.', { req: req._log(), args })
        throw new Error(t('api/unexpected'))
      }
      user = req.user

      // load possible exising PF alias, only exists if the user is logged in,
      // otherwise he can't have an alias already
      const paymentSource = await transaction.public.paymentSources.findFirst({
        userId: user.id,
        method: 'POSTFINANCECARD'
      }, {orderBy: ['createdAt desc']})

      if (paymentSource) { pfAliasId = paymentSource.pspId }
    } else {
      if (accessTokenUser) {
        if (pledge.user.email !== accessTokenUser.email) {
          await transaction.transactionRollback()
          return { // user must logout before he can submitPledge
            emailVerify: true
          }
        }
        user = accessTokenUser
      } else {
        user = await transaction.public.users.findOne({email: pledge.user.email}) // try to load existing user by email
        if (user && !!(await transaction.public.pledges.findFirst({userId: user.id}))) { // user has pledges
          await transaction.transactionRollback()
          return { // user must login before he can submitPledge
            emailVerify: true
          }
        } else if (!user) { // create user
          user = await transaction.public.users.insertAndGet({
            email: pledge.user.email,
            firstName: pledge.user.firstName,
            lastName: pledge.user.lastName,
            birthday: pledge.user.birthday,
            phoneNumber: pledge.user.phoneNumber
          }, {skipUndefined: true})
        }
      }
    }
    // update user details
    if (user.firstName !== pledge.user.firstName ||
      user.lastName !== pledge.user.lastName ||
      user.birthday !== pledge.user.birthday ||
      user.phoneNumber !== pledge.user.phoneNumber) {
      user = await transaction.public.users.updateAndGetOne({id: user.id}, {
        firstName: pledge.user.firstName,
        lastName: pledge.user.lastName,
        birthday: pledge.user.birthday,
        phoneNumber: pledge.user.phoneNumber
      })
    }

    // consents
    await ensureAllRequiredConsents({
      userId: user.id,
      consents,
      pgdb: transaction
    })
    await saveConsents({
      userId: user.id,
      consents,
      req,
      pgdb: transaction
    })

    // if we didn't load a alias, generate one
    if (!pfAliasId) {
      pfAliasId = uuid()
    }

    // MONTHLY_ABO can only be bought if user has no active membership
    // and if user did not buy a MONTHLY already (then he has to reactivateMembership)
    const userHasActiveMembership = await transaction.public.memberships.findFirst({
      userId: user.id,
      active: true
    })
    const userHasMonthlyMembership = await transaction.queryOneField(`
      SELECT COUNT(*)
      FROM memberships m
      JOIN "membershipTypes" mt
        ON m."membershipTypeId" = mt.id
      WHERE
        m."userId" = :userId AND
        mt.name = :membershipTypeName
    `, {
      userId: user.id,
      membershipTypeName: 'MONTHLY_ABO'
    })
    if (userHasActiveMembership || userHasMonthlyMembership) {
      const pledgeOptionsTree = await getPledgeOptionsTree(pledge.options, transaction)
      for (let plo of pledgeOptionsTree) {
        if (
          plo.packageOption.reward &&
          plo.packageOption.reward.membershipType &&
          plo.packageOption.reward.membershipType.name === 'MONTHLY_ABO'
        ) {
          if (userHasActiveMembership) {
            throw new Error(t('api/membership/monthly/hasActive'))
          } else if (userHasMonthlyMembership) {
            throw new Error(t('api/membership/monthly/reactivate'))
          }
        }
      }
    }

    // insert pledge
    let newPledge = {
      userId: user.id,
      packageId,
      total: pledge.total,
      donation: donation,
      reason: pledge.reason,
      status: 'DRAFT'
    }
    newPledge = await transaction.public.pledges.insertAndGet(newPledge)

    // insert pledgeOptions
    const newPledgeOptions = await Promise.all(pledge.options.map((plo) => {
      plo.pledgeId = newPledge.id
      const pko = packageOptions.find((pko) => pko.id === plo.templateId)
      plo.vat = pko.vat
      plo.customization = {
        membershipId: plo.membershipId,
        autoPay: plo.autoPay
      }
      delete plo.membershipId
      delete plo.autoPay
      return transaction.public.pledgeOptions.insertAndGet(plo)
    }))
    newPledge.packageOptions = newPledgeOptions

    // commit transaction
    await transaction.transactionCommit()

    // generate PF SHA
    const pfSHA = postfinanceSHA({
      orderId: newPledge.id,
      amount: newPledge.total,
      alias: pfAliasId,
      userId: user.id
    })

    return {
      pledgeId: newPledge.id,
      userId: user.id,
      pfSHA,
      pfAliasId
    }
  } catch (e) {
    await transaction.transactionRollback()
    logger.info('transaction rollback', { req: req._log(), args, error: e })
    throw e
  }
}
