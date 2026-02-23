import { buildRunInstanceId, dedupeRunInstances } from "../../../agent/scheduler/dispatcher.js";

describe("scheduler dispatcher dedupe", () => {
  test("builds deterministic run instance id", () => {
    const id = buildRunInstanceId("cron_daily_intel", "2026-02-24T01:00:00Z");
    expect(id).toBe("cron_daily_intel:2026-02-24T01:00:00Z");
  });

  test("filters already-seen run instance ids", () => {
    const due = [
      {
        job_id: "cron_daily_intel",
        scheduled_at_utc: "2026-02-24T01:00:00Z",
        run_instance_id: "cron_daily_intel:2026-02-24T01:00:00Z",
      },
      {
        job_id: "cron_daily_intel",
        scheduled_at_utc: "2026-02-25T01:00:00Z",
        run_instance_id: "cron_daily_intel:2026-02-25T01:00:00Z",
      },
    ];

    const filtered = dedupeRunInstances(due, new Set(["cron_daily_intel:2026-02-24T01:00:00Z"]));
    expect(filtered).toEqual([
      {
        job_id: "cron_daily_intel",
        scheduled_at_utc: "2026-02-25T01:00:00Z",
        run_instance_id: "cron_daily_intel:2026-02-25T01:00:00Z",
      },
    ]);
  });

  test("dedupes duplicate run ids produced in same batch", () => {
    const due = [
      {
        job_id: "cron_daily_intel",
        scheduled_at_utc: "2026-02-24T01:00:00Z",
        run_instance_id: "cron_daily_intel:2026-02-24T01:00:00Z",
      },
      {
        job_id: "cron_daily_intel",
        scheduled_at_utc: "2026-02-24T01:00:00Z",
        run_instance_id: "cron_daily_intel:2026-02-24T01:00:00Z",
      },
    ];

    const filtered = dedupeRunInstances(due, new Set());
    expect(filtered).toHaveLength(1);
  });
});
