const handler = require('../lib/handler')

module.exports = {
  command: 'list',
  desc: 'list EC2 instances',
  builder,
  handler: handler(listInstances)
}

function builder (yargs) {
  yargs
    .option('quiet', {
      type: 'boolean',
      desc: 'only output server list (no progress, summary, JSON formatting)',
      alias: 'q'
    })
    .option('case-sensitive', {
      type: 'boolean',
      desc: 'make filter expressions case sensitive',
      alias: 'c'
    })
    .option('extended', {
      type: 'boolean',
      desc: 'show extended details',
      alias: 'x'
    })
    .option('instance-id', {
      type: 'string',
      desc: 'id search regex',
      alias: 'id'
    })
    .option('json', {
      type: 'boolean',
      desc: 'output JSON containing extended details about each instance',
      alias: 'j'
    })
    .option('name', {
      type: 'string',
      desc: 'name search regex (value of the Name tag)',
      alias: 'n'
    })
    .option('state', {
      type: 'string',
      desc: 'state search regex (pending | running | shutting-down | stopping | stopped | terminated)',
      alias: 's'
    })
    .option('private-ip', {
      type: 'string',
      desc: 'private IP regex',
      alias: 'i'
    })
    .option('public-ip', {
      type: 'string',
      desc: 'public IP regex',
      alias: 'I'
    })
    .option('ssh-key', {
      type: 'string',
      desc: 'ssh key search regex',
      alias: ['key', 'k']
    })
    .option('tag-key', {
      type: 'string',
      desc: 'tag key search regex',
      alias: 't'
    })
    .option('tag-value', {
      type: 'string',
      desc: 'tag value search regex',
      alias: 'T'
    })
}

