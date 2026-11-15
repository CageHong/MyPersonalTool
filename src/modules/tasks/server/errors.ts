import { NotFoundErrorBase, ValidationErrorBase } from '../../../platform/errors'

// 繼承平台的基底:route handler 只認基底(src/app/api/_lib/http.ts)
export class ValidationError extends ValidationErrorBase {
  constructor(fields: Record<string, string>) {
    super('Validation failed', fields)
  }
}

export class NotFoundError extends NotFoundErrorBase {
  constructor(id: number) {
    super(`Task ${id} not found`, id)
  }
}
