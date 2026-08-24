export interface NewsItem {
  id: string;
  title: string;
  source: string;
  timeAgo: string;
  category: string;
  summary: string;
  url: string;
  imageUrl: string;
  badgeColor: string;
}

export const FALLBACK_NEWS_ARTICLES: readonly NewsItem[] = [
  {
    id: 'news-1',
    title: 'Apple Vision Pro Spatial Computing: Next-Gen VisionOS Advances',
    source: 'The Verge',
    timeAgo: '1h ago',
    category: 'Spatial Computing',
    summary:
      'Apple expands spatial computing capabilities with panoramic virtual displays, ultra-low latency hand tracking, and advanced spatial audio modeling.',
    url: 'https://www.apple.com/apple-vision-pro/',
    imageUrl: 'https://images.unsplash.com/photo-1593508512255-86ab42a8e620?auto=format&fit=crop&w=800&q=80',
    badgeColor: '#00e5ff',
  },
  {
    id: 'news-2',
    title: 'WebXR & Next-Gen Neural Holography Across Browsers',
    source: 'MIT Tech Review',
    timeAgo: '3h ago',
    category: 'Web Standards',
    summary:
      'Browser-based 3D engines and WebGL2/WebGPU shaders allow full spatial applications to execute natively in lightweight browsers without app installs.',
    url: 'https://immersiveweb.dev/',
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    badgeColor: '#a855f7',
  },
  {
    id: 'news-3',
    title: 'Sub-Millisecond On-Device Vision ML & 21-Point Hand Tracking',
    source: 'ArXiv AI',
    timeAgo: '5h ago',
    category: 'Machine Learning',
    summary:
      'New compact neural architectures deliver 21-point hand landmark estimation under 5ms on standard webcam feeds, making spatial gesture navigation ubiquitous.',
    url: 'https://github.com/google-ai-edge/mediapipe',
    imageUrl: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=800&q=80',
    badgeColor: '#10b981',
  },
  {
    id: 'news-4',
    title: 'Photonic Micro-OLED Spatial Displays Breakthrough',
    source: 'IEEE Spectrum',
    timeAgo: '9h ago',
    category: 'Hardware',
    summary:
      'Ultra-dense micro-display panels surpass 4,000 pixels per inch, eliminating optical artifacts and enabling lifelike holographic rendering in spatial headsets.',
    url: 'https://spectrum.ieee.org/',
    imageUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80',
    badgeColor: '#f59e0b',
  },
  {
    id: 'news-5',
    title: 'Autonomous Glassmorphic Spatial UI & Gesture Design Systems',
    source: 'Spatial UI Journal',
    timeAgo: '1d ago',
    category: 'System Design',
    summary:
      'Adaptive 3D window managers dynamically adjust depth, translucency, and spatial anchoring based on user ergonomics and hand-tracked pointer focal vectors.',
    url: 'https://developer.apple.com/design/human-interface-guidelines/spatial-layout',
    imageUrl: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=800&q=80',
    badgeColor: '#ec4899',
  },
];

/** Return default curated news articles. */
export function getNewsArticles(): readonly NewsItem[] {
  return FALLBACK_NEWS_ARTICLES;
}

/**
 * Fetches real-time live tech news from the backend /api/news proxy.
 * Seamlessly falls back to enriched curated stories on network/offline conditions.
 */
export async function fetchLiveNews(
  apiBase = 'http://localhost:4000',
  fetchImpl: typeof fetch = fetch,
): Promise<NewsItem[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetchImpl(`${apiBase}/api/news`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const data = (await res.json()) as { ok?: boolean; articles?: NewsItem[] };
    if (data.ok && Array.isArray(data.articles) && data.articles.length > 0) {
      return data.articles;
    }
    return [...FALLBACK_NEWS_ARTICLES];
  } catch {
    return [...FALLBACK_NEWS_ARTICLES];
  }
}

/** Calculate next slide index with cyclic wrapping. */
export function getNextSlideIndex(currentIndex: number, total: number): number {
  if (total <= 0) return 0;
  return (currentIndex + 1) % total;
}

/** Calculate previous slide index with cyclic wrapping. */
export function getPrevSlideIndex(currentIndex: number, total: number): number {
  if (total <= 0) return 0;
  return (currentIndex - 1 + total) % total;
}
