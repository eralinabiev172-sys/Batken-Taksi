import Type from 'typebox'

/**
 * Public identifiers are opaque (D-107): "<prefix>_<22 base64url chars>".
 * They are not internal UUIDs and never replace RBAC or ownership checks.
 */
export const PUBLIC_ID_PATTERN = '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'

export const PublicIdSchema = Type.String({ pattern: PUBLIC_ID_PATTERN })

export const HealthResponseSchema = Type.Object(
  { status: Type.Literal('ok') },
  { additionalProperties: false },
)

export const ReadyResponseSchema = Type.Object(
  { status: Type.Literal('ok'), database: Type.Literal('up') },
  { additionalProperties: false },
)
