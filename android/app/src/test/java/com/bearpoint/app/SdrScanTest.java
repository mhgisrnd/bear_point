package com.bearpoint.app;

import org.junit.Test;
import java.util.Arrays;
import java.util.Random;
import static org.junit.Assert.*;

public class SdrScanTest {
    @Test public void latestObservationUpdatesCycleAndCapacityCanAdmitNewSignalsAfterOldOnesExpire() {
        SdrScan scan = new SdrScan("vhf",148000000,174000000,1024000,1000,10);
        double[] bins = new double[1024]; Arrays.fill(bins,-90); bins[620]=-50;
        for (int i=0;i<SdrScan.MAX_CANDIDATES;i++) {
            scan.observe(bins,148000000+i*200000,1024000,i*2+1,1);
            scan.observe(bins,148000000+i*200000,1024000,i*2+1.1,1);
        }
        assertEquals(SdrScan.MAX_CANDIDATES,scan.confirmed().size());
        assertEquals(1,scan.confirmed().get(0).lastSeenCycle);
        scan.observe(bins,171000000,1024000,300,4);
        scan.observe(bins,171000000,1024000,300.1,4);
        assertEquals(SdrScan.MAX_CANDIDATES,scan.confirmed().size());
        SdrScan.Candidate newest=scan.confirmed().get(scan.confirmed().size()-1);
        assertEquals(171108000,newest.frequencyHz);
        assertEquals(4,newest.lastSeenCycle);
        assertEquals(4,newest.confirmedCycle);
        assertEquals(300.1,newest.lastSeenSeconds,1e-8);
    }

    @Test public void overlappingWindowsCoverRangeAndEachOthersDc() {
        for (int rate : new int[]{250000, 1024000, 1536000, 2048000, 2400000}) {
            SdrScan scan = new SdrScan("vhf", 148000000, 174000000, rate, 1000, 10);
            assertEquals(148000000, scan.centers[0]);
            assertEquals(174000000, scan.centers[scan.centers.length - 1]);
            for (int hz = scan.startHz; hz <= scan.endHz; hz += 1000) {
                boolean covered = false;
                for (int center : scan.centers) {
                    double bin = 512 + (hz - center) * 1024.0 / rate;
                    if (bin >= 104 && bin < 921 && Math.abs(bin - 512) > 5) covered = true;
                }
                assertTrue("Uncovered " + hz + " at " + rate, covered);
            }
            assertTrue(scan.cycleSeconds() > 0);
        }
    }

    @Test public void minimumWidthStillHasTwoOverlappingViews() {
        SdrScan scan = new SdrScan("fm", 103450000, 103550000, 2400000, 500, 10);
        assertEquals(2, scan.centers.length);
        assertTrue(scan.centers[1] - scan.centers[0] > 5 * scan.rate / 1024);
    }

