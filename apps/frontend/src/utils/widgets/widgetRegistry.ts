import type { FC } from 'react';
import type { AppProps } from '../appRegistry';

/**
 * Widget registry — mirrors AppRegistry pattern but for spatial dashboard
 * widgets. Each widget is a floating window with a consistent header
 * (status dot + refresh) via WidgetCard.
 *
 * Ids are namespaced `widget-*` to avoid colliding with app ids.
 * Pure module with no runtime React import (`import type` erased).
 */

export interface WidgetProps extends AppProps {
  /** Optional default city from briefing prefs — widgets may ignore. */
  defaultCity?: string;
}

export type WidgetComponent = FC<WidgetProps>;

export interface WidgetDefinition {
  id: string;
  title: string;
  /** Base world width passed to WindowManager.createWindow */
  defaultSize: number;
  /** Auto-refresh interval in ms (0 = manual only) */
  refreshIntervalMs: number;
  Component: WidgetComponent;
}

const widgets = new Map<string, WidgetDefinition>();

const STUB_FALLBACK: WidgetDefinition = {
  id: 'widget-unknown',
  title: 'Unknown Widget',
  defaultSize: 1.5,
  refreshIntervalMs: 0,
  Component: () => null,
};

let fallbackWidget: WidgetDefinition = STUB_FALLBACK;

export function setFallbackWidget(def: WidgetDefinition): void {
  fallbackWidget = def;
}

export function registerWidget(def: WidgetDefinition): void {
  if (widgets.has(def.id)) {
    throw new Error(`widgetRegistry: widget "${def.id}" is already registered`);
  }
  widgets.set(def.id, def);
}

export function getWidget(id: string): WidgetDefinition {
  return widgets.get(id) ?? fallbackWidget;
}

export function listWidgets(): readonly WidgetDefinition[] {
  return Array.from(widgets.values());
}

export function getWidgetTitle(id: string): string {
  return getWidget(id).title;
}

/** For tests — clears all registrations and restores fallback. */
export function clearWidgetsForTests(): void {
  widgets.clear();
  fallbackWidget = STUB_FALLBACK;
}

export function widgetIdFromWindowId(windowId: string): string {
  return windowId;
}
