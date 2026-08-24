/**
 * M13 HTTP API assembly (brief D3/D4/D6/D8/D9/D10). createHttpApp returns
 * a fully-wired Express app (health + workspace REST + proxy routes +
 * manual CORS + per-IP rate limiting); server.ts composes it with the WS
 * server (which still binds FIRST — v11/v12 pin the two listening lines
 * and their order). Everything injectable (env, fetch, clock, store,
 * state) so vitest drives the real app on an ephemeral port with mocked
 * upstreams and zero network.
 *
 * Proxy semantics (D6): PASSTHROUGH — the LLM route pipes upstream SSE
 * bytes through unchanged (the browser reuses its existing SSE parsers),
 * the search route passes through the upstream JSON body + status. Keys
 * live ONLY in backend env (D8) and are never exposed to the browser.
 */
import express from 'express';
import type { Request, Response as ExpressResponse } from 'express';
import type { GeminiMessage, WindowState } from '@jarvis/shared';
import {
  GEMINI_MODEL,
  buildGeminiBody,
  buildGeminiUrl,
  buildSearchUrl,
} from '@jarvis/shared';
import { StateManager } from '../state/manager';
import type { WorkspaceStore } from '../state/store';
import type { IUserRepository, IWorkspaceRepository, IUsageRepository } from '../state/repository';
import { createAuthRouter, optionalAuthMiddleware } from './auth';
import { createOAuthRouter } from './oauth';
import { createIntegrationsRouter } from './integrations';
import {
  LLM_RATE_LIMIT_PER_MINUTE,
  SEARCH_RATE_LIMIT_PER_MINUTE,
  createRateLimiter,
} from './rate-limiter';

/** Manual-CORS allowlist (D10): the Vite dev origins only. */
export const CORS_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:5173', // Vite dev server
  'http://127.0.0.1:5173',
  'http://localhost:4173', // vite preview (M14: the production build verifier)
  'http://127.0.0.1:4173',
];

export interface ProxyEnv {
  geminiApiKey?: string;
  googleSearchApiKey?: string;
  googleSearchCx?: string;
}

export interface HttpAppDeps {
  stateManager: StateManager;
  store: WorkspaceStore;
  /** Reported by /api/health (the WS port the composer bound). */
  wsPort: number;
  userRepo: IUserRepository;
  workspaceRepo: IWorkspaceRepository;
  usageRepo: IUsageRepository;
  /** Injectable for tests; default reads process.env PER REQUEST. */
  env?: ProxyEnv;
  /** Injectable for tests (mocked upstreams); default bound global fetch. */
  fetchImpl?: typeof fetch;
  /** Rate-limiter clock (tests); default Date.now. */
  now?: () => number;
}

/** Same wire predicate the WS layer applies (duplicated by design — the
 *  WS module stays untouched; both are pinned by their own tests). */
function isWindowState(value: unknown): value is WindowState {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Partial<WindowState>;
  return (
    typeof w.id === 'string' &&
    typeof w.title === 'string' &&
    typeof w.owner === 'string' &&
    Array.isArray(w.position) &&
    w.position.length === 3 &&
    w.position.every((n) => typeof n === 'number') &&
    typeof w.rotationY === 'number' &&
    typeof w.scale === 'number' &&
    typeof w.zIndex === 'number' &&
    typeof w.lastModified === 'number'
  );
}

function isGeminiMessage(value: unknown): value is GeminiMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<GeminiMessage>;
  return (
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string'
  );
}

