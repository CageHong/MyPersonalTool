import { ValidationErrorBase } from '../errors'

export class NotifyConfigError extends ValidationErrorBase {
  constructor(message: string, fields: Record<string, string> = {}) {
    super(message, fields)
    this.name = 'NotifyConfigError'
  }
}

export class NotifyDeliveryError extends Error {
  readonly channel: string
  readonly status?: number

  constructor(channel: string, message: string, status?: number) {
    super(message)
    this.name = 'NotifyDeliveryError'
    this.channel = channel
    this.status = status
  }
}
