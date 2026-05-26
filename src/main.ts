import './style.css'

type VoteSide = 'left' | 'right'
type Screen = 'join' | 'vote'

interface Member {
  id: string
  name: string
  avatar: string
}

const REST_URL = (import.meta.env.VITE_REST_URL as string | undefined) ?? 'http://localhost:3001'
const AVATARS = ['🐶', '🐱', '🐰', '🐼', '🦊', '🐯', '🐸', '🐵', '🦁', '🐻']
const STORAGE_KEY = 'tcu_client_member'

function loadMember(): Member {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try { return JSON.parse(raw) as Member } catch { /* fall through */ }
  }
  const m: Member = {
    id: crypto.randomUUID(),
    name: '',
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
  return m
}

function saveMember(m: Member): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${REST_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as T
}

let member = loadMember()
let screen: Screen = 'join'
let joining = false
let joinError: string | null = null
let lastVote: VoteSide | null = null

const app = document.querySelector<HTMLDivElement>('#app')!

function render(): void {
  if (screen === 'join') renderJoin()
  else renderVote()
}

function renderJoin(): void {
  const nameTrimmed = member.name.trim()
  const canJoin = nameTrimmed.length > 0 && !joining
  app.innerHTML = `
    <div class="container join-container">
      <h1 class="title">トロッコ探検隊</h1>
      <p class="subtitle">参加するには名前を入れてね</p>
      <button class="avatar avatar-large" data-action="reroll" title="アバター変更">${member.avatar}</button>
      <input
        class="name-input"
        id="name-input"
        value="${escapeHtml(member.name)}"
        maxlength="10"
        placeholder="なまえ"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
      />
      <button class="join-btn" id="join-btn" ${canJoin ? '' : 'disabled'}>
        ${joining ? '参加中…' : '参加する'}
      </button>
      ${joinError ? `<div class="error">${escapeHtml(joinError)}</div>` : ''}
    </div>
  `

  const nameEl = app.querySelector<HTMLInputElement>('#name-input')!
  nameEl.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    const next = [...target.value].slice(0, 10).join('')
    if (next !== target.value) target.value = next
    member = { ...member, name: next }
    saveMember(member)
    const btn = app.querySelector<HTMLButtonElement>('#join-btn')!
    btn.disabled = member.name.trim().length === 0 || joining
  })
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void onJoinClick()
  })

  app.querySelector<HTMLButtonElement>('[data-action="reroll"]')!.addEventListener('click', () => {
    member = { ...member, avatar: pickDifferentAvatar(member.avatar) }
    saveMember(member)
    render()
  })

  app.querySelector<HTMLButtonElement>('#join-btn')!.addEventListener('click', () => void onJoinClick())
}

function renderVote(): void {
  app.innerHTML = `
    <div class="container">
      <header class="header">
        <div class="avatar avatar-display">${member.avatar}</div>
        <div class="name-display">${escapeHtml(member.name)}</div>
        <button class="leave-btn" data-action="leave" title="退出">退出</button>
      </header>
      <div class="status">✓ 参加中</div>
      <div class="vote-buttons">
        <button class="vote-btn left ${lastVote === 'left' ? 'voted' : ''}" data-side="left">← LEFT</button>
        <button class="vote-btn right ${lastVote === 'right' ? 'voted' : ''}" data-side="right">RIGHT →</button>
      </div>
      <div class="toast" id="toast"></div>
    </div>
  `

  for (const btn of app.querySelectorAll<HTMLButtonElement>('.vote-btn')) {
    btn.addEventListener('click', () => void vote(btn.dataset.side as VoteSide))
  }

  app.querySelector<HTMLButtonElement>('[data-action="leave"]')!.addEventListener('click', () => {
    screen = 'join'
    lastVote = null
    joinError = null
    render()
  })
}

async function onJoinClick(): Promise<void> {
  if (member.name.trim().length === 0 || joining) return
  member = { ...member, name: member.name.trim() }
  saveMember(member)
  joining = true
  joinError = null
  render()
  try {
    const res = await postJSON<{ accepted: boolean; reason?: string }>('/join', member)
    if (res.accepted) {
      screen = 'vote'
      lastVote = null
    } else {
      joinError = `参加できませんでした: ${res.reason ?? 'unknown'}`
    }
  } catch (e) {
    joinError = 'サーバに繋がりません'
    console.error(e)
  } finally {
    joining = false
    render()
  }
}

async function vote(side: VoteSide): Promise<void> {
  try {
    const res = await postJSON<{ accepted: boolean; reason?: string }>('/vote', { member, side })
    if (res.accepted) {
      lastVote = side
      toast(side === 'left' ? '← 左に投票' : '右に投票 →')
    } else {
      toast(`投票拒否: ${res.reason ?? 'unknown'}`)
    }
  } catch (e) {
    toast('投票エラー')
    console.error(e)
  }
  render()
}

function pickDifferentAvatar(current: string): string {
  if (AVATARS.length <= 1) return current
  let next = current
  while (next === current) next = AVATARS[Math.floor(Math.random() * AVATARS.length)]
  return next
}

function toast(msg: string): void {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.classList.add('visible')
  window.clearTimeout((toast as unknown as { t?: number }).t)
  ;(toast as unknown as { t?: number }).t = window.setTimeout(() => el.classList.remove('visible'), 1800)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

render()
