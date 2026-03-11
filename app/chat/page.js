'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function ChatIndexPage() {
  const { identity, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (identity) router.replace('/chat/_');
      else router.replace('/login');
    }
  }, [identity, loading, router]);

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 18, height: 18, border: '1.5px solid rgba(255,255,255,0.06)', borderTop: '1.5px solid rgba(255,255,255,0.35)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
