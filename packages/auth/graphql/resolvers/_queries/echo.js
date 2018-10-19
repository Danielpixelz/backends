const geoForIP = require('../../../lib/geoForIP')
const useragent = require('../../../lib/useragent')
const { flag, code } = require('country-emoji')

module.exports = async (_, args, { req }) => {
  const ip = req._ip()
  const { country, countryEN, city } = geoForIP(ip)
  const countryCode = countryEN ? code(countryEN) : null
  const ua = req.headers['user-agent']

  return {
    ipAddress: ip,
    userAgent: useragent.detect(ua),
    country,
    countryFlag: countryCode ? flag(countryCode) : '🏴',
    city
  }
}
