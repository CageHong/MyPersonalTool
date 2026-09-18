export class ValidationError extends Error {
  readonly fields: Record<string, string>

  constructor(fields: Record<string, string>) {
    super('Validation failed')
    this.name = 'ValidationError'
    this.fields = fields
  }
}

export class NotFoundError extends Error {
  readonly id: number

  constructor(id: number) {
    super(`Task ${id} not found`)
    this.name = 'NotFoundError'
    this.id = id
  }
}
