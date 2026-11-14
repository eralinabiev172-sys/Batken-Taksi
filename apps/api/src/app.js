import Fastify from 'fastify'
import { registerDb, createPool } from './plugins/db.js'
import { registerAuth } from './plugins/auth.js'
import { registerCsrf } from './plugins/csrf.js'
import { registerErrorHandling } from './plugins/errors.js'
import { createSafeLogger } from './plugins/logging.js'
import { createServerLogContext, trustedLogFields } from './lib/log-context.js'
import { registerSecurityHeaders } from './plugins/security-headers.js'
import healthRoutes from './routes/health.js'
import authRoutes from './routes/auth.js'

/**
 * Builds the Fastify application without starting to listen.
 * @param {{
 *   config: { logLevel: string, databaseUrl: string, dbPoolMax: number },
 *   pool?: import('pg').Pool,
 *   loggerStream?: import('node:stream').Writable,
 * }} options
 */
export async function buildApp({ config, pool, loggerStream }) {
  const requestContexts = new WeakMap()
  const app = Fastify({
    loggerInstance: createSafeLogger(config, loggerStream),
    bodyLimit: 64 * 1024,
    // Clients cannot choose their own request ids.
    requestIdHeader: false,
    genReqId: (rawRequest) => {
      const context = createServerLogContext()
      requestContexts.set(rawRequest, context)
      return trustedLogFields(context).request_id
    },
    childLoggerFactory: (logger, _bindings, _options, rawRequest) => logger.child(requestContexts.get(rawRequest)),
    trustProxy: false,
  })

  registerErrorHandling(app)
  await registerSecurityHeaders(app)
  registerDb(app, pool ?? createPool(config), { owned: !pool })
  registerAuth(app)
  registerCsrf(app)
  await app.register(healthRoutes)
  await app.register(authRoutes, { prefix: '/api/v1' })

  return app
}
