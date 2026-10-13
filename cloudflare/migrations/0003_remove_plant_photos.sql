DROP TRIGGER photos_generation_insert;
DROP TRIGGER photos_generation_update;
DROP TRIGGER photos_generation_delete;
DROP INDEX photos_by_plant;
DROP TABLE plant_photos;
ALTER TABLE backup_manifests DROP COLUMN photos;
UPDATE app_state SET schema_version=3,generation=generation+1,backup_generation=-1 WHERE id=1;
