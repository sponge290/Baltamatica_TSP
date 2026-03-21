# Static Data Source Rule

Single source of truth:

- Authoritative data directory: `project/data`
- Runtime/public copy directory: `project/frontend/public/data`

## Workflow

1. Edit CSV files only in `project/data`.
2. Run `npm run sync:data` at repo root.
3. Build/deploy frontend.

## Files covered by sync

- `cities.csv`
- `road_segments.csv`
- `test_cases.csv`
- `weather_observations.csv`

## Encoding rule

- All CSV files must be UTF-8 without BOM.
- Script `project/scripts/sync_static_data.mjs` normalizes source and target files to UTF-8 without BOM.
