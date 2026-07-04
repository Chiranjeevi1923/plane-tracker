import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Loads the Google Maps JavaScript API at runtime.
 *
 * `@angular/google-maps` v19 uses Google's "dynamic library import" API — the
 * <google-map> component internally calls `google.maps.importLibrary('maps')`.
 * That function only exists when the API is loaded via Google's *bootstrap
 * loader* (not the legacy `?key=...&callback=...` script tag). So this service
 * installs the bootstrap loader, which defines `google.maps.importLibrary`, and
 * then awaits the 'maps' library so callers know the map is ready to render.
 *
 * Why a service instead of a hardcoded snippet in index.html:
 *  - The API key lives only in the gitignored environment files and is read
 *    here at runtime, so it never gets committed via index.html.
 *  - Loading happens exactly once (a cached Promise) and is shared across every
 *    map component, so we never inject the script twice.
 *  - Failures (missing/invalid key, network error) reject the Promise so callers
 *    can show a clear error instead of a silently blank map.
 */
@Injectable({ providedIn: 'root' })
export class GoogleMapsLoaderService {
  /** Cached load Promise — ensures the API is loaded only once. */
  private loadPromise?: Promise<void>;

  /**
   * Ensures the Google Maps JS API (and its 'maps' library) is loaded. Safe to
   * call from every map component; the underlying work runs only once.
   */
  load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    // Already fully loaded (e.g. after a hot reload) — nothing to do.
    // Accessed untyped because the ambient types declare importLibrary as always
    // present, whereas at runtime it only exists after the API has loaded.
    const existingMaps = (window as unknown as { google?: { maps?: Record<string, unknown> } })
      .google?.maps;
    if (existingMaps?.['importLibrary']) {
      this.loadPromise = Promise.resolve();
      return this.loadPromise;
    }

    const apiKey = environment.googleMapsApiKey;
    if (!apiKey) {
      const message =
        'Google Maps API key is missing. Set `googleMapsApiKey` in ' +
        'src/environments/environment.ts (copy from environment.example.ts).';
      console.error('[GoogleMapsLoaderService]', message);
      this.loadPromise = Promise.reject(new Error(message));
      return this.loadPromise;
    }

    // Install google.maps.importLibrary (the bootstrap loader), then request the
    // 'maps' library. importLibrary rejects if the key/network is bad.
    this.installBootstrapLoader(apiKey);

    this.loadPromise = google.maps
      .importLibrary('maps')
      .then(() => {
        console.info('[GoogleMapsLoaderService] Google Maps JS API loaded.');
      })
      .catch((error: unknown) => {
        console.error(
          '[GoogleMapsLoaderService] Failed to load the Google Maps JS API.',
          error,
        );
        // Reset so a later retry can attempt loading again.
        this.loadPromise = undefined;
        throw error instanceof Error
          ? error
          : new Error('Failed to load the Google Maps JS API.');
      });

    return this.loadPromise;
  }

  /**
   * Readable implementation of Google's official inline bootstrap loader.
   *
   * It defines `google.maps.importLibrary(name)`, which on first call injects
   * the Maps `<script>` (requesting the accumulated set of libraries) and, once
   * that script has run, hands off to the *real* `importLibrary` that Google
   * installs — returning the requested library. Subsequent calls reuse the same
   * injected script.
   */
  private installBootstrapLoader(apiKey: string): void {
    const globalScope = window as unknown as {
      google?: { maps?: Record<string, unknown> };
    };
    const googleObj = (globalScope.google ??= {});
    const mapsObj = (googleObj.maps ??= {});

    // Bootstrap already installed (or the full API is present) — don't redefine.
    if (mapsObj['importLibrary']) {
      return;
    }

    const requestedLibraries = new Set<string>();
    // Unique key on google.maps used as the script's onload callback target.
    const CALLBACK_KEY = '__plane_tracker_gmaps_ready__';
    let scriptPromise: Promise<void> | undefined;

    const loadScript = (): Promise<void> => {
      if (scriptPromise) {
        return scriptPromise;
      }
      scriptPromise = new Promise<void>((resolve, reject) => {
        const params = new URLSearchParams({
          key: apiKey,
          v: 'weekly',
          // `loading=async` tells Google to load the API asynchronously; without
          // it the API logs a "loaded directly without loading=async"
          // performance warning.
          loading: 'async',
          libraries: [...requestedLibraries].join(','),
          callback: `google.maps.${CALLBACK_KEY}`,
        });
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
        script.async = true;
        // Google invokes this once the API script has finished executing.
        mapsObj[CALLBACK_KEY] = resolve;
        script.onerror = () =>
          reject(new Error('Google Maps JS API script could not load.'));
        document.head.append(script);
      });
      return scriptPromise;
    };

    // Temporary importLibrary: record the requested library, ensure the script
    // is loaded, then delegate to the real importLibrary Google installs.
    mapsObj['importLibrary'] = (library: string) => {
      requestedLibraries.add(library);
      return loadScript().then(() =>
        (mapsObj['importLibrary'] as (name: string) => Promise<unknown>)(
          library,
        ),
      );
    };
  }
}
