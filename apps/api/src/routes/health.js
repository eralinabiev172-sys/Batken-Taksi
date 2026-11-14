import {
  ErrorCodes,
  ErrorResponseSchema,
  HealthResponseSchema,
  ReadyResponseSchema,
} from '@busway-kg/contracts'
import { HttpError } from '../plugins/errors.js'
import { logSafeException } from '../lib/safe-diagnostics.js'

/** Internal liveness/readiness probes. They expose no configuration or version data. */
export default async function healthRoutes(app) {
  app.get('/health', { schema: { response: { 200: HealthResponseSchema } } }, async () => ({
    status: 'ok',
  }))

  app.get(
    '/health/ready',
    { schema: { response: { 200: ReadyResponseSchema, 503: ErrorResponseSchema } } },
    async (request) => {
      try {
        await app.db.query('select 1')
      } catch (error) {
        logSafeException(request.log, error, 'database_unavailable')
        throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, 'Database unavailable')
      }
      return { status: 'ok', database: 'up' }
    },
  )
}
