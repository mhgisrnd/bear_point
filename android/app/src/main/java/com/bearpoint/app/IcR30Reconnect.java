package com.bearpoint.app;

/**
 * Decides what an IC-R30 Bluetooth failure means. Pure so field scenarios
 * (out of range, brief fade, user cancel) are unit-testable without Android.
 * Main thread owns the window; the poll thread owns the timeout counter.
 */
final class IcR30Reconnect {
    // Field-tunable: how long to keep retrying after the link drops, and the pause between attempts.
    static final long WINDOW_MS = 120_000;
    static final long DELAY_MS = 3_000;
    // A 3 s CI-V timeout at the edge of range is a fade, not a drop; fail on the third in a row.
    static final int POLL_TIMEOUT_LIMIT = 3;
    private long until;
    private volatile int pollTimeouts;

    /** true = keep USB audio and retry the SPP link; false = end the session. */
    boolean shouldRetry(boolean linkLost, boolean wasConnected, long now) {
        if (until == 0) {
            if (!linkLost || !wasConnected) return false;
            until = now + WINDOW_MS;
        }
        if (now < until) return true;
        until = 0;
        return false;
    }
    boolean active() { return until != 0; }
    void cancel() { until = 0; }

    /** true = tolerate this poll timeout and poll again. */
    boolean toleratePollTimeout() {
        if (++pollTimeouts < POLL_TIMEOUT_LIMIT) return true;
        pollTimeouts = 0;
        return false;
    }
    void pollSucceeded() { pollTimeouts = 0; }
}
