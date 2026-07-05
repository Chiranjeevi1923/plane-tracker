import { Component, effect, inject } from '@angular/core';
import { HeaderComponent } from './components/header/header.component';
import { MapComponent } from './components/map/map.component';
import { MapThemeService } from './services/map-theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HeaderComponent, MapComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly mapTheme = inject(MapThemeService);

  title = 'plane-tracker';

  constructor() {
    // Reflect the day/night theme onto <html> so the global light-theme token
    // overrides (html.theme-light) apply. This drives every token-based
    // component (panels, hover card, …) — not just the map.
    effect(() => {
      const isLight = this.mapTheme.theme() === 'day';
      document.documentElement.classList.toggle('theme-light', isLight);
    });
  }
}
