import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearWidgetsForTests,
  getWidget,
  getWidgetTitle,
  listWidgets,
  registerWidget,
  setFallbackWidget,
  widgetIdFromWindowId,
} from './widgetRegistry';
import type { WidgetComponent, WidgetDefinition } from './widgetRegistry';

const dummyA = (() => null) as WidgetComponent;
const dummyB = (() => null) as WidgetComponent;
const dummyFallback = (() => null) as WidgetComponent;

describe('widgetRegistry', () => {
  beforeEach(() => {
    clearWidgetsForTests();
    setFallbackWidget({
      id: 'widget-unknown',
      title: 'Unknown Widget',
      defaultSize: 1.5,
      refreshIntervalMs: 0,
      Component: dummyFallback,
    });
  });

  it('register + getWidget returns the exact definition by reference', () => {
    const def: WidgetDefinition = { id: 'widget-a-1', title: 'A', defaultSize: 1.5, refreshIntervalMs: 60000, Component: dummyA };
    registerWidget(def);
    expect(getWidget('widget-a-1')).toBe(def);
    expect(getWidget('widget-a-1').Component).toBe(dummyA);
    expect(getWidget('widget-a-1').defaultSize).toBe(1.5);
    expect(getWidget('widget-a-1').refreshIntervalMs).toBe(60000);
  });

  it('listWidgets preserves registration order', () => {
    registerWidget({ id: 'widget-b-1', title: 'B', defaultSize: 1.2, refreshIntervalMs: 0, Component: dummyA });
    registerWidget({ id: 'widget-b-2', title: 'B2', defaultSize: 1.3, refreshIntervalMs: 0, Component: dummyB });
    const ids = listWidgets().map((w) => w.id);
    expect(ids).toContain('widget-b-1');
    expect(ids).toContain('widget-b-2');
    expect(ids.indexOf('widget-b-1')).toBeLessThan(ids.indexOf('widget-b-2'));
  });

  it('getWidgetTitle returns title for registered ids', () => {
    registerWidget({ id: 'widget-c-1', title: 'Clock', defaultSize: 1.5, refreshIntervalMs: 1000, Component: dummyA });
    expect(getWidgetTitle('widget-c-1')).toBe('Clock');
  });

  it('unknown id returns fallback', () => {
    const fallback: WidgetDefinition = { id: 'widget-unknown', title: 'Unknown Widget', Component: dummyFallback, defaultSize: 1.5, refreshIntervalMs: 0 };
    setFallbackWidget(fallback);
    expect(getWidget('nope')).toBe(fallback);
    expect(getWidgetTitle('nope')).toBe('Unknown Widget');
  });

  it('register throws on duplicate id', () => {
    const first: WidgetDefinition = { id: 'widget-dup', title: 'First', defaultSize: 1.5, refreshIntervalMs: 0, Component: dummyA };
    registerWidget(first);
    const second: WidgetDefinition = { id: 'widget-dup', title: 'Second', defaultSize: 1.5, refreshIntervalMs: 0, Component: dummyB };
    expect(() => registerWidget(second)).toThrow(/already registered/);
    expect(getWidget('widget-dup').title).toBe('First');
  });

  it('widgetIdFromWindowId passthrough', () => {
    expect(widgetIdFromWindowId('widget-weather-1')).toBe('widget-weather-1');
    expect(widgetIdFromWindowId('widget-clock-1')).toBe('widget-clock-1');
  });

  it('stores refreshInterval and defaultSize correctly', () => {
    registerWidget({ id: 'widget-e-1', title: 'E', defaultSize: 2.1, refreshIntervalMs: 300000, Component: dummyA });
    const w = getWidget('widget-e-1');
    expect(w.defaultSize).toBeCloseTo(2.1);
    expect(w.refreshIntervalMs).toBe(300000);
  });
});
