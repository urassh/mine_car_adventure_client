import type { DummyMember } from './DummyPublisher.js'

const AVATARS = ['🐶', '🐱', '🐰', '🐼', '🦊', '🐯', '🐸', '🐵', '🦁', '🐻']

export function generateMemberPool(n: number): readonly DummyMember[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `bot-${i}`,
    name: `bot-${String(i).padStart(3, '0')}`,
    avatar: AVATARS[i % AVATARS.length],
  }))
}
