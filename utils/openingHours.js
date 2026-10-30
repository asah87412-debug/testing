const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function timeInNepal(date) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kathmandu",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const parts = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday.toLowerCase().slice(0, 3),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function interval(value) {
  if (typeof value !== "string") return null;
  if (/^(24\s*\/\s*7|24\s*hours?)$/i.test(value.trim())) return "always";
  const match = value.match(/^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$/);
  if (!match) return null;
  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
  return { start: startHour * 60 + startMinute, end: endHour * 60 + endMinute };
}

function isCurrentlyOpen(hours, date = new Date()) {
  if (!hours || typeof hours !== "object") return false;
  const { weekday, minutes } = timeInNepal(date);
  const dayIndex = WEEKDAYS.indexOf(weekday);
  const todayHours = hours[weekday] ?? hours[weekday.toUpperCase()];
  const today = interval(todayHours);
  if (today === "always") return true;
  if (today && typeof today === "object") {
    if (today.start <= today.end && minutes >= today.start && minutes < today.end) return true;
    if (today.start > today.end && (minutes >= today.start || minutes < today.end)) return true;
  }
  const previousDay = WEEKDAYS[(dayIndex + WEEKDAYS.length - 1) % WEEKDAYS.length];
  const previousHours = interval(hours[previousDay] ?? hours[previousDay.toUpperCase()]);
  return Boolean(
    previousHours &&
    typeof previousHours === "object" &&
    previousHours.start > previousHours.end &&
    minutes < previousHours.end
  );
}

function isOpenTwentyFourHours(hours) {
  if (!hours || typeof hours !== "object") return false;
  return WEEKDAYS.every((weekday) => interval(hours[weekday] ?? hours[weekday.toUpperCase()]) === "always");
}

module.exports = { isCurrentlyOpen, isOpenTwentyFourHours };
