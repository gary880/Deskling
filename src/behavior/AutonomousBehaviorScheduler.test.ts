import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AutonomousBehaviorScheduler,
  type AutonomySettings,
} from "./AutonomousBehaviorScheduler";

const settings: AutonomySettings = {
  enabled: true,
  allowRoaming: true,
  sleepAfterMinutes: 15,
  wakeOnWindowChange: true,
};

const timing = {
  idleAfterMs: 1_000,
  roamMinDelayMs: 2_000,
  roamMaxDelayMs: 2_000,
};

afterEach(() => vi.useRealTimers());

describe("AutonomousBehaviorScheduler", () => {
  it("schedules idle, roam, and sleep from the latest activity", () => {
    vi.useFakeTimers();
    const callbacks = {
      onIdleVariation: vi.fn(),
      onRoamRequested: vi.fn(),
      onSleepRequested: vi.fn(),
      onWakeRequested: vi.fn(),
    };
    const scheduler = new AutonomousBehaviorScheduler(settings, callbacks, { timing });
    scheduler.start();

    vi.advanceTimersByTime(1_000);
    expect(callbacks.onIdleVariation).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(callbacks.onRoamRequested).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(898_000);
    expect(callbacks.onSleepRequested).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("resets pending timers and wakes a sleeping pet on activity", () => {
    vi.useFakeTimers();
    const callbacks = {
      onIdleVariation: vi.fn(),
      onRoamRequested: vi.fn(),
      onSleepRequested: vi.fn(),
      onWakeRequested: vi.fn(),
    };
    const scheduler = new AutonomousBehaviorScheduler(
      { ...settings, sleepAfterMinutes: 15 },
      callbacks,
      { timing },
    );
    scheduler.start();
    vi.advanceTimersByTime(900_000);
    scheduler.notifyActivity();

    expect(callbacks.onWakeRequested).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(999);
    expect(callbacks.onIdleVariation).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(callbacks.onIdleVariation).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("tracks manually requested sleep so the next activity wakes the pet", () => {
    vi.useFakeTimers();
    const callbacks = {
      onIdleVariation: vi.fn(),
      onRoamRequested: vi.fn(),
      onSleepRequested: vi.fn(),
      onWakeRequested: vi.fn(),
    };
    const scheduler = new AutonomousBehaviorScheduler(settings, callbacks, { timing });
    scheduler.start();
    scheduler.requestSleep();
    scheduler.notifyActivity();

    expect(callbacks.onSleepRequested).toHaveBeenCalledOnce();
    expect(callbacks.onWakeRequested).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("does not wake on window changes when the option is disabled", () => {
    vi.useFakeTimers();
    const callbacks = {
      onIdleVariation: vi.fn(),
      onRoamRequested: vi.fn(),
      onSleepRequested: vi.fn(),
      onWakeRequested: vi.fn(),
    };
    const scheduler = new AutonomousBehaviorScheduler(
      { ...settings, wakeOnWindowChange: false },
      callbacks,
      { timing },
    );
    scheduler.start();
    vi.advanceTimersByTime(900_000);
    scheduler.notifyWindowTargetChanged();
    expect(callbacks.onWakeRequested).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("wakes a sleeping pet when the active window changes", () => {
    vi.useFakeTimers();
    const callbacks = {
      onIdleVariation: vi.fn(),
      onRoamRequested: vi.fn(),
      onSleepRequested: vi.fn(),
      onWakeRequested: vi.fn(),
    };
    const scheduler = new AutonomousBehaviorScheduler(settings, callbacks, { timing });
    scheduler.start();
    scheduler.requestSleep();
    scheduler.notifyWindowTargetChanged();

    expect(callbacks.onWakeRequested).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("cancels autonomy and wakes the pet when autonomous behavior is disabled", () => {
    vi.useFakeTimers();
    const callbacks = {
      onIdleVariation: vi.fn(),
      onRoamRequested: vi.fn(),
      onSleepRequested: vi.fn(),
      onWakeRequested: vi.fn(),
    };
    const scheduler = new AutonomousBehaviorScheduler(settings, callbacks, { timing });
    scheduler.start();
    scheduler.requestSleep();
    scheduler.configure({ ...settings, enabled: false });
    vi.runAllTimers();

    expect(callbacks.onWakeRequested).toHaveBeenCalledOnce();
    expect(callbacks.onIdleVariation).not.toHaveBeenCalled();
    expect(callbacks.onRoamRequested).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("cancels every timer when stopped", () => {
    vi.useFakeTimers();
    const callbacks = {
      onIdleVariation: vi.fn(),
      onRoamRequested: vi.fn(),
      onSleepRequested: vi.fn(),
      onWakeRequested: vi.fn(),
    };
    const scheduler = new AutonomousBehaviorScheduler(settings, callbacks, { timing });
    scheduler.start();
    scheduler.stop();
    vi.runAllTimers();

    expect(callbacks.onIdleVariation).not.toHaveBeenCalled();
    expect(callbacks.onRoamRequested).not.toHaveBeenCalled();
    expect(callbacks.onSleepRequested).not.toHaveBeenCalled();
  });
});
