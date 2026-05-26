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

// crypto.randomUUID は secure context (HTTPS / localhost) でのみ利用可。
// S3 web hosting は HTTP なので fallback が必要。
function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function loadMember(): Member {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try { return JSON.parse(raw) as Member } catch { /* fall through */ }
  }
  const m: Member = {
    id: uuid(),
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

// ---- 傾き投票 ----
// gamma = 端末の左右傾き (portrait で右に傾けると正)。閾値を超えた瞬間に投票し、
// 一度中央 (TILT_RESET 以下) に戻るまで連続投票はロックする (= チャタリング防止)。
type TiltState = 'off' | 'requesting' | 'on' | 'denied' | 'unsupported'
const TILT_THRESHOLD = 20
const TILT_RESET = 10
const TILT_VISIBLE_RANGE = 45 // ゲージ表示の左右レンジ (度)

let tiltState: TiltState = 'off'
let tiltArmed = true

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
  const tiltLabel = (() => {
    switch (tiltState) {
      case 'on': return '傾きモード ON (タップで OFF)'
      case 'requesting': return '許可リクエスト中…'
      case 'denied': return '傾きモード OFF (許可が必要)'
      case 'unsupported': return '傾きモード 非対応'
      case 'off': default: return '傾きモード OFF (タップで ON)'
    }
  })()

  const showGauge = tiltState === 'on' || tiltState === 'requesting'

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
      <div class="tilt-section">
        <button class="tilt-toggle ${tiltState === 'on' ? 'active' : ''}" data-action="tilt" ${tiltState === 'unsupported' ? 'disabled' : ''}>
          ${tiltLabel}
        </button>
        ${showGauge ? `
          <div class="tilt-gauge" aria-hidden="true">
            <div class="tilt-zone zone-left"></div>
            <div class="tilt-zone zone-right"></div>
            <div class="tilt-tick tick-left"></div>
            <div class="tilt-tick tick-center"></div>
            <div class="tilt-tick tick-right"></div>
            <div class="tilt-indicator" id="tilt-indicator"></div>
          </div>
        ` : ''}
      </div>
      <div class="toast" id="toast"></div>
    </div>
  `

  for (const btn of app.querySelectorAll<HTMLButtonElement>('.vote-btn')) {
    btn.addEventListener('click', () => void vote(btn.dataset.side as VoteSide))
  }

  app.querySelector<HTMLButtonElement>('[data-action="leave"]')!.addEventListener('click', () => {
    disableTilt()
    screen = 'join'
    lastVote = null
    joinError = null
    render()
  })

  const tiltBtn = app.querySelector<HTMLButtonElement>('[data-action="tilt"]')
  if (tiltBtn) {
    tiltBtn.addEventListener('click', () => {
      if (tiltState === 'on') disableTilt()
      else void enableTilt()
    })
  }
}

async function enableTilt(): Promise<void> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    tiltState = 'unsupported'
    render()
    return
  }

  // iOS 13+ は requestPermission をユーザジェスチャ内で呼ぶ必要がある。
  // Android Chrome 等には存在しないので、その場合は分岐スキップ。
  type WithPermission = { requestPermission?: () => Promise<'granted' | 'denied'> }
  const ctor = DeviceOrientationEvent as unknown as WithPermission
  if (typeof ctor.requestPermission === 'function') {
    tiltState = 'requesting'
    render()
    try {
      const result = await ctor.requestPermission()
      if (result !== 'granted') {
        tiltState = 'denied'
        render()
        return
      }
    } catch {
      tiltState = 'denied'
      render()
      return
    }
  }

  window.addEventListener('deviceorientation', onTilt)
  tiltArmed = true
  tiltState = 'on'
  render()
}

function disableTilt(): void {
  if (typeof window !== 'undefined') {
    window.removeEventListener('deviceorientation', onTilt)
  }
  if (tiltState === 'on' || tiltState === 'requesting') {
    tiltState = 'off'
  }
}

function onTilt(e: DeviceOrientationEvent): void {
  if (screen !== 'vote') return
  const gamma = e.gamma
  if (gamma === null) return

  updateTiltGauge(gamma)

  if (tiltArmed) {
    if (gamma > TILT_THRESHOLD) {
      tiltArmed = false
      void vote('right')
    } else if (gamma < -TILT_THRESHOLD) {
      tiltArmed = false
      void vote('left')
    }
  } else if (Math.abs(gamma) < TILT_RESET) {
    tiltArmed = true
  }
}

// gauge は高頻度 (~60Hz) に更新されるので render() を回さず DOM を直接書き換える。
function updateTiltGauge(gamma: number): void {
  const indicator = document.getElementById('tilt-indicator')
  if (!indicator) return
  const clamped = Math.max(-TILT_VISIBLE_RANGE, Math.min(TILT_VISIBLE_RANGE, gamma))
  const pct = 50 + (clamped / TILT_VISIBLE_RANGE) * 50
  indicator.style.left = `${pct}%`
  indicator.classList.toggle('over-threshold', Math.abs(gamma) >= TILT_THRESHOLD)
  indicator.classList.toggle('locked', !tiltArmed)
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
