import { TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox'
import { ErrorCodes } from '@busway-kg/contracts'
import { logSafeException } from '../lib/safe-diagnostics.js'

/** Error with an explicit HTTP status and stable code. The message must be safe to show. */
export class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
  }
}

const STATUS_CODES = {
  400: [ErrorCodes.BAD_REQUEST, 'Bad request'],
  401: [ErrorCodes.UNAUTHENTICATED, 'Authentication required'],
  403: [ErrorCodes.FORBIDDEN, 'Forbidden'],
  404: [ErrorCodes.NOT_FOUND, 'Not found'],
  413: [ErrorCodes.PAYLOAD_TOO_LARGE, 'Payload too large'],
  415: [ErrorCodes.UNSUPPORTED_MEDIA_TYPE, 'Unsupported media type'],
  429: [ErrorCodes.RATE_LIMITED, 'Too many requests'],
  503: [ErrorCodes.SERVICE_UNAVAILABLE, 'Service unavailable'],
}

function body(code, message, requestId, details) {
  const error = { code, message, requestId }
  if (details) error.details = details
  return { error }
}

/**
 * Request validation uses TypeBox/JSON Schema. Schemas with
 * additionalProperties:false reject unexpected fields (D-104); fields are never silently stripped.
 */
export function registerErrorHandling(app) {
  app.setValidatorCompiler(TypeBoxValidatorCompiler)

  app.setNotFoundHandler((request, reply) => {
    const [code, message] = STATUS_CODES[404]
    reply.code(404).send(body(code, message, request.id))
  })

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      // Only paths and validator messages are returned, never submitted values.
      const details = error.validation.map((item) => ({
        path: String(item.instancePath ?? ''),
        message: String(item.message ?? 'invalid'),
      }))
      return reply
        .code(400)
        .send(body(ErrorCodes.VALIDATION_ERROR, 'Request validation failed', request.id, details))
    }

    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(body(error.code, error.message, request.id))
    }

    const status = Number(error.statusCode)
    if (status >= 400 && status < 500) {
      const [code, message] = STATUS_CODES[status] ?? STATUS_CODES[400]
      return reply.code(status).send(body(code, message, request.id))
    }

    logSafeException(request.log, error, 'unhandled_error')
    return reply
      .code(500)
      .send(body(ErrorCodes.INTERNAL_ERROR, 'Internal server error', request.id))
  })
}
