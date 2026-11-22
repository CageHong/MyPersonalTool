import {
  createReminder,
  listReminders,
  type ReminderInput,
  type ReminderOwner,
} from '@/modules/tasks/server/reminders'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'

const OWNER_KEYS = ['taskId', 'ruleId', 'habitId'] as const

function parseQueryOwner(url: string): ReminderOwner | Response {
  const { searchParams } = new URL(url)
  const present = OWNER_KEYS.flatMap((key) => {
    const raw = searchParams.get(key)
    return raw !== null ? [{ key, raw }] : []
  })

  if (present.length !== 1) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Exactly one of taskId, ruleId, or habitId is required', {
      owner: present.length === 0 ? 'required' : 'invalid_value',
    })
  }

  const [{ key, raw }] = present
  if (!/^\d+$/.test(raw)) {
    return errorResponse(400, 'VALIDATION_FAILED', `Invalid ${key}`, { [key]: 'invalid' })
  }

  const id = Number(raw)
  if (key === 'taskId') return { taskId: id }
  if (key === 'ruleId') return { ruleId: id }
  return { habitId: id }
}

function parseBodyOwner(body: Record<string, unknown>): { owner: ReminderOwner; input: ReminderInput } | Response {
  const present = OWNER_KEYS.filter((key) => body[key] !== undefined)
  if (present.length !== 1) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Exactly one of taskId, ruleId, or habitId is required', {
      owner: present.length === 0 ? 'required' : 'invalid_value',
    })
  }

  const [key] = present
  const raw = body[key]
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    return errorResponse(400, 'VALIDATION_FAILED', `Invalid ${key}`, { [key]: 'invalid' })
  }

  const rest = { ...body }
  delete rest[key]
  const owner: ReminderOwner =
    key === 'taskId' ? { taskId: raw } : key === 'ruleId' ? { ruleId: raw } : { habitId: raw }
  return { owner, input: rest as ReminderInput }
}

export async function GET(request: Request): Promise<Response> {
  const owner = parseQueryOwner(request.url)
  if (owner instanceof Response) {
    return owner
  }

  try {
    return Response.json(listReminders(owner))
  } catch (error) {
    return handleError('[GET /api/tasks/reminders]', error, 'Reminder owner not found')
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  const parsed = parseBodyOwner(body)
  if (parsed instanceof Response) {
    return parsed
  }

  try {
    return Response.json(createReminder(parsed.owner, parsed.input, new Date()), { status: 201 })
  } catch (error) {
    return handleError('[POST /api/tasks/reminders]', error, 'Reminder owner not found')
  }
}
