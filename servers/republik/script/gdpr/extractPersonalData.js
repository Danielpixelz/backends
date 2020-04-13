/**
 * This script deletes emails from mailchimp not present in the
 * local DB, or not having consented to PRIVACY
 *
 * Usage:
 * node script/deleteMailchimp.js
 */
require('@orbiting/backend-modules-env').config()

const path = require('path')
const fs = require('fs')
const yargs = require('yargs')
const _ = require('lodash')
const Promise = require('bluebird')

const { csvFormat } = require('d3-dsv')

const PgDb = require('@orbiting/backend-modules-base/lib/PgDb')
// const MailchimpInterface = require('@orbiting/backend-modules-mail/MailchimpInterface')

// const mailchimp = MailchimpInterface({ logger: console })

const argv = yargs
  .option('userId', {
    alias: ['user', 'u'],
    require: true
  })
  .option('destination', {
    alias: ['dest', 'd'],
    require: true,
    coerce: input => path.resolve(input)
  })

  .argv

const readableRows = row => {
  Object.keys(row).forEach(key => {
    if (Array.isArray(row[key]) || typeof row[key] === 'object') {
      row[key] = JSON.stringify(row[key])
    }
  })

  return row
}

const save = async (destination, name, _rows = []) => {
  console.log(path.resolve(destination, `${name}.csv`))

  const rows = _.cloneDeep(_rows)
  fs.writeFileSync(
    path.resolve(destination, `${name}.csv`),
    csvFormat(rows.map(readableRows))
  )
}

