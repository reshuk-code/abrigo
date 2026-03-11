import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  metadataBase: new URL("https://abrigo-w3.antqr.xyz"),
  title: {
    default: "Abrigo — Private, Decentralized Chat",
    template: "%s | Abrigo"
  },
  description: "Secure, end-to-end encrypted messaging powered by Nostr. No phone numbers, no emails, no servers. Just you and your keys.",
  keywords: ["decentralized chat", "nostr", "encrypted", "private messenger", "p2p", "secure", "webrtc", "web3", "react", "nextjs"],
  authors: [{ name: "Abrigo Team" }],
  creator: "Abrigo",
  openGraph: {
    title: "Abrigo — Private, Decentralized Chat",
    description: "Secure, end-to-end encrypted messaging powered by Nostr. No phone numbers, no emails. Live on the decentralized web.",
    url: "https://abrigo-w3.antqr.xyz",
    siteName: "Abrigo",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/logo.svg",
        width: 800,
        height: 800,
        alt: "Abrigo Logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Abrigo — Private, Decentralized Chat",
    description: "Secure, end-to-end encrypted messaging powered by Nostr.",
    images: ["/logo.svg"],
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/logo.svg',
  },
};

export const viewport = {
  themeColor: '#6366f1',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
