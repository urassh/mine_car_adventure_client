import type {
  DummyMember,
  DummyPublisher,
  VoteSide,
} from './DummyPublisher.js'

export interface RestDummyPublisherOptions {
  readonly restUrl: string
  readonly members: readonly DummyMember[]
  readonly minJoinMs: number
  readonly maxJoinMs: number
  readonly minVoteMs: number
  readonly maxVoteMs: number
  readonly verbose?: boolean
}

interface Counters {
  joinOk: number
  joinFail: number
  voteOk: number
  voteFail: number
}

export class RestDummyPublisher implements DummyPublisher {
  private readonly opts: RestDummyPublisherOptions
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private started = false
  private readonly counters: Counters = { joinOk: 0, joinFail: 0, voteOk: 0, voteFail: 0 }
  private statsTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: RestDummyPublisherOptions) {
    this.opts = opts
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    let elapsed = 0
    for (const member of this.opts.members) {
      elapsed += this.rand(this.opts.minJoinMs, this.opts.maxJoinMs)
      const t = setTimeout(() => {
        this.timers.delete(t)
        void this.join(member)
        this.scheduleVote(member)
      }, elapsed)
      this.timers.add(t)
    }

    this.statsTimer = setInterval(() => this.logStats(), 5000)
  }

  async stop(): Promise<void> {
    this.started = false
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    this.logStats()
  }

  private async join(member: DummyMember): Promise<void> {
    try {
      const res = await fetch(`${this.opts.restUrl}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(member),
      })
      if (res.ok) {
        this.counters.joinOk++
        if (this.opts.verbose) console.log(`[dummy] join ${member.name} → ${res.status}`)
      } else {
        this.counters.joinFail++
        console.warn(`[dummy] join ${member.name} → ${res.status}`)
      }
    } catch (e) {
      this.counters.joinFail++
      console.error(`[dummy] join error ${member.name}`, e)
    }
  }

  private scheduleVote(member: DummyMember): void {
    if (!this.started) return
    const delay = this.rand(this.opts.minVoteMs, this.opts.maxVoteMs)
    const t = setTimeout(async () => {
      this.timers.delete(t)
      const side: VoteSide = Math.random() < 0.5 ? 'left' : 'right'
      try {
        const res = await fetch(`${this.opts.restUrl}/vote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ member, side }),
        })
        if (res.ok) {
          this.counters.voteOk++
          if (this.opts.verbose) console.log(`[dummy] vote ${member.name} ${side} → ${res.status}`)
        } else {
          this.counters.voteFail++
          console.warn(`[dummy] vote ${member.name} ${side} → ${res.status}`)
        }
      } catch (e) {
        this.counters.voteFail++
        console.error(`[dummy] vote error ${member.name}`, e)
      }
      this.scheduleVote(member)
    }, delay)
    this.timers.add(t)
  }

  private logStats(): void {
    const c = this.counters
    console.log(
      `[dummy] stats join=${c.joinOk}/${c.joinOk + c.joinFail} vote=${c.voteOk}/${c.voteOk + c.voteFail}`,
    )
  }

  private rand(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }
}
