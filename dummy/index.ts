import type { DummyPublisher } from './DummyPublisher.js'
import { generateMemberPool } from './memberPool.js'
import { RestDummyPublisher } from './RestDummyPublisher.js'

const REST_URL = process.env.REST_URL ?? 'http://localhost:3001'
const MEMBER_COUNT = Number(process.env.MEMBER_COUNT ?? 30)
const MIN_JOIN_MS = Number(process.env.MIN_JOIN_MS ?? 50)
const MAX_JOIN_MS = Number(process.env.MAX_JOIN_MS ?? 300)
const MIN_VOTE_MS = Number(process.env.MIN_VOTE_MS ?? 1200)
const MAX_VOTE_MS = Number(process.env.MAX_VOTE_MS ?? 4500)
const VERBOSE = process.env.VERBOSE === 'true'
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS ?? 30000)

async function waitForRestServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`)
      if (res.ok) return
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`rest-server not ready after ${timeoutMs}ms (${url}/health)`)
}

async function main(): Promise<void> {
  console.log(`[dummy] waiting for rest-server at ${REST_URL}…`)
  await waitForRestServer(REST_URL, READY_TIMEOUT_MS)
  console.log(
    `[dummy] ready. members=${MEMBER_COUNT} join=${MIN_JOIN_MS}–${MAX_JOIN_MS}ms vote=${MIN_VOTE_MS}–${MAX_VOTE_MS}ms`,
  )

  const publisher: DummyPublisher = new RestDummyPublisher({
    restUrl: REST_URL,
    members: generateMemberPool(MEMBER_COUNT),
    minJoinMs: MIN_JOIN_MS,
    maxJoinMs: MAX_JOIN_MS,
    minVoteMs: MIN_VOTE_MS,
    maxVoteMs: MAX_VOTE_MS,
    verbose: VERBOSE,
  })

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[dummy] received ${signal}, stopping`)
    await publisher.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await publisher.start()
}

main().catch((e) => {
  console.error('[dummy] fatal', e)
  process.exit(1)
})
