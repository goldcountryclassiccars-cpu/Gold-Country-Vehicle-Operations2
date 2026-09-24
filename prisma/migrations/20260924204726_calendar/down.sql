-- Reverts the calendar migration.
DROP TABLE IF EXISTS "StaffTimeOff";
DROP TABLE IF EXISTS "StaffShift";
DROP TABLE IF EXISTS "CalendarEvent";
DROP TYPE IF EXISTS "TimeOffKind";
DROP TYPE IF EXISTS "CalendarEventSource";
