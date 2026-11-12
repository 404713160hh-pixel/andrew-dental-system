CREATE TABLE patient_avatars (
  patient_id uuid PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 16 AND 92160)
);
