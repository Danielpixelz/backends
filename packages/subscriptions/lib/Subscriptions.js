const { transformUser } = require('@orbiting/backend-modules-auth')
const { getObjectByIdAndType } = require('./genericObject')
const Promise = require('bluebird')

const objectTypes = ({
  User: 'objectUserId',
  Document: 'objectDocumentId',
  Discussion: 'objectDiscussionId'
})

const buildObjectFindProps = ({ id, type }, t) => {
  const objectColumn = objectTypes[type]
  if (!objectColumn) {
    throw new Error(t('api/unexpected'))
  }
  return {
    objectType: type,
    [objectColumn]: id
  }
}

const upsertSubscription = async (args, context) => {
  const { pgdb, loaders, t } = context
  const { userId, objectId, type, filters } = args

  if (type === 'User' && userId === objectId) {
    throw new Error(t('api/subscriptions/notYourself'))
  }

  const object = await getObjectByIdAndType(
    { id: objectId, type },
    context
  )
  if (!object) {
    throw new Error(t('api/subscription/object/404', { id: objectId }))
  }

  const findProps = {
    userId,
    ...buildObjectFindProps({
      id: object.objectId || objectId, // normalized id by getObjectByIdAndType
      type
    }, t)
  }
  const updateProps = {
    active: true,
    filters: filters && filters.length ? filters : null
  }

  const transaction = await pgdb.transactionBegin()

  let subscription
  try {
    const existingSubscription = await transaction.public.subscriptions.findOne(findProps)

    if (existingSubscription) {
      subscription = await transaction.public.subscriptions.updateAndGetOne(
        { id: existingSubscription.id },
        {
          ...updateProps,
          updatedAt: new Date()
        }
      )
    } else {
      subscription = await transaction.public.subscriptions.insertAndGet({
        ...findProps,
        ...updateProps
      })
    }

    await transaction.transactionCommit()
  } catch (e) {
    await transaction.transactionRollback()
    console.error('rollback!', e)
    throw new Error(t('api/unexpected'))
  }

  await Promise.all([
    loaders.Subscription.byId.clear(subscription.id),
    loaders.Subscription.byUserId.clear(subscription.userId)
  ])

  return subscription
}

const unsubscribe = async (id, context) => {
  const { pgdb, loaders, t } = context

  const subscription = await pgdb.public.subscriptions.updateAndGetOne(
    { id },
    { active: false }
  )
  if (!subscription) {
    throw new Error(t('api/subscriptions/404'))
  }
  await Promise.all([
    loaders.Subscription.byId.clear(subscription.id),
    loaders.Subscription.byUserId.clear(subscription.userId)
  ])
  return subscription
}

const getObject = async (subscription, context) => {
  const { objectType: type } = subscription
  return getObjectByIdAndType(
    {
      id: subscription[objectTypes[type]],
      type: subscription.objectType
    },
    context
  )
}

const getSubject = (subscription, context) => {
  const { loaders } = context
  return loaders.User.byId.load(subscription.userId)
}

const getActiveSubscriptionsForUser = (
  userId,
  { loaders }
) => {
  return loaders.Subscription.byUserId.load(userId)
    .then(subs => subs.filter(sub => sub.active))
}

const getActiveSubscriptionsForUserAndObject = (
  userId,
  {
    type,
    id
  },
  context
) => {
  const { user: me, pgdb, t } = context
  if (!id) {
    throw new Error(t('api/unexpected'))
  }
  const findProps = {
    active: true,
    ...buildObjectFindProps({
      id,
      type
    }, t)
  }
  if (userId && userId === me.id) {
    return getActiveSubscriptionsForUser(userId, context)
      .then(subs => subs
        .filter(sub => Object.keys(findProps).every(
          key => findProps[key] === sub[key]
        ))
      )
  }
  return pgdb.public.subscriptions.find({
    ...userId ? { userId } : {},
    ...findProps
  })
}

const getActiveSubscriptionsForUserAndObjects = (
  userId,
  {
    type,
    ids,
    filter
  },
  context
) => {
  const { pgdb, t } = context
  const objectColumn = objectTypes[type]
  if (
    !objectColumn
  ) {
    throw new Error(t('api/unexpected'))
  }

  if (!ids || !ids.length) {
    return []
  }

  if (ids.length === 1) {
    return getActiveSubscriptionsForUserAndObject(
      userId,
      {
        type,
        id: ids[0]
      },
      context
    )
  }

  return pgdb.query(`
    SELECT
      s.*
    FROM
      subscriptions s
    WHERE
      ${userId ? 's."userId" = :userId AND' : ''}
      s."objectType" = :type AND
      ARRAY[s."${objectColumn}"] && :objectIds AND
      ${filter ? '(s.filters IS NULL OR s.filters ? :filter) AND' : ''}
      s."active" = true
  `, {
    ...userId ? { userId } : {},
    type,
    objectIds: ids,
    filter
  })
}

const getActiveSubscribersForObject = (
  {
    type,
    id,
    filter
  },
  { pgdb, t }
) => {
  const objectColumn = objectTypes[type]
  if (!objectColumn) {
    throw new Error(t('api/unexpected'))
  }

  return pgdb.query(`
    SELECT
      u.*
    FROM
      subscriptions s
    JOIN
      users u
      ON s."userId" = u.id
    WHERE
      s."active" = true AND
      s."objectType" = :type AND
      s."${objectColumn}" = :objectId
      ${filter ? 'AND (s.filters IS NULL OR s.filters ? :filter)' : ''}
  `, {
    type,
    objectId: id,
    filter
  })
    .then(users => users.map(transformUser))
}

module.exports = {
  upsertSubscription,
  unsubscribe,
  getObject,
  getSubject,

  getActiveSubscriptionsForUser,
  getActiveSubscriptionsForUserAndObject,
  getActiveSubscriptionsForUserAndObjects,

  getActiveSubscribersForObject
}
