import { Injectable, signal } from '@angular/core';

/** The two visual themes the map can render in. */
export type MapTheme = 'day' | 'night';

/**
 * Shared source of truth for the map's day/night theme.
 *
 * The toggle control lives in the header while the map is a sibling component,
 * so they can't communicate directly. This service decouples them: the header
 * flips the state and the map reacts to the signal. Kept as a service (not
 * component state) so any future control can drive/read the same theme.
 */
@Injectable({ providedIn: 'root' })
export class MapThemeService {
  /** Current map theme. Components read this reactively. */
  readonly theme = signal<MapTheme>('day');

  /** Flip between day and night. */
  toggle(): void {
    this.theme.update((current) => (current === 'day' ? 'night' : 'day'));
  }
}