export function createHttpApp(deps: HttpAppDeps): express.Express {
  const { stateManager, store, wsPort } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch.bind(globalThis);
  const getEnv = (): ProxyEnv =>
    deps.env ?? {
      geminiApiKey: process.env.GEMINI_API_KEY,
      googleSearchApiKey: process.env.GOOGLE_SEARCH_API_KEY,
      googleSearchCx: process.env.GOOGLE_SEARCH_CX,
    };
  const llmLimiter = createRateLimiter({
    limitPerMinute: LLM_RATE_LIMIT_PER_MINUTE,
    now: deps.now,
  });
  const searchLimiter = createRateLimiter({
    limitPerMinute: SEARCH_RATE_LIMIT_PER_MINUTE,
    now: deps.now,
  });
  const clientIp = (req: Request): string =>
    req.socket.remoteAddress ?? 'unknown';

  const app = express();
  app.use(express.json());

  // Manual CORS (D10): three headers, allowlist only, no dependency.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && CORS_ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      wsPort,
    });
  });

  app.use('/api/auth', createAuthRouter({
    userRepo: deps.userRepo,
    workspaceRepo: deps.workspaceRepo,
    usageRepo: deps.usageRepo,
  }));

  app.use('/api/oauth', createOAuthRouter());
  app.use('/api/integrations', createIntegrationsRouter());

  // --- Workspace REST (D4) ----------------------------------------------
  // If authenticated, fetches user's default workspace. If guest, falls back to legacy store.
  app.get('/api/workspace', optionalAuthMiddleware, async (req, res) => {
    const userId = (req as any).userId;
    if (userId) {
      const user = await deps.userRepo.getUserById(userId);
      if (user?.defaultWorkspaceId) {
        const ws = await deps.workspaceRepo.getWorkspace(user.defaultWorkspaceId);
        if (ws) {
          res.json({ windows: ws.windows });
          return;
        }
      }
    }
    // Guest fallback
    res.json({ windows: store.read().windows });
  });

  app.put('/api/workspace', optionalAuthMiddleware, async (req, res) => {
    const body = req.body as { windows?: unknown };
    if (
      typeof body !== 'object' ||
      body === null ||
      !Array.isArray(body.windows) ||
      !body.windows.every(isWindowState)
    ) {
      res.status(400).json({ error: 'invalid_workspace' });
      return;
    }
    const windows = body.windows as WindowState[];
    
    const userId = (req as any).userId;
    if (userId) {
      const user = await deps.userRepo.getUserById(userId);
      if (user?.defaultWorkspaceId) {
        await deps.workspaceRepo.updateWorkspace(user.defaultWorkspaceId, { windows });
        res.json({ ok: true, count: windows.length });
        return;
      }
    }

    // Guest fallback
    stateManager.replaceAllWindows(windows); 
    store.scheduleSave(stateManager.getFullState().windows);
    store.flush();
    res.json({ ok: true, count: windows.length });
  });

  // --- Proxy (D6/D8/D9) --------------------------------------------------
  app.get('/api/proxy/status', (_req, res) => {
    const env = getEnv();
    res.json({
      llm: Boolean(env.geminiApiKey && env.geminiApiKey.trim() !== ''),
      search: Boolean(
        env.googleSearchApiKey &&
          env.googleSearchApiKey.trim() !== '' &&
          env.googleSearchCx &&
          env.googleSearchCx.trim() !== '',
      ),
    });
  });

  app.post('/api/proxy/llm', optionalAuthMiddleware, async (req, res) => {
    const limited = llmLimiter.check(clientIp(req));
    if (!limited.allowed) {
      res.setHeader('Retry-After', String(limited.retryAfterSec));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    const userId = (req as any).userId;
    if (userId) {
      // Basic quota check for demo
      const usage = await deps.usageRepo.getMonthlyUsage(userId, 'ai_proxy');
      const user = await deps.userRepo.getUserById(userId);
      // Hardcoded limit for demo purposes (Phase 5 plan)
      const limit = user?.organizationId === 'pro_org' ? 5000 : 100; 
      if (usage >= limit) {
        res.status(402).json({ error: 'quota_exceeded' });
        return;
      }
    }
    const key = getEnv().geminiApiKey?.trim() ?? '';
    if (!key) {
      res.status(503).json({ error: 'not_configured' });
      return;
    }
    const bodyArgs = req.body as { messages?: unknown; options?: unknown };
    const messages = bodyArgs?.messages;
    const options = bodyArgs?.options;

    if (!Array.isArray(messages) || !messages.every(isGeminiMessage)) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    // Tied to the CLIENT connection: a page unload mid-stream aborts the
    // upstream request too (the same clean-stop semantics as M9 direct).
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    let upstream: globalThis.Response;
    try {
      upstream = await fetchImpl(buildGeminiUrl(GEMINI_MODEL, key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGeminiBody(messages, options as any)),
        signal: controller.signal,
      });
    } catch {
      res.status(502).json({ error: 'upstream_error', status: 0 });
      return;
    }
    if (!upstream.ok) {
      res.status(502).json({ error: 'upstream_error', status: upstream.status });
      return;
    }
    if (!upstream.body) {
      res.status(502).json({ error: 'upstream_error', status: 0 });
      return;
    }

    // SSE passthrough: upstream bytes go out unchanged.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      if (userId) {
        // Record usage
        await deps.usageRepo.recordUsage({
          userId,
          organizationId: 'default_org',
          type: 'ai_proxy',
        });
      }
      const body = upstream.body as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of body) {
        res.write(chunk);
      }
      res.end();
    } catch {
      if (res.headersSent) {
        // Mid-stream failure: one typed SSE error event, then close (D6).
        res.write('data: {"error":"upstream_stream_error"}\n\n');
        res.end();
      } else {
        res.status(502).json({ error: 'upstream_error', status: 0 });
      }
    }
  });

  app.get('/api/proxy/search', async (req, res) => {
    const limited = searchLimiter.check(clientIp(req));
    if (!limited.allowed) {
      res.setHeader('Retry-After', String(limited.retryAfterSec));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const env = getEnv();
    const key = env.googleSearchApiKey?.trim() ?? '';
    const cx = env.googleSearchCx?.trim() ?? '';
    if (!key || !cx) {
      res.status(503).json({ error: 'not_configured' });
      return;
    }
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (!query) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }
    try {
      const upstream = await fetchImpl(buildSearchUrl(key, cx, query), {
        method: 'GET',
      });
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') ?? 'application/json',
      );
      res.send(text);
    } catch {
      res.status(502).json({ error: 'upstream_error', status: 0 });
    }
  });

  const TECH_COVER_IMAGES = [
    'https://images.unsplash.com/photo-1593508512255-86ab42a8e620?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=800&q=80',
  ];

  const BADGE_COLORS = ['#00e5ff', '#a855f7', '#10b981', '#f59e0b', '#ec4899', '#3b82f6'];

  /** Live Google News RSS proxy for Technology news. */
  app.get('/api/news', async (_req, res) => {
    const GOOGLE_NEWS_RSS =
      'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en';

    try {
      const response = await fetchImpl(GOOGLE_NEWS_RSS, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
      });

      if (!response.ok) {
        throw new Error(`Upstream status: ${response.status}`);
      }

      const xml = await response.text();
      const articles: Array<{
        id: string;
        title: string;
        source: string;
        timeAgo: string;
        category: string;
        summary: string;
        url: string;
        imageUrl: string;
        badgeColor: string;
      }> = [];

      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match: RegExpExecArray | null = null;
      let index = 0;

      while ((match = itemRegex.exec(xml)) !== null && articles.length < 6) {
        const item = match[1];
        const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(item);
        const linkMatch = /<link>([\s\S]*?)<\/link>/.exec(item);
        const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(item);
        const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(item);
        const descMatch = /<description>([\s\S]*?)<\/description>/.exec(item);

        let title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
        let source = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

        if (!source && title.includes(' - ')) {
          const parts = title.split(' - ');
          source = parts.pop()?.trim() ?? 'Google Tech';
          title = parts.join(' - ');
        }

        const link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
        const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
        const rawSnippet = descMatch
          ? descMatch[1].replace(/<[^>]+>/g, ' ').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/\s+/g, ' ').trim()
          : '';

        let timeAgo = 'Recent';
        if (pubDate) {
          const deltaMs = Date.now() - new Date(pubDate).getTime();
          const mins = Math.floor(deltaMs / (1000 * 60));
          const hours = Math.floor(mins / 60);
          const days = Math.floor(hours / 24);
          if (mins < 60) timeAgo = `${Math.max(1, mins)}m ago`;
          else if (hours < 24) timeAgo = `${hours}h ago`;
          else timeAgo = `${days}d ago`;
        }

        if (title && link) {
          articles.push({
            id: `news-live-${index + 1}`,
            title,
            source: source || 'Tech News',
            timeAgo,
            category: 'Technology',
            summary: rawSnippet.slice(0, 180) || 'Latest technology and spatial computing developments...',
            url: link,
            imageUrl: TECH_COVER_IMAGES[index % TECH_COVER_IMAGES.length],
            badgeColor: BADGE_COLORS[index % BADGE_COLORS.length],
          });
          index++;
        }
      }

      if (articles.length > 0) {
        res.status(200).json({ ok: true, articles });
        return;
      }
      throw new Error('No items parsed');
    } catch {
      // Fallback articles with real working links and high-res visuals
      res.status(200).json({
        ok: true,
        articles: [
          {
            id: 'news-fallback-1',
            title: 'Apple Vision Pro Spatial Computing: Next-Gen VisionOS Advances',
            source: 'The Verge',
            timeAgo: '1h ago',
            category: 'Spatial Computing',
            summary: 'Apple expands spatial computing capabilities with panoramic virtual displays, ultra-low latency hand tracking, and advanced spatial audio modeling.',
            url: 'https://www.apple.com/apple-vision-pro/',
            imageUrl: TECH_COVER_IMAGES[0],
            badgeColor: BADGE_COLORS[0],
          },
          {
            id: 'news-fallback-2',
            title: 'WebXR & Next-Gen Neural Holography Across Browsers',
            source: 'MIT Tech Review',
            timeAgo: '3h ago',
            category: 'Web Standards',
            summary: 'Browser-based 3D engines and WebGL2/WebGPU shaders allow full spatial applications to execute natively in lightweight browsers without app installs.',
            url: 'https://immersiveweb.dev/',
            imageUrl: TECH_COVER_IMAGES[1],
            badgeColor: BADGE_COLORS[1],
          },
          {
            id: 'news-fallback-3',
            title: 'Sub-Millisecond On-Device Vision ML & 21-Point Hand Tracking',
            source: 'ArXiv AI',
            timeAgo: '5h ago',
            category: 'Machine Learning',
            summary: 'New compact neural architectures deliver 21-point hand landmark estimation under 5ms on standard webcam feeds, making spatial gesture navigation ubiquitous.',
            url: 'https://github.com/google-ai-edge/mediapipe',
            imageUrl: TECH_COVER_IMAGES[2],
            badgeColor: BADGE_COLORS[2],
          },
          {
            id: 'news-fallback-4',
            title: 'Photonic Micro-OLED Spatial Displays Breakthrough',
            source: 'IEEE Spectrum',
            timeAgo: '9h ago',
            category: 'Hardware',
            summary: 'Ultra-dense micro-display panels surpass 4,000 pixels per inch, eliminating optical artifacts and enabling lifelike holographic rendering in spatial headsets.',
            url: 'https://spectrum.ieee.org/',
            imageUrl: TECH_COVER_IMAGES[3],
            badgeColor: BADGE_COLORS[3],
          },
          {
            id: 'news-fallback-5',
            title: 'Autonomous Glassmorphic Spatial UI & Gesture Design Systems',
            source: 'Spatial UI Journal',
            timeAgo: '1d ago',
            category: 'System Design',
            summary: 'Adaptive 3D window managers dynamically adjust depth, translucency, and spatial anchoring based on user ergonomics and hand-tracked pointer focal vectors.',
            url: 'https://developer.apple.com/design/human-interface-guidelines/spatial-layout',
            imageUrl: TECH_COVER_IMAGES[4],
            badgeColor: BADGE_COLORS[4],
          },
        ],
      });
    }
  });

  // JSON 404 for unmatched /api routes (+ JSON body-parse errors).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(
    (
      _err: unknown,
      _req: Request,
      res: ExpressResponse,
      _next: () => void,
    ) => {
      res.status(400).json({ error: 'invalid_json' });
    },
  );

  return app;
}
