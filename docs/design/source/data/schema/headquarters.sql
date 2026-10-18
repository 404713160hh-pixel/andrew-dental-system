-- Version 3: separate chain headquarters from clinic-scoped managers.
-- All pre-v3 managers held chain-wide authority. Preserve that authority under
-- the explicit HQ role, while invalidating their old authentication sessions.
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE json_extract(data,'$.role') IN ('manager','hq'));
UPDATE users
SET data=json_set(data,'$.role','hq','$.clinicIds',json('[]'))
WHERE json_extract(data,'$.role') IN ('manager','hq');
INSERT INTO metadata(key,value) VALUES('roleModelVersion','5-portal-v1')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
