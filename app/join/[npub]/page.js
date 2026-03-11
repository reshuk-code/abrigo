import { fetchProfile } from "@/lib/nostr";
import { nip19 } from "nostr-tools";
import Link from "next/link";

export async function generateMetadata({ params }) {
  const { npub } = await params;
  let name = "Someone";

  try {
    const { type, data } = nip19.decode(npub);
    if (type === "npub") {
      const profile = await fetchProfile(data);
      if (profile?.name) name = profile.name;
    }
  } catch (e) {}

  const title = `${name} is on Abrigo`;
  const description = `${name} wants to chat securely with you on Abrigo. No servers, no accounts, just privacy.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: "/logo.svg", // Ideally a dynamic OG image, but logo for now
          width: 400,
          height: 400,
        },
      ],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: ["/logo.svg"],
    },
  };
}

export default async function JoinPage({ params }) {
  const { npub } = await params;
  let profile = null;
  let pubkeyHex = null;

  try {
    const { type, data } = nip19.decode(npub);
    if (type === "npub") {
      pubkeyHex = data;
      profile = await fetchProfile(data);
    }
  } catch (e) {}

  const name = profile?.name || "Someone";

  return (
    <div style={{ minHeight: '100vh', background: '#080809', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={{ maxWidth: 400, width: '100%', background: 'linear-gradient(145deg, #141416, #0f0f11)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 32, textAlign: 'center', boxShadow: '0 40px 80px rgba(0,0,0,0.6)', animation: 'fadeIn 0.4s ease-out' }}>
        <div style={{ width: 80, height: 80, borderRadius: 24, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <img src="/logo.svg" alt="Abrigo" style={{ width: 48, height: 48 }} />
        </div>

        <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 600, marginBottom: 12 }}>Join {name} on Abrigo</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
          {name} invited you to chat securely. Abrigo is a decentralized, end-to-end encrypted messenger with no servers or accounts.
        </p>

        <Link href={pubkeyHex ? `/chat/${pubkeyHex}` : "/login"}
          style={{ display: 'block', width: '100%', padding: '14px', borderRadius: 12, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontSize: 16, fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 20px rgba(99,102,241,0.4)', transition: 'all 0.2s' }}>
          Start Chatting
        </Link>

        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, marginTop: 24 }}>
          No download required. Works in your browser.
        </p>
      </div>
    </div>
  );
}
