import { register, setFallbackApp } from '../../utils/appRegistry';
import { Briefing } from './Briefing';
import { AuthCard } from './AuthCard';
import { ShareFlow } from './ShareFlow';
import { Chat } from './Chat';
import { Dashboard } from './Dashboard';
import { Markets } from './Markets';
import { News } from './News';
import { Notes } from './Notes';
import { Search } from './Search';
import { Settings } from './Settings';
import { UnknownApp } from './UnknownApp';
import { Weather } from './Weather';
import { CalendarCard } from './CalendarCard';
import { TaskCard } from './TaskCard';
import { MusicCard } from './MusicCard';
import { LinksCard } from './LinksCard';
import { Legal } from './Legal';
import { WeatherWidget } from '../widgets/WeatherWidget';
import { MarketsWidget } from '../widgets/MarketsWidget';
import { NewsWidget } from '../widgets/NewsWidget';
import { ClockWidget } from '../widgets/ClockWidget';
import { SystemWidget } from '../widgets/SystemWidget';
import { registerWidget } from '../../utils/widgets/widgetRegistry';
import { WIDGET_DEFAULT_WIDTHS } from '../../utils/bootScene';

/**
 * App registrations (D7): executed once per page load (ESM single
 * execution, no registry persistence) — register() throws on duplicate
 * ids, so partial re-registration is unreachable by construction.
 * App.tsx imports this module for its side effect; the registry itself
 * stays React-free (node-testable).
 */
register({ id: 'briefing', title: 'Daily Briefing', Component: Briefing });
register({ id: 'news', title: 'News Board', Component: News });
register({ id: 'weather', title: 'Weather', Component: Weather });
register({ id: 'markets', title: 'Markets', Component: Markets });
register({ id: 'dashboard', title: 'Dashboard', Component: Dashboard });
register({ id: 'notes', title: 'Notes', Component: Notes });
register({ id: 'chat', title: 'LLM Chat', Component: Chat });
register({ id: 'search', title: 'Web Search', Component: Search });
register({ id: 'settings', title: 'Settings', Component: Settings });
register({ id: 'calendar', title: 'Google Calendar', Component: CalendarCard });
register({ id: 'tasks', title: 'Todoist Tasks', Component: TaskCard });
register({ id: 'music', title: 'Spotify', Component: MusicCard });
register({ id: 'links', title: 'Saved Links', Component: LinksCard });
register({ id: 'auth', title: 'Account', Component: AuthCard });
register({ id: 'share', title: 'Share Workspace', Component: ShareFlow });
register({ id: 'legal', title: 'Legal & Policies', Component: Legal });
// Widget dashboard — each widget is a floating window on the same
// FloatingWindow + gesture system (pinch-grab, dwell, pinch-zoom).
register({ id: 'widget-weather', title: 'Weather', Component: WeatherWidget });
register({ id: 'widget-markets', title: 'Markets', Component: MarketsWidget });
register({ id: 'widget-news', title: 'News', Component: NewsWidget });
register({ id: 'widget-clock', title: 'Clock', Component: ClockWidget });
register({ id: 'widget-system', title: 'System', Component: SystemWidget });
// Mirror into widget registry (spec: widget registry similar to app registry)
registerWidget({ id: 'widget-weather', title: 'Weather', defaultSize: WIDGET_DEFAULT_WIDTHS['widget-weather'], refreshIntervalMs: 600_000, Component: WeatherWidget });
registerWidget({ id: 'widget-markets', title: 'Markets', defaultSize: WIDGET_DEFAULT_WIDTHS['widget-markets'], refreshIntervalMs: 60_000, Component: MarketsWidget });
registerWidget({ id: 'widget-news', title: 'News', defaultSize: WIDGET_DEFAULT_WIDTHS['widget-news'], refreshIntervalMs: 300_000, Component: NewsWidget });
registerWidget({ id: 'widget-clock', title: 'Clock', defaultSize: WIDGET_DEFAULT_WIDTHS['widget-clock'], refreshIntervalMs: 1000, Component: ClockWidget });
registerWidget({ id: 'widget-system', title: 'System', defaultSize: WIDGET_DEFAULT_WIDTHS['widget-system'], refreshIntervalMs: 1000, Component: SystemWidget });
setFallbackApp({ id: 'unknown', title: 'Unknown App', Component: UnknownApp });
