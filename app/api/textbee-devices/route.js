// This debug endpoint has been intentionally disabled.
// It was used once to retrieve the TextBee device ID during initial setup.
// Leaving it live would expose TEXTBEE_API_KEY to any public request.

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
