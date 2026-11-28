import { emptyTrash, listTrash } from '@/modules/tasks/server/trash'
import { errorResponse } from '@/app/api/_lib/http'

export async function GET(): Promise<Response> {
  try {
    return Response.json(listTrash())
  } catch (error) {
    console.error('[GET /api/tasks/trash]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}

export async function DELETE(): Promise<Response> {
  try {
    return Response.json({ deleted: emptyTrash() })
  } catch (error) {
    console.error('[DELETE /api/tasks/trash]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
