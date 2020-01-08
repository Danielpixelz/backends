
const util = require('util')

const DEV = process.env.NODE_ENV && process.env.NODE_ENV !== 'production'

const logProcessMemoryUsage = () => {
  const processMemoryUsage = process.memoryUsage()
  const data = {}

  Object.keys(processMemoryUsage).forEach(key => {
    data[key] = Math.round(processMemoryUsage[key] / 1024 / 1024)
  })

  const message = {
    message: 'Memory Usage Report',
    level: 'notice',
    instance: this.instance,
    ...data
  }

  if (DEV) {
    console.log(util.inspect(message, null, { depth: null }))
  } else {
    console.log(JSON.stringify(message))
  }
}

module.exports = {
  run: ({ instance = 1, intervalSecs = 60 } = {}) => {
    this.instance = instance
    this.timer = setInterval(
      logProcessMemoryUsage,
      1000 * intervalSecs
    ).unref()

    logProcessMemoryUsage()

    return {
      close: () => {
        clearInterval(this.timer)
      }
    }
  }
}
