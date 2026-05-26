export type VoteSide = 'left' | 'right'

export interface DummyMember {
  readonly id: string
  readonly name: string
  readonly avatar: string
}

export interface DummyPublisher {
  start(): Promise<void>
  stop(): Promise<void>
}
