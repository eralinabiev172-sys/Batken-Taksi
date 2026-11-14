import helmet from '@fastify/helmet'

/** Baseline security headers for a JSON API; nothing here is meant to be rendered by a browser. */
export async function registerSecurityHeaders(app) {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })
}
