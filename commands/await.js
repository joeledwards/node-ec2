module.exports = {
  command: 'await <state> <instance-id>',
  desc: 'await a state for an EC2 instance',
  builder,
  handler
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
}

async function handler (options) {
  const {
    instanceId,
    state
  } = options

  const c = require('@buzuli/color')
  const aws = require('aws-sdk')
  const { stopwatch } = require('durations')

  const watch = stopwatch().start()
  const ec2 = new aws.EC2()

  const stateColor = state => {
    switch (state) {
      case 'running': return c.green(state)
      case 'stopped': return c.yellow(state)
      case 'terminated': return c.red(state)
      default: return c.grey(state)
    }
  }

  async function instanceState () {
    return new Promise ((resolve, reject) => {
      const ec2Options = {
        InstanceIds: [instanceId]
      }

      ec2.waitFor(awaitStates[state], ec2Options, (error, data) => {
        error ? reject(error) : resolve(data)
      })
    })
  }

  try {
    await instanceState()
    console.info(`Instance ${c.yellow(instanceId)} is ${stateColor(state)} (${watch})`)
  } catch (error) {
    console.error(`Error awaiting state ${stateColor(state)} for EC2 instance ${c.yellow(instanceId)} (${watch})`)
    process.exit(1)
  }
}
