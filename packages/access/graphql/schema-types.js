module.exports = `

extend type User {
  """
  List of memberships a User was granted
  """
  accessGrants: [AccessGrant]!

  """
  List of granted memberships by User
  """
  accessCampaigns: [AccessCampaign]!
}

"""
Entity describing ability and terms of granting a membership
"""
type AccessCampaign {
  id: ID!
  title: String!,
  description: String,
  grants: [AccessGrant]!
  slots: AccessCampaignSlots
}

"""
Entity representing a future, current or passed granted membership
"""
type AccessGrant {
  id: ID!
  "Campaign this membership grant belongs to"
  campaign: AccessCampaign!
  "Entity who granted membership"
  grantee: AccessGrantGrantee!
  """
  Original recipient email address of grant.
  Is eventually matched to a User (see recipient).
  """
  email: String!
  "Entity who received granted membership"
  recipient: AccessGrantRecipient
  "Beginning of sharing period"
  beginAt: DateTime!
  "Ending of sharing period"
  endAt: DateTime!
  """
  Date when grant was revoked.
  Set if grant was revoked prematurly.
  """
  revokedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}

type AccessCampaignSlots {
  total: Int!
  free: Int!
  used: Int!
}

# Subject to change
# Potential leak of sensitive information
type AccessGrantGrantee {
  name: String!
  email: String!
}

# Subject to change
# Potential leak of sensitive information
type AccessGrantRecipient {
  name: String!
  email: String!
}

`
