import { buildApp } from './app.js'
import { ConfigError, loadConfig } from './config/env.js'
import { createSafeLogger } from './plugins/logging.js'
import { DriverEnvironmentError } from './plugins/db.js'
import { logSafeException } from './lib/safe-diagnostics.js'

const bootstrapLogger = createSafeLogger({ logLevel: 'info' })
let app

// Last-resort handlers must not let Node print a raw exception/stack to stderr.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.once(event, (error) => {
    logSafeException(app?.log ?? bootstrapLogger, error, 'process_failure')
    process.exit(1)
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    try {
      app?.log.info({ signal }, 'shutting down')
      await app?.close()
      process.exit(0)
    } catch (error) {
      logSafeException(app?.log ?? bootstrapLogger, error, 'shutdown_failed')
      process.exit(1)
    }
  })
}

try {
  const config = loadConfig()
  app = await buildApp({ config })
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  logSafeException(app?.log ?? bootstrapLogger, error,
    error instanceof ConfigError || error instanceof DriverEnvironmentError ? 'configuration_invalid' : 'startup_failed')
  process.exit(1)
}
