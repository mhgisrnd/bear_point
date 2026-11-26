package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class IcR30ReconnectTest {
    @Test public void firstConnectFailureIsReportedNotRetried() {
        IcR30Reconnect link = new IcR30Reconnect();
        assertFalse(link.shouldRetry(false, false, 0));
        assertFalse(link.shouldRetry(true, false, 0));
        assertFalse(link.active());
    }

    @Test public void walkingOutOfRangeRetriesUntilTheWindowEnds() {
        IcR30Reconnect link = new IcR30Reconnect();
        assertTrue(link.shouldRetry(true, true, 1_000));
        // Reconnect attempts fail as plain connection errors while still out of range.
        assertTrue(link.shouldRetry(false, false, 1_000 + IcR30Reconnect.WINDOW_MS - 1));
        assertFalse(link.shouldRetry(false, false, 1_000 + IcR30Reconnect.WINDOW_MS));
        assertFalse(link.active());
        // A later drop after a fresh connection gets a fresh window.
        assertTrue(link.shouldRetry(true, true, 500_000));
    }

    @Test public void userDisconnectDuringRetryStopsFurtherAttempts() {
        IcR30Reconnect link = new IcR30Reconnect();
        assertTrue(link.shouldRetry(true, true, 0));
        link.cancel();
        assertFalse(link.shouldRetry(false, false, 10));
    }

    @Test public void briefFadeIsToleratedButRepeatedTimeoutsAreALinkLoss() {
        IcR30Reconnect link = new IcR30Reconnect();
        assertTrue(link.toleratePollTimeout());
        link.pollSucceeded();
        assertTrue(link.toleratePollTimeout());
        assertTrue(link.toleratePollTimeout());
        assertFalse(link.toleratePollTimeout());
        // The reconnected session starts with a clean count.
        assertTrue(link.toleratePollTimeout());
    }
}
