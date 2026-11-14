import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Load the repository-level .env (never committed) without overriding real environment variables.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)
