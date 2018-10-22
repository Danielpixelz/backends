const { Roles } = require('@orbiting/backend-modules-auth')
const { findBySlug } = require('../../../lib/Voting')

module.exports = async (_, { slug }, { pgdb, user: me }) => {
  Roles.ensureUserIsInRoles(me, ['admin', 'supporter', 'associate'])

  return findBySlug(slug, pgdb)
}