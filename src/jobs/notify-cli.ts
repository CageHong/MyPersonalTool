import { runNotifyTick } from './notify'

function formatLocalTimestamp(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`
}

async function main() {
  const now = new Date()
  const report = await runNotifyTick({ now })
  const timestamp = formatLocalTimestamp(now)

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
