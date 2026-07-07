# 3D aircraft model

Drop the aircraft model the 3D flight view (`/3d-view/:flightId`) loads here.

Expected files (default names, referenced in
`src/app/components/flight-view-3d/flight-view-3d.component.ts`):

- `aircraft.obj` — **required**. The Wavefront OBJ model.
- `aircraft.mtl` — **optional**. Material file; if present it's applied,
  otherwise a default light material is used.
- any texture images the `.mtl` references — optional.

To use a different filename, change `MODEL_OBJ_URL` / `MODEL_MTL_URL` at the top
of `flight-view-3d.component.ts`.

The model is auto-centered and auto-scaled, so its native size/units don't
matter. If the nose doesn't point along the flight heading, adjust
`MODEL_YAW_OFFSET_DEG` in the same file.
