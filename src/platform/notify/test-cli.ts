import { sendNotification } from './index'

async function main() {
  const message = process.argv.slice(2).join(' ').trim()
  if (!message) {
    console.error('Usage: npm run notify:test -- "<message>"')
    process.exitCode = 1
    return
  }

  try {
    await sendNotification(message)
    console.log('Notification sent.')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(detail)
    process.exitCode = 1
  }
}

void main()
