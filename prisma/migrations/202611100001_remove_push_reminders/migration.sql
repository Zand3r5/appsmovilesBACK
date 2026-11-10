-- Remote push delivery and release subscriptions were removed. In-app social
-- notifications remain stored in Notification.
DROP TABLE "PushDelivery";
DROP TABLE "PushDevice";
DROP TABLE "ReleaseReminder";