    @Test public void invalidRangesAndSettingsAreRejected() {
        for (int[] input : new int[][]{{150000000,149000000,1024000,1000}, {148000000,174000001,1024000,1000},
            {150000000,150099999,1024000,1000}, {150000000,151000000,512000,1000}, {150000000,151000000,1024000,100}}) {
            try { new SdrScan("vhf",input[0],input[1],input[2],input[3],10); fail("Accepted invalid scan"); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void signalNeedsDistinctObservationsAndIgnoresDcAndEdges() {
        SdrScan scan = new SdrScan("vhf",149000000,151000000,1024000,1000,10);
        double[] bins = new double[1024]; Arrays.fill(bins,-90);
        bins[0] = -10; bins[512] = -10; bins[620] = -50;
        scan.observe(bins,150000000,1024000,1);
        assertEquals(0,scan.confirmed().size());
        scan.observe(bins,150000000,1024000,1);
        assertEquals(0,scan.confirmed().size());
        scan.observe(bins,150000000,1024000,1.1);
        assertEquals(1,scan.confirmed().size());
        assertEquals(150108000,scan.confirmed().get(0).frequencyHz);
        assertEquals(40,scan.confirmed().get(0).snrDb,1e-8);
        Arrays.fill(bins,-120); scan.observe(bins,150000000,1024000,2);
        assertEquals(1.1,scan.confirmed().get(0).lastSeenSeconds,1e-8);
    }

    @Test public void overlappingSegmentsMergeAndMultipleTransmittersStaySeparate() {
        SdrScan scan = new SdrScan("fm",103000000,104000000,1024000,1000,10);
        double[] first = new double[1024]; Arrays.fill(first,-90);
        for (int i=562;i<600;i++) first[i]=-60;
        for (int i=770;i<800;i++) first[i]=-55;
        for (int i=0;i<5;i++) scan.observe(first,103300000,1024000,1+i*.1);
        double[] next = new double[1024]; Arrays.fill(next,-90);
        for (int i=362;i<400;i++) next[i]=-60;
        for (int i=570;i<600;i++) next[i]=-55;
        for (int i=0;i<5;i++) scan.observe(next,103500000,1024000,2+i*.1);
        assertEquals(2,scan.confirmed().size());
        for (SdrScan.Candidate candidate : scan.confirmed()) assertTrue(candidate.observations>=2);
        Arrays.fill(next,Double.NaN); scan.observe(next,103500000,1024000,3);
        assertEquals(2,scan.confirmed().size());
    }

    @Test public void fmRejectsPersistentNarrowSpursAndAnIsolatedBroadbandBurst() {
        for (boolean burst : new boolean[]{false,true}) {
            SdrScan scan = new SdrScan("fm",103000000,104000000,1024000,1000,10);
            for (int frame=0;frame<12;frame++) {
                double[] bins = new double[1024]; Arrays.fill(bins,-90);
                if (burst && frame==3) Arrays.fill(bins,610,690,-40);
                if (!burst) Arrays.fill(bins,640,643,-40);
                scan.observe(bins,103300000,1024000,1+frame*.1);
            }
            assertTrue(scan.confirmed().isEmpty());
        }
    }

    @Test public void fmDoesNotPromoteNoiseOnlyIqIntoBroadcastCandidates() {
        Random random = new Random(935);
        SdrSpectrum fft = new SdrSpectrum();
        SdrScan scan = new SdrScan("fm",103000000,104000000,1024000,1000,10);
        for (int frame=0;frame<300;frame++) {
            double[] iq = new double[8192];
            for (int i=0;i<iq.length;i++) iq[i]=random.nextGaussian()*.1;
            scan.observe(fft.analyze(iq,0),103300000,1024000,frame*.1);
        }
        assertTrue(scan.confirmed().isEmpty());
    }

    @Test public void fmAcceptsModulatedIqInNoiseAtTheTransmitterFrequency() {
        Random random = new Random(1035);
        SdrSpectrum fft = new SdrSpectrum();
        SdrScan scan = new SdrScan("fm",103000000,104000000,1024000,1000,10);
        for (int frame=0;frame<12;frame++) {
            double[] iq = new double[8192];
            for (int i=0;i<iq.length/2;i++) {
                double t=frame*.1+i/1024000.0;
                double phase=2*Math.PI*200000*t+70*Math.sin(2*Math.PI*1000*t);
                iq[2*i]=.16*Math.cos(phase)+random.nextGaussian()*.006;
                iq[2*i+1]=.16*Math.sin(phase)+random.nextGaussian()*.006;
            }
            scan.observe(fft.analyze(iq,0),103300000,1024000,frame*.1);
        }
        assertEquals(1,scan.confirmed().size());
        assertEquals(103500000,scan.confirmed().get(0).frequencyHz,10000);
    }

    @Test public void fmRequiresSustainedWidthAndResetsHistoryAfterTuning() {
        for (int rate : new int[]{250000,1024000,2048000,2400000}) {
            SdrScan scan = new SdrScan("fm",103000000,104000000,rate,1000,10);
            double[] bins = new double[1024]; Arrays.fill(bins,-90);
            int width=(int)Math.ceil(60000*1024.0/rate);
            Arrays.fill(bins,610,610+width,-60);
            for (int i=0;i<4;i++) scan.observe(bins,103500000,rate,1+i*.1);
            assertTrue(scan.confirmed().isEmpty());
            scan.observe(bins,103500000,rate,1.4);
            assertEquals(1,scan.confirmed().size());
            scan.beginSegment();
            for (int i=0;i<3;i++) scan.observe(bins,103500000,rate,2+i*.1);
            assertEquals(1.4,scan.confirmed().get(0).lastSeenSeconds,1e-8);
            scan.observe(bins,103500000,rate,2.3);
            assertEquals(2.3,scan.confirmed().get(0).lastSeenSeconds,1e-8);
        }
    }

    @Test public void fmRejectsAWholeBandNoiseRiseAndDuplicateFrames() {
        SdrScan scan = new SdrScan("fm",103000000,104000000,1024000,1000,10);
        double[] bins = new double[1024]; Arrays.fill(bins,-90);
        Arrays.fill(bins,550,910,-60);
        for (int i=0;i<10;i++) scan.observe(bins,103300000,1024000,1+i*.1);
        assertTrue(scan.confirmed().isEmpty());
        scan.beginSegment(); Arrays.fill(bins,-90); Arrays.fill(bins,610,690,-60);
        for (int i=0;i<10;i++) scan.observe(bins,103300000,1024000,3);
        assertTrue(scan.confirmed().isEmpty());
    }
}
