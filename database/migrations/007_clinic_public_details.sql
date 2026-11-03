-- Optional public information; existing clinics retain their records unchanged.
ALTER TABLE clinics ADD COLUMN description text;
ALTER TABLE clinics ADD COLUMN opening_hours text;
