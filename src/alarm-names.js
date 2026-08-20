const DAILY_ALARM_PREFIX = "daily:";
const INTERVAL_ALARM_PREFIX = "interval:";
const COUNTDOWN_ALARM_PREFIX = "countdown:";

function encodeAlarmPart(value) {
  return encodeURIComponent(value);
}

export function decodeAlarmPart(value) {
  return decodeURIComponent(value);
}

export function createDailyAlarmName(targetUrl, time) {
  return `${DAILY_ALARM_PREFIX}${encodeAlarmPart(targetUrl)}:${encodeAlarmPart(time)}`;
}

export function createIntervalAlarmName(targetUrl) {
  return `${INTERVAL_ALARM_PREFIX}${encodeAlarmPart(targetUrl)}`;
}

export function createCountdownAlarmName(targetUrl) {
  return `${COUNTDOWN_ALARM_PREFIX}${encodeAlarmPart(targetUrl)}`;
}

export function isDailyAlarmName(name) {
  return String(name).startsWith(DAILY_ALARM_PREFIX);
}

export function isIntervalAlarmName(name) {
  return String(name).startsWith(INTERVAL_ALARM_PREFIX);
}

export function isCountdownAlarmName(name) {
  return String(name).startsWith(COUNTDOWN_ALARM_PREFIX);
}

export function getDailyAlarmPayload(name) {
  return String(name).slice(DAILY_ALARM_PREFIX.length);
}

export function getIntervalAlarmPayload(name) {
  return String(name).slice(INTERVAL_ALARM_PREFIX.length);
}

export function getCountdownAlarmPayload(name) {
  return String(name).slice(COUNTDOWN_ALARM_PREFIX.length);
}

export function isExtensionAlarmName(name) {
  return isDailyAlarmName(name) || isIntervalAlarmName(name) || isCountdownAlarmName(name);
}
