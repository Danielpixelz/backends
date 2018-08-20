const debug =
  require('debug')('access:lib:constraints:recipientInNoSlot')

const isGrantable = async (args, context) => {
  const { email, grantee, campaign } = args
  const { pgdb } = context

  const usedSlots = await pgdb.query(`
    SELECT "accessGrants".id

    FROM "accessGrants"

    WHERE
      "accessGrants"."accessCampaignId" = '${campaign.id}'
      AND "accessGrants"."granteeUserId" = '${grantee.id}'
      AND "accessGrants"."email" = '${email}'
      AND "accessGrants"."endAt" >= NOW()
      AND "accessGrants"."revokedAt" IS NULL
  `)

  debug({
    grantee: grantee.id,
    email,
    usedSlots
  })

  return usedSlots.length === 0
}

const getMeta = () => ({
  visible: true,
  grantable: null, // unkown if it is grantable
  payload: {}
})

module.exports = {
  isGrantable,
  getMeta
}
