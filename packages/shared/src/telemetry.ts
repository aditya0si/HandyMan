export type TelemetryEventType =
  | 'workspace_opened'
  | 'workspace_closed'
  | 'card_opened'
  | 'card_closed'
  | 'card_focused'
  | 'gesture_recognized'
  | 'gesture_action_completed'
  | 'gesture_action_cancelled'
  | 'integration_connected'
  | 'integration_failed'
  | 'briefing_completed'
  | 'ai_request_started'
  | 'ai_request_completed'
  | 'ai_request_failed'
  | 'client_crash'
  | 'ws_connection_established'
  | 'ws_connection_dropped'
  | 'beta_onboarding_completed'
  | 'user_feedback_submitted';

export interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp: string;
  payload?: Record<string, string | number | boolean>;
}

export interface TelemetryProvider {
  track(event: TelemetryEventType, payload?: Record<string, string | number | boolean>): void;
}
