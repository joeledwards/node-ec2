module.exports = age

const moment = require('moment')
const { millis } = require('durations')

function age (start, end) {
  const then = moment.utc(start)
  const now = end ? moment.utc(end) : moment.utc()
  const age = millis(now.diff(then))

  return age
}
