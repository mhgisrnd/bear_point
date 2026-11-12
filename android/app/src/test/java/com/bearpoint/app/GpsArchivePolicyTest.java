package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class GpsArchivePolicyTest {
    @Test public void preservesActiveRecentEmptyAndAlreadyArchivedTracks() {
        assertTrue(GpsArchivePolicy.eligible("saved",false,10,20));
        assertTrue(GpsArchivePolicy.eligible("interrupted",false,10,20));
        assertFalse(GpsArchivePolicy.eligible("recording",false,10,20));
        assertFalse(GpsArchivePolicy.eligible("saved",false,20,20));
        assertFalse(GpsArchivePolicy.eligible("saved",false,0,20));
        assertFalse(GpsArchivePolicy.eligible("saved",true,10,20));
    }
    @Test public void requiresExactCoordinatesAccuracyAndTimestamp() {
        assertTrue(GpsArchivePolicy.samePoint(35,127,5,100,35,127,5,100));
        assertFalse(GpsArchivePolicy.samePoint(35,127,5,100,35.000001,127,5,100));
        assertFalse(GpsArchivePolicy.samePoint(35,127,5,100,35,128,5,100));
        assertFalse(GpsArchivePolicy.samePoint(35,127,5,100,35,127,6,100));
        assertFalse(GpsArchivePolicy.samePoint(35,127,5,100,35,127,5,101));
        assertFalse(GpsArchivePolicy.samePoint(Double.NaN,127,5,100,Double.NaN,127,5,100));
    }
}
