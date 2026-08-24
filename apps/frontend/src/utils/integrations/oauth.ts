/**
 * OAuth with PKCE authorization flow, talking to our backend API.
 */
export async function initiateOAuthFlow(provider: 'google' | 'todoist'): Promise<void> {
  const token = localStorage.getItem('jarvis_token');
  const headers: HeadersInit = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Fetch the redirect URL from our backend
  const res = await fetch(`/api/oauth/connect/${provider}`, { headers });
  if (!res.ok) throw new Error('Failed to initiate OAuth flow');
  
  const data = await res.json();
  if (data.url && typeof window !== 'undefined') {
    window.location.href = data.url;
  }
}
