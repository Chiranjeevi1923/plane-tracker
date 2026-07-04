import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MapThemeService } from '../../services/map-theme.service';

/**
 * Top navigation bar. Presentational apart from the day/night toggle, which
 * delegates to MapThemeService (the map reacts to the shared theme signal).
 */
@Component({
  selector: 'app-header',
  standalone: true,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  private readonly mapTheme = inject(MapThemeService);

  readonly title = 'Plane Tracker';

  /** Current map theme signal, read by the template to pick the icon. */
  readonly theme = this.mapTheme.theme;

  /** Flip the map between day and night. */
  toggleTheme(): void {
    this.mapTheme.toggle();
  }
}
