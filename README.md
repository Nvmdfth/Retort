# Retort 🎭

A modern, real-time, mobile-first party game web app built with Next.js App Router, Tailwind CSS, Framer Motion, Zustand, and Socket.io. Spiritual successor to Quiplash, fixed for modern group play by eliminating TV dependency.

---

## Key Features

- **No Split-Brain TV Dependency**: The complete game board, countdown timer, prompt cards, and thumb-zone duel voting UI live directly on each player's mobile phone.
- **Optional `/host` Route**: Ultra-widescreen TV/projector view (`/room/[code]/host`) for casting to a living room TV or projector with live room code and side-by-side presentation.
- **Circular Prompt Ring Topology**: Mathematical ring pairing where each player receives two secret prompts paired with neighboring players around a virtual circle.
- **Cheating Prevention & Scrubbed Projections**: The server authoritatively scrubs author identities and secret prompt assignments until the dramatic duel reveal phase.
- **Tactile Mobile Interactions**: Framer Motion spring physics, haptic feedback triggers, character counters, and live checkmark checklists during writing.
- **Quiplash Scoring Mechanics**: 1,000 base points distributed proportionally by vote percentage, plus a +250 point Clean Sweep bonus for unanimous duels.

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) 1.1+ (or Node.js 20+)

### Running Locally

```bash
# Install dependencies
bun install

# Start integrated server (Next.js App Router + Socket.io on port 3000)
bun dev
```

Visit:
- Mobile Player Client: `http://localhost:3000`
- Optional Host/Projector Dashboard: `http://localhost:3000/room/[CODE]/host`

### Testing & Verification

```bash
# Run unit and state-machine tests
bun test

# Type check
bun x tsc --noEmit

# Production build
bun run build
```
