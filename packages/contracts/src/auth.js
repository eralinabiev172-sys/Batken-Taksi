import Type from 'typebox'

export const LoginRequestSchema = Type.Object(
  { email: Type.String({ minLength: 1 }), password: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
)

export const UserSchema = Type.Object(
  { id: Type.String(), email: Type.String(), roles: Type.Array(Type.String()) },
  { additionalProperties: false },
)

export const LoginResponseSchema = Type.Object(
  { user: UserSchema },
  { additionalProperties: false },
)

export const MeResponseSchema = Type.Object(
  { user: Type.Object({ id: Type.String(), email: Type.String(), status: Type.String() }, { additionalProperties: false }), roles: Type.Array(Type.String()), permissions: Type.Array(Type.String()) },
  { additionalProperties: false },
)