PgDb.connect().then(async pgdb => {
  const { userId, destination } = argv

  if (!await fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true })
  }

  /**
   * user
   */
  const user = await pgdb.public.users.findOne(
    { id: userId, deletedAt: null }
  )

  if (!user) {
    throw new Error('User not found.')
  }

  await save(destination, 'user', [user])

  /**
   * accessGrants
   */
  const accessGrants = await pgdb.public.accessGrants.find({
    or: [
      { recipientUserId: user.id },
      { granterUserId: user.id },
      { email: user.email }
    ]
  })

  if (accessGrants.length > 0) {
    const accessCampaigns = await pgdb.public.accessCampaigns
      .find({ id: accessGrants.map(({ accessCampaignId }) => accessCampaignId) })

    await save(
      destination,
      'accessGrants',
      accessGrants.map(grant => {
        const campaign = accessCampaigns.find(campaign => campaign.id === grant.accessCampaignId)

        const { granterUserId, recipientUserId, email } = grant

        return {
          ...grant,
          recipientUserId: recipientUserId === user.id ? user.id : 'anon.',
          granterUserId: granterUserId === user.id ? user.id : 'anon.',
          email: email && granterUserId === user.id ? email : (email && 'anon.'),
          accessCampaign_title: campaign.title
        }
      })
    )

    /**
     * accessEvents
     */
    const accessEvents = await pgdb.public.accessEvents
      .find({ accessGrantId: accessGrants.map(({ id }) => id) })

    await save(destination, 'accessEvents', accessEvents)
  }

  /**
   * addresses
   */
  const addresses = await pgdb.public.addresses.find({ id: user.addressId })
  await save(destination, 'addresses', addresses)

  /**
   * answers
   */
  const answers = await pgdb.public.answers.find({ userId: user.id })

  if (answers.length > 0) {
    const questionnaires = await pgdb.public.questionnaires
      .find({ id: answers.map(({ questionnaireId }) => questionnaireId) })

    const questions = await pgdb.public.questions
      .find({ id: answers.map(({ questionId }) => questionId) })

    await save(
      destination,
      'answers',
      answers.map(answer => {
        const questionnaire = questionnaires.find(questionnaire => questionnaire.id === answer.questionnaireId)
        const question = questions.find(question => question.id === answer.questionId)

        return {
          ...answer,
          questionnaire_slug: questionnaire.slug,
          question_text: question.text
        }
      })
    )
  }

  /**
   * ballots
   */
  const ballots = await pgdb.public.ballots.find({ userId: user.id })

  if (ballots.length > 0) {
    const votings = await pgdb.public.votings
      .find({ id: ballots.map(({ votingId }) => votingId) })

    const votingOptions = await pgdb.public.votingOptions
      .find({ id: ballots.map(({ votingOptionId }) => votingOptionId) })

    await save(
      destination,
      'ballots',
      ballots.map(ballot => {
        const voting = votings.find(voting => voting.id === ballot.votingId)
        const votingOption = votingOptions.find(votingOption => votingOption.id === ballot.votingOptionId)

        return {
          ...ballot,
          voting_name: voting.name,
          voting_slug: voting.slug,
          votingOption_name: votingOption.text,
          votingOption_label: votingOption.label
        }
      })
    )
  }

  /**
   * cards
   */
  const cards = await pgdb.public.cards.find({ userId: user.id })

  if (cards.length > 0) {
    const cardGroups = await pgdb.public.cardGroups
      .find({ id: cards.map(({ cardGroupId }) => cardGroupId) })

    const comments = await pgdb.public.comments
      .find({ id: cards.map(({ commentId }) => commentId) })

    await save(
      destination,
      'cards',
      cards.map(card => {
        const cardGroup = cardGroups.find(cardGroup => cardGroup.id === card.cardGroupId)
        const comment = comments.find(comment => comment.id === card.commentId)

        return {
          ...card,
          cardGroup_name: cardGroup.name,
          cardGroup_slug: cardGroup.slug,
          comment_content: comment.content
        }
      })
    )
  }

  /**
   * collectionDocumentItems
   */
  const collectionDocumentItems = await pgdb.public.collectionDocumentItems.find({ userId: user.id })

  if (collectionDocumentItems.length > 0) {
    const collections = await pgdb.public.collections
      .find({ id: collectionDocumentItems.map(({ collectionId }) => collectionId) })

    await save(
      destination,
      'collectionDocumentItems',
      collectionDocumentItems.map(collectionDocumentItem => {
        const collection = collections.find(collection => collection.id === collectionDocumentItem.collectionId)

        return {
          ...collectionDocumentItem,
          collection_name: collection.name
        }
      })
    )
  }

  /**
   * collectionMediaItems
   */
  const collectionMediaItems = await pgdb.public.collectionMediaItems.find({ userId: user.id })

  if (collectionMediaItems.length > 0) {
    const collections = await pgdb.public.collections
      .find({ id: collectionMediaItems.map(({ collectionId }) => collectionId) })

    await save(
      destination,
      'collectionMediaItems',
      collectionMediaItems.map(collectionMediaItem => {
        const collection = collections.find(collection => collection.id === collectionMediaItem.collectionId)

        return {
          ...collectionMediaItem,
          collection_name: collection.name
        }
      })
    )
  }

  /**
   * comments
   */
  const { userComments = [], votedComments = [] } = await Promise.props({
    userComments: pgdb.public.comments.find({ userId: user.id }),
    votedComments: pgdb.query(`
      SELECT c.*
      FROM comments c, jsonb_to_recordset(c.votes) as v("userId" uuid, "vote" int)
      WHERE v."userId" = :userId
    `, {
      userId: user.id
    })
  })

  const comments = _.unionBy(userComments.concat(votedComments), 'id')

  if (comments.length > 0) {
    const discussions = await pgdb.public.discussions
      .find({ id: comments.map(({ discussionId }) => discussionId) })
    const discussionPreferences = await pgdb.public.discussionPreferences
      .find({ discussionId: discussions.map(({ id }) => id) })
    const credentials = await pgdb.public.credentials
      .find({ id: discussionPreferences.map(({ credentialId }) => credentialId) })

    await save(
      destination,
      'comments',
      comments.map(comment => {
        const discussion = discussions.find(discussion => discussion.id === comment.discussionId)
        const discussionPreference = discussionPreferences.find(discussionPreference => discussionPreference.discussionId === discussion.id && discussionPreference.userId === user.id)
        const credential = discussionPreference && credentials.find(credential => credential.id === discussionPreference.credentialId)

        return {
          ...comment,
          userId: comment.userId === user.id ? user.id : 'anon.',
          content:
            (comment.userId === user.id || (comment.published && !comment.adminUnpublished))
              ? comment.content
              : 'anon.',
          votes: comment.votes.filter(({ userId }) => userId === user.id),
          discussion_title: discussion.title,
          discussion_path: discussion.path,
          discussionPreference_anonymous: discussionPreference && discussionPreference.anonymous,
          discussionPreference_notificationOption: discussionPreference && discussionPreference.notificationOption,
          credential_description: credential && credential.description
        }
      })
    )
  }

  /**
   * consents
   */
  const consents = await pgdb.public.consents.find({ userId: user.id })
  await save(destination, 'consents', consents)

  /**
   * credentials
   */
  const credentials = await pgdb.public.credentials.find({ userId: user.id })
  await save(destination, 'credentials', credentials)

  /**
   * devices
   */
  const devices = await pgdb.public.devices.find({ userId: user.id })
  await save(
    destination,
    'devices',
    devices.map(device => {
      return {
        ...device,
        token: 'anon.'
      }
    })
  )

  /**
   * electionBallots
   */
  const electionBallots = await pgdb.public.electionBallots.find({ userId: user.id })

  if (electionBallots.length > 0) {
    const elections = await pgdb.public.elections
      .find({ id: electionBallots.map(({ electionId }) => electionId) })

    const electionCandidacies = await pgdb.public.electionCandidacies
      .find({ id: electionBallots.map(({ candidacyId }) => candidacyId) })

    if (electionCandidacies.length > 0) {
      const candidacyUsers = await pgdb.public.users
        .find({ id: electionCandidacies.map(({ userId }) => userId) })

      const candidacyComments = await pgdb.public.comments
        .find({ id: electionCandidacies.map(({ commentId }) => commentId) })

      electionCandidacies.forEach((cancidacy, index) => {
        electionCandidacies[index]._user = candidacyUsers.find(candidacyUser => candidacyUser.id === cancidacy.userId)
        electionCandidacies[index]._comment = candidacyComments.find(candidacyComment => candidacyComment.id === cancidacy.commentId)
      })
    }

    await save(
      destination,
      'electionBallots',
      electionBallots.map(electionBallot => {
        const election = elections.find(election => election.id === electionBallot.electionId)
        const electionCandidacy = electionCandidacies.find(electionCandidacy => electionCandidacy.id === electionBallot.candidacyId)

        return {
          ...electionBallot,
          election_description: election.description,
          election_slug: election.slug,
          electionCandidacy_user_name:
            electionCandidacy && [electionCandidacy._user.firstName, electionCandidacy._user.lastName]
              .filter(Boolean)
              .join(' '),
          electionCandidacy_comment_content: electionCandidacy && electionCandidacy._comment.content,
          electionCandidacy_recommendation: electionCandidacy && electionCandidacy.recommendation
        }
      })
    )
  }

  /**
   * eventLog
   */
  const eventLog = await pgdb.query(`
    SELECT
      e.*
    FROM
      "eventLog" e
    WHERE
      e."newData" #>> '{sess,email}' = :email OR
      e."oldData" #>> '{sess,email}' = :email OR
      e."newData" #>> '{sess,passport,user}' = :userId OR
      e."oldData" #>> '{sess,passport,user}' = :userId OR
      e."userId" = :userId
  `, {
    email: user.email,
    userId: user.id
  })
  await save(destination, 'eventLog', eventLog.map(record => {
    return {
      ...record,
      oldData: record.oldData && {
        ...record.oldData,
        sid: 'anon.'
      },
      newData: record.newData && {
        ...record.newData,
        sid: 'anon.'
      }
    }
  }))

  /**
   * mailLog
   */
  const mailLog = await pgdb.public.mailLog.find({
    or: [
      { userId: user.id },
      { email: user.email }
    ]
  })

  await save(destination, 'mailLog', mailLog.map(row => {
    return {
      ...row,
      info: undefined
    }
  }))

  /**
   * membershipPeriods, membershipCancellations, chargeAttempts
   */

  const memberships = await pgdb.public.memberships.find({ userId: user.id })

  if (memberships.length > 0) {
    const membershipPeriods = await pgdb.public.membershipPeriods
      .find({ membershipId: memberships.map(({ id }) => id) })

    const membershipTypes = await pgdb.public.membershipTypes
      .find({ id: memberships.map(({ membershipTypeId }) => membershipTypeId) })

    await save(
      destination,
      'membershipPeriods',
      membershipPeriods.map(membershipPeriod => {
        const membership = memberships.find(membership => membership.id === membershipPeriod.membershipId)
        const membershipType = membershipTypes.find(membershipType => membershipType.id === membership.membershipTypeId)

        const membershipFlat = {}
        Object.keys(membership).forEach(key => { membershipFlat[`membership_${key}`] = membership[key] })

        return {
          ...membershipPeriod,
          ...membershipFlat,
          membership_subscriptionId: !!membership.subscriptionId,
          membership_membershipType_name: membershipType.name
        }
      })
    )

    const membershipCancellations = await pgdb.public.membershipCancellations
      .find({ membershipId: memberships.map(({ id }) => id) })

    await save(destination, 'membershipCancellations', membershipCancellations)

    const chargeAttempts = await pgdb.public.chargeAttempts
      .find({ membershipId: memberships.map(({ id }) => id) })

    await save(destination, 'chargeAttempts', chargeAttempts)
  }

  /**
   * pledges
   */

  const pledges = await pgdb.public.pledges.find({ userId: user.id })

  if (pledges.length > 0) {
    const packages = await pgdb.public.packages
      .find({ id: pledges.map(({ packageId }) => packageId) })

    await save(destination, 'pledges', pledges.map(pledge => {
      const package_ = packages.find(package_ => package_.id === pledge.packageId)

      return {
        ...pledge,
        package_name: package_.name
      }
    }))

    const pledgeOptions = await pgdb.public.pledgeOptions
      .find({ pledgeId: pledges.map(({ id }) => id) })

    const packageOptions = await pgdb.public.packageOptions
      .find({ id: pledgeOptions.map(({ templateId }) => templateId) })

    const membershipRewards = await pgdb.public.membershipTypes
      .find({ rewardId: packageOptions.map(({ rewardId }) => rewardId) })

    const goodieRewards = await pgdb.public.goodies
      .find({ rewardId: packageOptions.map(({ rewardId }) => rewardId) })

    await save(destination, 'pledgeOptions', pledgeOptions.map(pledgeOption => {
      const packageOption = packageOptions.find(packageOption => packageOption.id === pledgeOption.templateId)
      const membershipReward = membershipRewards.find(reward => reward.rewardId === packageOption.rewardId)
      const goodieReward = goodieRewards.find(reward => reward.rewardId === packageOption.rewardId)

      return {
        ...pledgeOption,
        reward_membershipType_name: membershipReward && membershipReward.name,
        reward_goodie_name: goodieReward && goodieReward.name
      }
    }))
  }

  /**
   * payments
   */

  const pledgePayments = await pgdb.public.pledgePayments.find({ pledgeId: pledges.map(({ id }) => id) })
  const payments = await pgdb.public.payments.find({ id: pledgePayments.map(({ paymentId }) => paymentId) })

  await save(destination, 'payments', payments.map(payment => {
    const pledgePayment = pledgePayments.find(pledgePayment => pledgePayment.paymentId === payment.id)

    return {
      ...payment,
      pledge_id: pledgePayment.pledgeId
    }
  }))

  /**
   * previews
   */

  const previewRequests = await pgdb.public.previewRequests.find({ userId: user.id })

  if (previewRequests.length > 0) {
    await save(destination, 'previewRequests', previewRequests)

    const previewEvents = await pgdb.public.previewEvents
      .find({ previewRequestId: previewRequests.map(({ id }) => id) })

    await save(destination, 'previewEvents', previewEvents)
  }

  /**
   * tokens
   */

  const tokens = await pgdb.public.tokens.find({ email: user.email })
  await save(destination, 'tokens', tokens)

  /**
   * sessions
   */

  const sessions = await pgdb.query(`
    SELECT
      s.*
    FROM
      "sessions" s
    WHERE
      sess->>'email' = :email OR
      sess->'passport'->>'user' = :userId
  `, {
    email: user.email,
    userId: user.id
  })
  await save(destination, 'sessions', sessions.map(session => {
    return {
      ...session,
      sid: 'anon.'
    }
  }))

  /**
   * subscriptions
   */

  const subscriptions = await pgdb.public.subscriptions.find({ userId: user.id })
  await save(destination, 'subscriptions', subscriptions)

  /**
   * notifications
   */

  const notifications = await pgdb.public.notifications.find({ userId: user.id })
  await save(destination, 'notifications', notifications)

  /**
   * MailChimp
   */

  /* `const keys = Object.keys(process.env).filter(key => key.match(/^MAILCHIMP_INTEREST_/))
  const interests = keys.map(key => ({ id: process.env[key], label: key }))

  const mailchimpMember = await mailchimp.getMember(user.email)

  await save(destination, 'mailchimpMember', [mailchimpMember].map(mailchimpMember => {
    return {
      ...mailchimpMember,
      interests: Object.keys(mailchimpMember.interests).map(id => {
        const interest = interests.find(interest => interest.id === id)

        return {
          id,
          ...interest && interest,
          status: mailchimpMember.interests[id]
        }
      }),
      unique_email_id: 'anon.',
      web_id: 'anon.',
      tags: mailchimpMember.tags.map(tag => ({ name: tag.name })),
      list_id: 'anon.',
      _links: 'anon.'
    }
  })) */

  // MailChimp?
  // Stripe?

  await pgdb.close()
})
  .then(() => {
    process.exit()
  }).catch(e => {
    console.log(e)
    process.exit(1)
  })
