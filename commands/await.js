const handler = require('../lib/handler')

module.exports = {
  command: 'await <state> <instance-id>',
  desc: 'await a state for an EC2 instance',
  builder,
  handler: handler(awaitState)
}

const awaitStates = {
  running: 'instanceRunning',
  stopped: 'instanceStopped',
  terminated: 'instanceTerminated'
}

function builder (yargs) {
  yargs
    .positional('instance-id', {
      type: 'string',
      desc: 'The ID of the instance to await'
    })
    .positional('state', {
      type: 'string',
      desc: 'prefix of the keys to list',
      choices: Object.keys(awaitStates)
    })
    .option('timeout', {
      type: 'number',
      desc: 'max time (in seconds) to await state transition',
      default: 300,
      alias: 't'
    })
}

async function awaitState ({
  aws,
  options: {
    instanceId,
    state,
    timeout
  }
}) {
  const c = require('@buzuli/color')
  const promised = require('@buzuli/promised')
  const scheduler = require('@buzuli/scheduler')()
  const { stopwatch } = require('durations')

  const stateColor = state => {
    switch (state) {
      case 'running': return c.green(state)
      case 'stopped': return c.yellow(state)
      case 'terminated': return c.red(state)
      default: return c.grey(state)
    }
  }

  const watch = stopwatch().start()
  const ec2 = aws.ec2()

  async function instanceState () {
    const ec2Options = {
      InstanceIds: [instanceId]
    }

    promised(h => ec2.sdk.waitFor(awaitStates[state], ec2Options, h))
  }

  scheduler.after(timeout * 1000, () => {
    console.error(`Timeout awaiting state ${stateColor(state)} for EC2 instance ${c.yellow(instanceId)} (${watch})`)
    process.exit(1)
  })

  let done = false

  while (!done && watch.duration().seconds() < timeout) {
    try {
      await instanceState()
      console.info(`Instance ${c.yellow(instanceId)} is ${stateColor(state)} (${watch})`)
      done = true
    } catch (error) {
      if (error.code !== 'ResourceNotReady') {
        console.error(`Error awaiting state ${stateColor(state)} for EC2 instance ${c.yellow(instanceId)} (${watch}) : ${error}`)
        done = true
      }
    }
  }

  scheduler.pause()
}
