const hashSessionId = require('../../lib/hashSessionId')

module.exports = {
  async id (session, args) {
    // email should be salty enough for a salt 🤡🤡
    return hashSessionId(session.sid, session.sess.email)
  },
  ipAddress (session, args) {
    return session.sess.ip
  },
  userAgent (session, args) {
    return session.sess.ua
  },
  email (session, args) {
    return session.sess.email
  },
  country (session, args) {
    const { geo = {} } = session.sess
    return geo.country
  },
  city (session, args) {
    const { geo = {} } = session.sess
    return geo.city
  },
  expiresAt (session, args) {
    return session.expire
  },
  cookie (session, args) {
    return JSON.stringify(session.sess.cookie)
  }
}
