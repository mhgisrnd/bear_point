package com.bearpoint.app;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class IcR30TestRecordingTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();

    @Test public void recordsRawValuesTimingAndManualMarksWithStableCsvColumns() throws Exception {
        File file = folder.newFile();
        IcR30TestRecording test = new IcR30TestRecording();
        test.start(file, 1000);
        test.sample(2000, 1100, 148240000, "CW", 12, 30, 0);
        test.sample(2150, 1250, 148240000, "CW", 13, 35, 150);
        test.mark(2200, 1300);
        test.sample(2300, 1400, 148240000, "CW", 12, 30, 300);
        test.stop("manual");
        assertEquals(3, test.count());
        assertEquals(2, test.changes());
        assertEquals(12, test.min());
        assertEquals(13, test.max());
        assertEquals(150, test.meanInterval());
        assertEquals(150, test.maxInterval());
        assertEquals(1, test.marks());
        assertEquals(400, test.duration(9000));
        List<String> rows = Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
        for (String row : rows) assertEquals(row, 10, row.split(",", -1).length);
        assertTrue(rows.contains("sample,2150,250,148240000,CW,13,150,35,150,"));
        assertTrue(rows.contains("heard,2200,300,,,,,,,manual"));
        assertEquals("stop,,,,,,,,,manual", rows.get(rows.size() - 1));
    }

    @Test public void stopsAtTenSecondsAndDoesNotAppendStaleOrPostStopSamples() throws Exception {
        File file = folder.newFile();
        IcR30TestRecording test = new IcR30TestRecording();
        test.start(file, 1000);
        test.sample(0, 999, 148240000, "CW", 10, 0, 0);
        assertEquals(0, test.count());
        test.sample(0, 1000, 148240000, "CW", 10, 0, 0);
        test.sample(0, 10999, 148240000, "CW", 11, 0, 0);
        assertTrue(test.active());
        test.sample(0, 11000, 148240000, "CW", 11, 0, 0);
        assertFalse(test.active());
        assertEquals("time_limit", test.reason());
        assertEquals(10000, test.duration(99999));
        test.sample(0, 11100, 148240000, "CW", 12, 0, 0);
        assertEquals(2, test.count());
    }

    @Test public void boundsGraphButKeepsEverySampleOnDiskAndCalculatesRealIntervals() throws Exception {
        File file = folder.newFile();
        IcR30TestRecording test = new IcR30TestRecording();
        test.start(file, 1000);
        for (int i = 0; i < 250; i++) test.sample(i, 1000 + i * 30, 148240000, "CW", 0, 0, 0);
        test.stop("disconnected");
        assertEquals(250, test.count());
        assertEquals(100, test.recent().size());
        assertEquals(150 * 30, test.recent().get(0)[0]);
        assertEquals(0, test.changes());
        assertEquals(30, test.meanInterval());
        assertEquals(252, Files.readAllLines(file.toPath()).size());
    }

    @Test public void secondStartRejectsWithoutLosingRecordingAndRestartResetsSummary() throws Exception {
        File file = folder.newFile();
        IcR30TestRecording test = new IcR30TestRecording();
        test.start(file, 1000);
        test.sample(0, 1100, 148240000, "CW", 255, 0, 0);
        try { test.start(file, 1200); fail("duplicate start accepted"); }
        catch (IOException expected) { assertTrue(test.active()); }
        test.stop("manual");
        test.start(file, 2000);
        assertEquals(0, test.count());
        assertEquals(0, test.recent().size());
        test.stop("manual");
        assertEquals(2, Files.readAllLines(file.toPath()).size());
    }

    @Test public void marksOutsideRecordingAndInvalidSamplesAreExplicitErrors() throws Exception {
        IcR30TestRecording test = new IcR30TestRecording();
        try { test.mark(0, 0); fail("mark without recording accepted"); }
        catch (IOException expected) { assertFalse(test.active()); }
        test.start(folder.newFile(), 0);
        try { test.sample(0, 1, 148240000, "CW", 256, 0, 0); fail("invalid sample accepted"); }
        catch (IOException expected) { assertEquals(0, test.count()); }
        test.stop("manual");
    }
}
