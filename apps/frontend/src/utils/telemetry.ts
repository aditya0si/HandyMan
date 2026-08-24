import type { TelemetryProvider, TelemetryEventType } from '@jarvis/shared';

class ClientTelemetryProvider implements TelemetryProvider {
  track(event: TelemetryEventType, payload?: Record<string, string | number | boolean>): void {
    // In production, this would send to PostHog, Sentry, etc.
    // Ensure no raw PII or camera data is included.
    const logEvent = {
      event,
      timestamp: new Date().toISOString(),
      payload,
    };
    
    // For local beta, just log to console.
    console.log(`[Telemetry] ${event}`, logEvent);
  }
}

export const telemetry = new ClientTelemetryProvider();
