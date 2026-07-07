-- Copyright Nisse Group Ltd
-- Seed the three Sea to Sky (BC Highway 99) corridor segments with approximate
-- line geometries (WGS84 / SRID 4326). Coordinates are lon lat, ordered south
-- to north, with a few intermediate waypoints per segment.

INSERT INTO segments (id, name, from_label, to_label, ord, geom) VALUES
  (
    'horseshoe-bay-squamish', 'Horseshoe Bay to Squamish', 'Horseshoe Bay', 'Squamish', 0,
    ST_GeomFromText(
      'LINESTRING(-123.2736 49.3746, -123.2417 49.4550, -123.2003 49.6210, -123.1558 49.7016)',
      4326
    )
  ),
  (
    'squamish-whistler', 'Squamish to Whistler', 'Squamish', 'Whistler', 1,
    ST_GeomFromText(
      'LINESTRING(-123.1558 49.7016, -123.1560 49.7620, -123.1200 49.9400, -122.9574 50.1163)',
      4326
    )
  ),
  (
    'whistler-pemberton', 'Whistler to Pemberton', 'Whistler', 'Pemberton', 2,
    ST_GeomFromText(
      'LINESTRING(-122.9574 50.1163, -122.9500 50.1600, -122.8600 50.2500, -122.8078 50.3192)',
      4326
    )
  )
ON CONFLICT (id) DO NOTHING;
