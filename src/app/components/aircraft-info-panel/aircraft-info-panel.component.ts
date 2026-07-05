import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/** One end of a flight route (origin or destination). */
export interface FlightEndpoint {
  /** IATA code, e.g. 'HYD'. */
  code: string;
  /** City name, e.g. 'Hyderabad'. */
  city: string;
  /** Full airport name, e.g. 'Rajiv Gandhi Intl'. */
  airport: string;
}

/** View model for the flight details panel (identity + live values). */
export interface FlightPanelInfo {
  flightCode: string;
  airline: string;
  aircraftType: string;
  photoUrl: string;
  origin: FlightEndpoint;
  destination: FlightEndpoint;
  /** Leg completion 0 → 1, drives the progress track + plane marker. */
  progress: number;
  altitudeFt: number;
  speedKts: number;
  headingDeg: number;
}

/** Actions the panel can request from its host (the map). */
export type PanelAction = 'route' | 'onboard' | 'follow';

/**
 * Flight details panel shown when an aircraft is selected. Presentational: it
 * renders the supplied view model and emits `close` / `action`; the map owns
 * selection state, feeds live data in, and handles the actions. Styled entirely
 * from the design tokens, so it themes light/dark automatically.
 */
@Component({
  selector: 'app-aircraft-info-panel',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './aircraft-info-panel.component.html',
  styleUrl: './aircraft-info-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AircraftInfoPanelComponent {
  /** The flight to display. */
  readonly info = input.required<FlightPanelInfo>();
  /** Actions currently active/toggled-on, highlighted in the action bar. */
  readonly activeActions = input<PanelAction[]>([]);
  /** Emitted when the user dismisses the panel. */
  readonly close = output<void>();
  /** Emitted when the user taps one of the action-bar buttons. */
  readonly action = output<PanelAction>();

  /** Whether an action-bar button should show its active highlight. */
  isActive(action: PanelAction): boolean {
    return this.activeActions().includes(action);
  }

  /** Progress as a clamped 0–100 integer, for the track fill + plane position. */
  readonly progressPct = computed(() =>
    Math.round(Math.max(0, Math.min(1, this.info().progress)) * 100),
  );

  /** Hide a broken photo so the banner falls back to its gradient. */
  onPhotoError(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
