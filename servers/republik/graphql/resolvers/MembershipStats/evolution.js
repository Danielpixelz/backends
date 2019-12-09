const moment = require('moment')
const debug = require('debug')('republik:resolvers:MembershipStats:overview')
// const crypto = require('crypto')

const { resolveCacheFirst } = require('@orbiting/backend-modules-utils')

const query = `
WITH "minMaxDates" AS (
  SELECT m.id, m.active, m.renew, m."autoPay", mt.name "membershipTypeName", MIN(mp."beginDate") "minBeginDate", MAX(mp."endDate") "maxEndDate"
  FROM "memberships" m
  JOIN "membershipPeriods" mp ON mp."membershipId" = m.id
  JOIN "membershipTypes" mt ON mt.id = m."membershipTypeId"
  WHERE m."userId" != 'f0512927-7e03-4ecc-b14f-601386a2a249' -- Jefferson
  GROUP BY m.id, mt.id
), "membershipDonation" AS (
  WITH "pledgeMembership" AS (
    SELECT p."createdAt", p.donation, COALESCE(pom.id, pm.id) "membershipId"
    FROM "pledges" p
    JOIN "pledgeOptions" po ON po."pledgeId" = p.id AND po.amount > 0
    LEFT JOIN "memberships" pom ON pom.id = po."membershipId" AND pom."userId" = p."userId"
    LEFT JOIN "memberships" pm ON pm."pledgeId" = p.id AND pm."userId" = p."userId"
    WHERE p.donation > 0
      AND (pom.id IS NOT NULL OR pm.id IS NOT NULL)
      AND p.status != 'DRAFT'
  )
  
  SELECT pm.donation, pm."membershipId"
  FROM (
    SELECT "membershipId", MAX("createdAt") AS "createdAt"
    FROM "pledgeMembership"
    GROUP BY "membershipId"
  ) AS lpm
  JOIN "pledgeMembership" pm
    ON pm."membershipId" = lpm."membershipId"
    AND pm."createdAt" = lpm."createdAt"
  GROUP BY pm."membershipId", pm.donation
), range AS (
  SELECT
    unit::timestamp with time zone "first",
    (unit + '1 month'::interval - '1 second'::interval)::timestamp with time zone "last"

  FROM generate_series(
    :min::timestamp,
    :max::timestamp,
    '1 month'
  ) unit
)

SELECT
  to_char("first", 'YYYY-MM') "key",

  COUNT(*) FILTER (
    WHERE "maxEndDate" >= "first"
    AND "minBeginDate" < "first"
  ) "activeBeginningOfMonth",

  COUNT(*) FILTER (
    WHERE "minBeginDate" >= "first"
    AND "minBeginDate" <= "last"
  ) "gaining",

  COUNT(*) FILTER (
    WHERE "minBeginDate" >= "first"
    AND "minBeginDate" <= "last"
    AND "membershipDonation"."membershipId" IS NOT NULL
  ) "gainingWithDonation",
  
  COUNT(*) FILTER (
    WHERE "minBeginDate" >= "first"
    AND "minBeginDate" <= "last"
    AND "membershipDonation"."membershipId" IS NULL
  ) "gainingWithoutDonation",

  COUNT(*) FILTER (
    WHERE "maxEndDate" >= "first"
    AND "maxEndDate" <= "last"
    
  ) "ending",

  COUNT(*) FILTER (
    WHERE "maxEndDate" >= "first"
    AND "maxEndDate" <= "last"
    AND (
      active = TRUE
      AND renew = TRUE
    )
  ) "prolongable",

  COUNT(*) FILTER (
    WHERE "maxEndDate" >= "first"
    AND "maxEndDate" <= "last"
    AND renew = TRUE
    AND active = FALSE
  ) "expired",
  
  COUNT(*) FILTER (
    WHERE "maxEndDate" >= "first"
    AND "maxEndDate" <= "last"
    AND renew = FALSE
  ) "cancelled",

  COUNT(*) FILTER (
    WHERE "maxEndDate" >= "last"
    AND "minBeginDate" < "last"
  ) "activeEndOfMonth",
  
  COUNT(*) FILTER (
    WHERE "maxEndDate" >= "last"
    AND "minBeginDate" < "last"
    AND "membershipDonation"."membershipId" IS NOT NULL
  ) "activeEndOfMonthWithDonation",
  
  COUNT(*) FILTER (
    WHERE "maxEndDate" >= "last"
    AND "minBeginDate" < "last"
    AND "membershipDonation"."membershipId" IS NULL
  ) "activeEndOfMonthWithoutDonation",
  
  COUNT(*) FILTER (
    WHERE "maxEndDate" >= :min::timestamp
    AND "maxEndDate" <= "last"
    AND (
      active = TRUE
      AND renew = TRUE
    )
  ) "pending",
  
  COUNT(*) FILTER (
    WHERE "maxEndDate" >= :min::timestamp
    AND "maxEndDate" <= "last"
    AND (
      active = TRUE
      AND renew = TRUE
    )
    AND "membershipTypeName" IN ('MONTHLY_ABO')
  ) "pendingSubscriptionsOnly"

FROM range, "minMaxDates"

LEFT JOIN "membershipDonation"
  ON "membershipDonation"."membershipId" = "minMaxDates".id

GROUP BY 1
ORDER BY 1
`

const getBuckets = (min, max, pgdb) => async () => {
  debug(
    'query for: %o',
    { min: min.toISOString(), max: max.toISOString() }
  )

  const result = await pgdb.query(query, { min, max })

  debug('query result: %o', result)

  return { buckets: result, updatedAt: new Date() }
}

module.exports = async (_, args, context) => {
  const { pgdb } = context
  const { cacheOnly = true } = args

  const min = moment(args.min)
  const max = moment(args.max)

  /* const fingerprint = crypto
    .createHash('md5')
    .update(JSON.stringify({ args, query }))
    .digest('hex') */

  return resolveCacheFirst(
    getBuckets(min, max, pgdb),
    {
      key: 'membership-stats:overview',
      cacheOnly
    },
    context
  )
}
