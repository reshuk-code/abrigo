import { ImageResponse } from 'next/og';
import { nip19 } from 'nostr-tools';
import { fetchProfile } from '@/lib/nostr';

export const runtime = 'edge';
export const alt = 'Abrigo — Secure Chat';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }) {
  const { npub } = await params;
  let name = 'Someone';

  try {
    const { type, data } = nip19.decode(npub);
    if (type === 'npub') {
      const profile = await fetchProfile(data);
      if (profile?.name) name = profile.name;
    }
  } catch (e) {}

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(145deg, #080809 0%, #141416 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          padding: '40px',
        }}
      >
        <div
          style={{
            width: '160px',
            height: '160px',
            borderRadius: '40px',
            background: 'rgba(99, 102, 241, 0.1)',
            border: '2px solid rgba(99, 102, 241, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '40px',
          }}
        >
          <svg width="100" height="100" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L3 7V12C3 17.5 6.8 22.5 12 24C17.2 22.5 21 17.5 21 12V7L12 2Z"
              fill="#6366f1"
            />
            <path
              d="M12 6L12 18M8 12L16 12"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: '60px',
              fontWeight: 'bold',
              color: 'white',
              marginBottom: '10px',
              textAlign: 'center',
            }}
          >
            {name} is on Abrigo
          </div>
          <div
            style={{
              fontSize: '30px',
              color: 'rgba(255, 255, 255, 0.5)',
              textAlign: 'center',
            }}
          >
            Join them for secure, private, decentralized chat.
          </div>
        </div>
        <div
          style={{
            marginTop: '60px',
            padding: '15px 40px',
            borderRadius: '15px',
            background: '#6366f1',
            color: 'white',
            fontSize: '24px',
            fontWeight: 'bold',
          }}
        >
          Join Now
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
