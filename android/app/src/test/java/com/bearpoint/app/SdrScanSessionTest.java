package com.bearpoint.app;

import org.junit.Test;
import java.util.Arrays;
import static org.junit.Assert.*;

public class SdrScanSessionTest {
    private SdrScan plan() { return new SdrScan("vhf",148000000,150000000,1024000,1000,10); }

    @Test public void interruptedSegmentKeepsCycleCandidatesAndObservationClock() {
        SdrScanSession session = new SdrScanSession(plan(),100,0,1000);
        session.completeSegment(); session.completeSegment();
        int pausedCenter = session.centerHz();
        double[] bins = new double[1024]; Arrays.fill(bins,-90); bins[620]=-50;
        session.plan.observe(bins,pausedCenter,session.actualRate,session.elapsedSeconds(2500),session.cycle);
        session.plan.observe(bins,pausedCenter,session.actualRate,session.elapsedSeconds(2600),session.cycle);
        SdrScan.Candidate candidate=session.plan.confirmed().get(0);
        session.plan.beginSegment(); // RF averaging is reset after reopening; confirmed history survives.
        assertEquals(2,session.segment); assertEquals(1,session.cycle);
        assertEquals(pausedCenter,session.centerHz());
        assertSame(candidate,session.plan.confirmed().get(0));
        assertEquals(1.6,candidate.lastSeenSeconds,1e-8);
        assertEquals(11,session.elapsedSeconds(12000),1e-8);
        session.completeSegment();
        assertEquals(3,session.segment); assertEquals(1,session.cycle);
    }

    @Test public void completingLastSegmentWrapsExactlyOnceAndNewSessionResets() {
        SdrScanSession session=new SdrScanSession(plan(),100,0,1000);
        for(int i=0;i<session.plan.centers.length-1;i++) session.completeSegment();
        assertEquals(session.plan.endHz,session.centerHz()); assertEquals(1,session.cycle);
        session.completeSegment();
        assertEquals(session.plan.startHz,session.centerHz()); assertEquals(2,session.cycle);
        session.completeSegment(); assertEquals(2,session.cycle);
        SdrScanSession fresh=new SdrScanSession(plan(),100,0,9000);
        assertEquals(0,fresh.segment); assertEquals(1,fresh.cycle);
        assertEquals(0,fresh.totalBytes); assertTrue(fresh.plan.confirmed().isEmpty());
    }

    @Test public void settingsMustMatchBeforeHistoryCanBeReused() {
        SdrScanSession session=new SdrScanSession(plan(),100,0,1000);
        assertTrue(session.matches(plan(),100,0));
        assertFalse(session.matches(plan(),200,0)); assertFalse(session.matches(plan(),100,1));
        assertFalse(session.matches(new SdrScan("vhf",148000000,151000000,1024000,1000,10),100,0));
        assertFalse(session.matches(new SdrScan("vhf",148000000,150000000,2048000,1000,10),100,0));
        assertFalse(session.matches(new SdrScan("vhf",148000000,150000000,1024000,2000,10),100,0));
        assertFalse(session.matches(new SdrScan("vhf",148000000,150000000,1024000,1000,15),100,0));
    }
}
