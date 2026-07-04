/**
 * A static airport definition (geography only). Used as the source/destination
 * endpoints of a flight route. Coordinates are in decimal degrees (WGS84).
 */
export interface Airport {
  /** IATA code, e.g. 'HYD'. */
  code: string;
  /** Full airport name. */
  name: string;
  /** City the airport serves. */
  city: string;
  /** Latitude in decimal degrees. */
  latitude: number;
  /** Longitude in decimal degrees. */
  longitude: number;
}
