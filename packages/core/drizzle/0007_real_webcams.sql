-- Copyright Nisse Group Ltd
-- 0007_real_webcams.sql — point the webcams at REAL DriveBC Sea to Sky cameras.
--
-- The original seed used https://images.drivebc.ca/bchighwaycam/pub/cameras/<id>.jpg,
-- which now returns a generic "camera unavailable" placeholder for every id. The
-- live still images are served at https://www.drivebc.ca/images/<id>.jpg. Camera
-- ids below are verified Highway 99 (Sea to Sky) cameras from the DriveBC webcam
-- list (https://www.drivebc.ca/api/webcams/).

UPDATE webcams SET
  label = 'Hwy 99 at Britannia Beach',
  image_url = 'https://www.drivebc.ca/images/520.jpg',
  source_url = 'https://www.drivebc.ca/'
WHERE id = 'drivebc-hbs-1';

UPDATE webcams SET
  label = 'Hwy 99 north of Squamish (Culliton)',
  image_url = 'https://www.drivebc.ca/images/690.jpg',
  source_url = 'https://www.drivebc.ca/'
WHERE id = 'drivebc-sw-1';

UPDATE webcams SET
  label = 'Hwy 99 at Pemberton',
  image_url = 'https://www.drivebc.ca/images/596.jpg',
  source_url = 'https://www.drivebc.ca/'
WHERE id = 'drivebc-wp-1';

-- Reset the cached image URL so the fetcher re-derives it from the new base URL.
UPDATE webcams SET last_image_url = NULL, last_captured_at = NULL
WHERE id IN ('drivebc-hbs-1', 'drivebc-sw-1', 'drivebc-wp-1');

-- A second camera per segment for fuller corridor coverage.
INSERT INTO webcams (id, segment_id, label, image_url, source_url, attribution, refresh_seconds) VALUES
  ('drivebc-hbs-2', 'horseshoe-bay-squamish', 'Hwy 99 at Lions Bay',
   'https://www.drivebc.ca/images/765.jpg', 'https://www.drivebc.ca/', 'DriveBC', 120),
  ('drivebc-sw-2', 'squamish-whistler', 'Hwy 99 at Alice Lake, Squamish',
   'https://www.drivebc.ca/images/179.jpg', 'https://www.drivebc.ca/', 'DriveBC', 120),
  ('drivebc-wp-2', 'whistler-pemberton', 'Hwy 99 at Wedge, north of Whistler',
   'https://www.drivebc.ca/images/152.jpg', 'https://www.drivebc.ca/', 'DriveBC', 120)
ON CONFLICT (id) DO NOTHING;
