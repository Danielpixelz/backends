const debug = require('debug')('base:lib:redis')
const redis = require('redis')
const bluebird = require('bluebird')

bluebird.promisifyAll(redis.RedisClient.prototype)
bluebird.promisifyAll(redis.Multi.prototype)

const connect = () => {
  const url = process.env.REDIS_URL

  debug('connecting client', { url })
  const client = redis.createClient(url)

  client.__defaultExpireSeconds = 3 * 7 * 24 * 60 * 60 // 3 weeks
  client.__shortExpireSeconds = 3 * 24 * 60 * 60 // 3 days

  return client
}

const disconnect = client =>
  client.quit()

const deleteKeys = async (prefix, redis) => {
  const keys = await redis.keysAsync(`${prefix}*`)
  console.log(`Redis delete num keys: ${keys.length}`)
  if (keys.length > 0) {
    if (keys.length < 500) {
      return redis.delAsync(...keys)
    } else {
      return bluebird.map(
        keys,
        (key) => redis.delAsync(key),
        { concurrency: 100 }
      )
    }
  }
}

module.exports = {
  connect,
  disconnect,
  deleteKeys
}
