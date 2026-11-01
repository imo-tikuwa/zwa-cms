-- Uploads from the app were recorded as application/octet-stream (the IPC
-- overwrote the type). Recover it from the extension.
UPDATE media SET mime_type = CASE lower(substr(r2_key, instr(r2_key, '.') + 1))
    WHEN 'jpg' THEN 'image/jpeg'
    WHEN 'jpeg' THEN 'image/jpeg'
    WHEN 'png' THEN 'image/png'
    WHEN 'gif' THEN 'image/gif'
    WHEN 'webp' THEN 'image/webp'
    WHEN 'avif' THEN 'image/avif'
    WHEN 'svg' THEN 'image/svg+xml'
    WHEN 'ico' THEN 'image/x-icon'
    WHEN 'pdf' THEN 'application/pdf'
    WHEN 'mp4' THEN 'video/mp4'
    WHEN 'mp3' THEN 'audio/mpeg'
    ELSE mime_type
  END
WHERE mime_type = 'application/octet-stream';
