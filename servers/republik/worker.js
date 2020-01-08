require('@orbiting/backend-modules-env').config()

const { NotifyListener: SearchNotifyListener } = require('@orbiting/backend-modules-search')
const { t } = require('@orbiting/backend-modules-translate')
const SlackGreeter = require('@orbiting/backend-modules-slack/lib/SlackGreeter')

const { AccessScheduler } = require('@orbiting/backend-modules-access')
const { PreviewScheduler } = require('@orbiting/backend-modules-preview')
const { memoryUsage } = require('@orbiting/backend-modules-utils')

const MembershipScheduler = require('./modules/crowdfundings/lib/scheduler')
const mail = require('./modules/crowdfundings/lib/Mail')

const {
  SEARCH_PG_LISTENER,
  NODE_ENV,
  ACCESS_SCHEDULER,
  PREVIEW_SCHEDULER,
  MEMBERSHIP_SCHEDULER
} = process.env

const DEV = NODE_ENV && NODE_ENV !== 'production'

const run = async () => {
  const memoryUsageLogger = memoryUsage.run()

  const slackGreeter = await SlackGreeter.start()

  let searchNotifyListener
  if (SEARCH_PG_LISTENER && SEARCH_PG_LISTENER !== 'false') {
    searchNotifyListener = await SearchNotifyListener.start()
  }

  let accessScheduler
  if (ACCESS_SCHEDULER === 'false' || (DEV && ACCESS_SCHEDULER !== 'true')) {
    console.log('ACCESS_SCHEDULER prevented scheduler from begin started',
      { ACCESS_SCHEDULER, DEV }
    )
  } else {
    accessScheduler = await AccessScheduler.init({ t, mail })
  }

  let previewScheduler
  if (PREVIEW_SCHEDULER === 'false' || (DEV && PREVIEW_SCHEDULER !== 'true')) {
    console.log('PREVIEW_SCHEDULER prevented scheduler from begin started',
      { PREVIEW_SCHEDULER, DEV }
    )
  } else {
    previewScheduler = await PreviewScheduler.init({ t, mail })
  }

  let membershipScheduler
  if (MEMBERSHIP_SCHEDULER === 'false' || (DEV && MEMBERSHIP_SCHEDULER !== 'true')) {
    console.log('MEMBERSHIP_SCHEDULER prevented scheduler from begin started',
      { MEMBERSHIP_SCHEDULER, DEV }
    )
  } else {
    membershipScheduler = await MembershipScheduler.init({ t, mail })
  }

  const close = async () => {
    memoryUsageLogger.close()
    slackGreeter && await slackGreeter.close()
    searchNotifyListener && await searchNotifyListener.close()
    accessScheduler && await accessScheduler.close()
    previewScheduler && await previewScheduler.close()
    membershipScheduler && await membershipScheduler.close()
  }

  process.on('SIGINT', close)
  process.on('SIGTERM', close)

  return {
    close
  }
}

run()
