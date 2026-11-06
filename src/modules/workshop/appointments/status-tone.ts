/** Badge-Farbe je Terminstatus. */
export const STATUS_TONE = {
  scheduled: "neutral",
  confirmed: "info",
  in_progress: "accent",
  done: "success",
  cancelled: "danger",
  no_show: "warning",
} as const;
