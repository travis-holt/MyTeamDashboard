import { plusDays } from "../parse/normalize.js";

export type TrendPeriod = "7" | "30" | "90" | "month";

export function trendRange(today: string, period: TrendPeriod) {
  return {
    from:
      period === "month"
        ? today.slice(0, 7) + "-01"
        : plusDays(today, 1 - Number(period)),
    to: today,
  };
}
