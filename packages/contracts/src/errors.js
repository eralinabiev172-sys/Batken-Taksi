import Type from 'typebox'

/** Stable machine-readable error codes (API.md: error format). */
export const ErrorCodes = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
})

export const ErrorDetailSchema = Type.Object(
  { path: Type.String(), message: Type.String() },
  { additionalProperties: false },
)

/** { error: { code, message, details?, requestId } } */
export const ErrorResponseSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
        details: Type.Optional(Type.Array(ErrorDetailSchema)),
        requestId: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
