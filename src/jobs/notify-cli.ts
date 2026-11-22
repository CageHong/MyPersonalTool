import { runNotifyTick } from './notify'

async function main() {
  const now = new Date()
  const report = await runNotifyTick({ now })
  const timestamp = now.toISOString()

  console.log(
    `[${timestamp}] notify tick: sent=${report.sent.length} failed=${report.failed.length}`,
  )

  for (const item of report.sent) {
    console.log(`[${timestamp}] sent tool=${item.tool} key=${item.key}`)
  }

  if (report.failed.length > 0) {
    for (const failure of report.failed) {
      const keyPart = failure.key ? ` key=${failure.key}` : ''
      console.error(
        `[${timestamp}] failed tool=${failure.tool} stage=${failure.stage}${keyPart} error=${failure.error}`,
      )
    }
    process.exitCode = 1
  }
}

void main()
