-- Copyright Nisse Group Ltd
-- Seed open DriveBC Highway 99 webcams (one representative camera per segment).
--
-- NOTE: DriveBC serves camera stills at
--   https://images.drivebc.ca/bchighwaycam/pub/cameras/<id>.jpg
-- The numeric camera ids below are EXAMPLE placeholders and should be verified
-- against the current DriveBC camera list before production use.

INSERT INTO webcams (id, segment_id, label, image_url, source_url, attribution, refresh_seconds) VALUES
  (
    'drivebc-hbs-1', 'horseshoe-bay-squamish',
    'Hwy 99 near Britannia Beach',
    'https://images.drivebc.ca/bchighwaycam/pub/cameras/8.jpg',
    'https://images.drivebc.ca/bchighwaycam/pub/html/www/8.html',
    'DriveBC', 120
  ),
  (
    'drivebc-sw-1', 'squamish-whistler',
    'Hwy 99 at Tantalus Lookout',
    'https://images.drivebc.ca/bchighwaycam/pub/cameras/9.jpg',
    'https://images.drivebc.ca/bchighwaycam/pub/html/www/9.html',
    'DriveBC', 120
  ),
  (
    'drivebc-wp-1', 'whistler-pemberton',
    'Hwy 99 at Nairn Falls',
    'https://images.drivebc.ca/bchighwaycam/pub/cameras/10.jpg',
    'https://images.drivebc.ca/bchighwaycam/pub/html/www/10.html',
    'DriveBC', 120
  )
ON CONFLICT (id) DO NOTHING;