async function listInstances ({
  aws,
  options: {
    id,
    caseSensitive,
    extended,
    json,
    name,
    state,
    privateIp,
    publicIp,
    sshKey,
    tagKey,
    tagValue,
    quiet
  }
}) {
  const c = require('@buzuli/color')
  const r = require('ramda')
  const moment = require('moment')
  const buzJson = require('@buzuli/json')
  const promised = require('@buzuli/promised')

  const age = require('../lib/age')
  const pad = require('../lib/pad')
  const ec2 = aws.ec2()

  const regexFlags = caseSensitive ? undefined : 'i'

  function makeRegFilter (expression) {
    const regex = expression ? new RegExp(expression, regexFlags) : undefined
    return v => regex ? (v && v.match(regex)) : true
  }

  function makeTagFilter (extractor, filter) {
    return tags => {
      if (!tags) {
        return true
      }
      if (!filter) {
        return true
      }
      return r.compose(
        r.head,
        r.map(n => true),
        r.filter(filter),
        r.filter(r.complement(r.isNil)),
        r.map(extractor)
      )(tags)
    }
  }

  const idFilter = makeRegFilter(id)
  const keyFilter = makeRegFilter(sshKey)
  const nameFilter = makeRegFilter(name)
  const stateFilter = makeRegFilter(state)
  const privateIpFilter = makeRegFilter(privateIp)
  const publicIpFilter = makeRegFilter(publicIp)
  const tagKeyFilter = makeTagFilter(t => t.Key, makeRegFilter(tagKey))
  const tagValueFilter = makeTagFilter(t => t.Value, makeRegFilter(tagValue))

  function instanceFilter (instance) {
    const {
      id,
      name,
      sshKey,
      state,
      tags,
      network: {
        privateIp,
        publicIp
      } = {}
    } = fieldExtractor(instance)

    return idFilter(id) &&
      keyFilter(sshKey) &&
      nameFilter(name) &&
      privateIpFilter(privateIp) &&
      publicIpFilter(publicIp) &&
      tagKeyFilter(tags) &&
      tagValueFilter(tags) &&
      stateFilter(state)
  }

  function fieldExtractor (instance) {
    const {
      InstanceId: id,
      ImageId: image,
      KeyName: sshKey,
      State: { Name: state },
      Placement: { AvailabilityZone: az },
      CpuOptions: {
        CoreCount: cores,
        ThreadsPerCore: threads
      },
      InstanceType: instanceType,
      LaunchTime: launchTime,
      PrivateIpAddress: privateIp,
      PublicIpAddress: publicIp,
      Tags: tags = []
    } = instance

    return {
      id,
      image,
      sshKey,
      az,
      type: instanceType,
      cpus: {
        cores,
        threads: cores * threads
      },
      launchTime: moment.utc(launchTime).toISOString(),
      state,
      name: findName(instance),
      tags,
      network: {
        privateIp, publicIp
      }
    }
  }

  function findName (instance) {
    return r.compose(
      r.head,
      r.map(r.path(['Value'])),
      r.filter(r.pathEq(['Key'], 'Name'))
    )(instance.Tags || [])
  }

  function stateColor (state) {
    const decor = text => text
    switch (state) {
      case 'pending':
        return c.blue(decor(state))
      case 'running':
        return c.green(decor(state))
      case 'shutting-down':
      case 'stopping':
        return c.yellow(decor(state))
      case 'stopped':
        return c.orange(decor(state))
      case 'terminated':
      default:
        return c.red(decor(state))
    }
  }

  function summarize (instances) {
    const now = moment.utc()

    const maxPubIpLen = r.compose(
      r.reduce(r.max, 0),
      r.map(
        ({
          network: {
            publicIp: ip = ''
          } = {}
        }) => ip.length
      )
    )(instances)

    const maxPrivIpLen = r.compose(
      r.reduce(r.max, 0),
      r.map(
        ({
          network: {
            privateIp: ip = ''
          } = {}
        }) => ip.length
      )
    )(instances)

    return r.compose(
      r.join('\n'),
      r.map(({
        id,
        image,
        name,
        az,
        sshKey,
        state,
        launchTime,
        type: instanceType,
        network: {
          privateIp,
          publicIp
        },
        cpus: {
          cores,
          threads
        }
      }) => {
        const created = moment.utc(launchTime)

        const imgStr = c.key('white')(image)
        const stateStr = stateColor(state)
        const idStr = c.yellow(id)
        const nameStr = c.blue(name || '--')
        const keyStr = c.key('white').bold(sshKey)
        const typeStr = c.yellow(instanceType)
        const ageStr = c.orange(age(created, now))
        const azStr = c.green(az)
        const pubIpStr = c.blue(pad(maxPubIpLen, publicIp || '', false))
        const privIpStr = c.purple(pad(maxPrivIpLen, privateIp || '', false))

        return quiet
          ? name
          : extended
            ? `[${stateStr}] ${pubIpStr} => ${privIpStr} => ${azStr}:${idStr}:${nameStr} (${keyStr} | ${typeStr} | ${ageStr} | ${imgStr})`
            : `[${stateStr}] ${azStr}:${idStr}:${nameStr} (${keyStr} | ${typeStr} | ${ageStr})`
      })
    )(instances || [])
  }

  try {
    const result = await promised(h => ec2.sdk.describeInstances({}, h))

    const instances = r.compose(
      r.map(fieldExtractor),
      r.filter(instanceFilter),
      r.flatten,
      r.map(r.path(['Instances']))
    )(result.Reservations)

    const count = instances.length

    if (quiet) {
      console.log(json ? JSON.stringify(instances) : summarize(instances))
    } else {
      console.log(json ? buzJson(instances) : summarize(instances))
      console.log(
        `Listed ${c.orange(count)} instances for region ${c.green(aws.sdk.config.region)}`
      )
    }
  } catch (error) {
    console.error(error)
    console.error(c.red(c.emoji.inject(
      `Error finding instances in ${c.green(aws.sdk.config.region)}: details above :point_up:`
    )))
    process.exit(1)
  }
}
