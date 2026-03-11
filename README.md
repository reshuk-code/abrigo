# Abrigo v2 — Decentralized Private Messenger

**No phone. No email. No accounts. No servers.**

Built on the [Nostr protocol](https://nostr.com) — a fully decentralized, censorship-resistant messaging standard used by millions.

---

## Architecture

| Layer | Technology | Privacy |
|---|---|---|
| Identity | secp256k1 keypair (stored in IndexedDB only) | Private key never leaves device |
| Transport | Nostr relays (WebSocket) | Open, anyone can run a relay |
| Encryption | NIP-44 (X25519 + ChaCha20-Poly1305) | Relay cannot read content |
| Storage | None — all local | No database, no cloud |
| Auth | Zero — key IS the auth | No password, no OTP |

---

## How it works

### Identity
- Your **private key (`nsec`)** is generated once and stored only in your browser's IndexedDB
- Your **public key (`npub`)** is your shareable ID — like a username
- Share your `npub` with people who want to message you
- Import your `nsec` on any device to restore full access + message history

### Messages
- Encrypted with **NIP-44** before leaving your device
- Published to connected **Nostr relays** (WebSocket servers)
- Relays see: sender pubkey, recipient pubkey, timestamp, encrypted blob — **nothing else**
- Both sender and recipient can decrypt using ECDH shared secret (X25519)

### Relays
Default relays (free, public):
- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.nostr.band`

You can add custom/self-hosted relays in Settings for maximum privacy.

---

## Setup

```bash
cd web
npm install
npm run dev
```

No `.env` needed. No Firebase. No API keys.

---

## Files changed from v1

| File | Change |
|---|---|
| `lib/identity.js` | NEW — keypair management, contacts, IDB storage |
| `lib/nostr.js` | NEW — Nostr protocol (events, relay pool, NIP-44) |
| `lib/auth-context.js` | Rewritten — keypair-based, no phone/email |
| `app/login/page.js` | Rewritten — generate or import nsec |
| `app/chat/[chatId]/page.js` | Rewritten — Nostr DMs, real-time via WebSocket |
| `package.json` | Removed Firebase, added nostr-tools |
| `app/api/` | **Deleted** — no server-side code needed |
| `app/setup/`, `app/verify/` | **Deleted** — not needed |
| `lib/firebase.js`, `lib/db.js`, `lib/crypto.js` | **Replaced** |

---

## Privacy guarantees

| What | Who can see it |
|---|---|
| Message content | Only sender + recipient |
| Who sent a message | Relays (sender pubkey is visible — use private relay to hide) |
| Who is talking to whom | Relays (both pubkeys tagged — use private relay to hide) |
| Your phone number | Nobody |
| Your email | Nobody |
| Your IP address | The relay you connect to (use Tor/VPN to hide) |

---

## Multi-device

1. In Settings, reveal your `nsec`
2. Copy it to a password manager
3. On any new device: open Abrigo → "Import key" → paste `nsec`
4. All your message history loads automatically from relays

---

## Self-hosting a relay (optional, max privacy)

```bash
git clone https://github.com/hoytech/strfry
# or
docker run -p 7777:7777 scsibug/nostr-rs-relay
```

Then add `wss://your-server.com` in Abrigo Settings → Relays.

---

*Abrigo — shelter from surveillance.*
