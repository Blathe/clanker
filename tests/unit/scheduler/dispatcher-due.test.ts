import { computeDueRunInstances } from "../../../src/scheduler/dispatcher.js";

describe("scheduler dispatcher due computation", () => {
  test("computes due daily run in America/Los_Angeles", () => {
    const due = computeDueRunInstances({
      jobs: [
        {
          job_id: "cron_daily_intel",
          enabled: true,
          timezone: "America/Los_Angeles",
          schedule_cron: "0 17 * * *",
        },
      ],
      windowStartUtc: "2026-02-24T00:55:00Z",
      windowEndUtc: "2026-02-24T01:05:00Z",
    });

    expect(due).toHaveLength(1);
    expect(due[0].scheduled_at_utc).toBe("2026-02-24T01:00:00Z");
    expect(due[0].run_instance_id).toBe("cron_daily_intel:2026-02-24T01:00:00Z");
  });

  test("skips disabled jobs", () => {
    const due = computeDueRunInstances({
      jobs: [
        {
          job_id: "cron_disabled",
          enabled: false,
          timezone: "UTC",
          schedule_cron: "* * * * *",
        },
      ],
      windowStartUtc: "2026-02-24T00:00:00Z",
      windowEndUtc: "2026-02-24T00:03:00Z",
    });

    expect(due).toEqual([]);
  });

  test("respects day-of-month OR day-of-week semantics when both are restricted", () => {
    const due = computeDueRunInstances({
      jobs: [
        {
          job_id: "cron_or_semantics",
          enabled: true,
          timezone: "UTC",
          schedule_cron: "0 1 1 * 0",
        },
      ],
      // 2026-02-08 is Sunday UTC and not day 1 of month, should still match via DOW
      windowStartUtc: "2026-02-08T00:58:00Z",
      windowEndUtc: "2026-02-08T01:02:00Z",
    });

    expect(due.map((item: { scheduled_at_utc: string }) => item.scheduled_at_utc)).toEqual([
      "2026-02-08T01:00:00Z",
    ]);
  });

  test("supports stepped minute schedules", () => {
    const due = computeDueRunInstances({
      jobs: [
        {
          job_id: "cron_every_15",
          enabled: true,
          timezone: "UTC",
          schedule_cron: "*/15 * * * *",
        },
      ],
      windowStartUtc: "2026-02-24T00:00:00Z",
      windowEndUtc: "2026-02-24T00:31:00Z",
    });

    expect(due.map((item: { scheduled_at_utc: string }) => item.scheduled_at_utc)).toEqual([
      "2026-02-24T00:00:00Z",
      "2026-02-24T00:15:00Z",
      "2026-02-24T00:30:00Z",
    ]);
  });
});
