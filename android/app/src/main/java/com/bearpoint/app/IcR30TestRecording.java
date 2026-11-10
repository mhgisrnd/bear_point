package com.bearpoint.app;

import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

final class IcR30TestRecording {
    static final long LIMIT_MS = 10000;
    static final long POLL_DELAY_MS = 100;
    private BufferedWriter writer;
    private long started, lastSample, intervals, maxInterval, count, marks;
    private int min, max, changes, previous;
    private String reason = "";
    private final ArrayDeque<long[]> recent = new ArrayDeque<>();

    synchronized void start(File file, long elapsed) throws IOException {
        if (writer != null) throw new IOException("S-Meter 테스트가 이미 진행 중입니다.");
        BufferedWriter opened = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8));
        try {
            opened.write("event,unix_ms,elapsed_ms,frequency_hz,mode,smeter,interval_ms,query_ms,metadata_age_ms,note\n");
            opened.flush();
        } catch (IOException error) {
            try { opened.close(); } catch (IOException closeError) { error.addSuppressed(closeError); }
            throw error;
        }
        writer = opened;
        started = elapsed;
        lastSample = intervals = maxInterval = count = marks = 0;
        min = 255;
        max = changes = previous = 0;
        reason = "";
        recent.clear();
    }

    synchronized boolean active() { return writer != null; }
    synchronized boolean expired(long elapsed) { return active() && elapsed - started >= LIMIT_MS; }

    synchronized void sample(long unix, long elapsed, long hz, String mode, int value,
                             long queryMs, long metadataAgeMs) throws IOException {
        if (!active()) return;
        if (elapsed < started) return;
        if (expired(elapsed)) { stop("time_limit"); return; }
        if (value < 0 || value > 255) throw new IOException("잘못된 S-Meter 값입니다.");
        long interval = count == 0 ? 0 : elapsed - lastSample;
        writer.write("sample," + unix + "," + (elapsed - started) + "," + hz + "," + mode + "," +
            value + "," + interval + "," + queryMs + "," + metadataAgeMs + ",\n");
        writer.flush();
        if (count > 0) {
            intervals += interval;
            maxInterval = Math.max(maxInterval, interval);
            if (value != previous) changes++;
        }
        count++;
        min = Math.min(min, value);
        max = Math.max(max, value);
        previous = value;
        lastSample = elapsed;
        recent.addLast(new long[]{elapsed - started, value});
        if (recent.size() > 100) recent.removeFirst();
    }

    synchronized void mark(long unix, long elapsed) throws IOException {
        if (!active()) throw new IOException("S-Meter 테스트를 먼저 시작하세요.");
        writer.write("heard," + unix + "," + (elapsed - started) + ",,,,,,,manual\n");
        writer.flush();
        marks++;
    }

    synchronized void stop(String why) throws IOException {
        if (!active()) return;
        reason = why;
        BufferedWriter closing = writer;
        writer = null;
        try {
            closing.write("stop,,,,,,,,," + why + "\n");
        } finally { closing.close(); }
    }

    synchronized long count() { return count; }
    synchronized long marks() { return marks; }
    synchronized int min() { return count == 0 ? 0 : min; }
    synchronized int max() { return max; }
    synchronized int changes() { return changes; }
    synchronized long meanInterval() { return count < 2 ? 0 : intervals / (count - 1); }
    synchronized long maxInterval() { return maxInterval; }
    synchronized String reason() { return reason; }
    synchronized long duration(long elapsed) {
        if (!active() && "time_limit".equals(reason)) return LIMIT_MS;
        return count == 0 && !active() ? 0 : Math.max(0, (active() ? elapsed : lastSample) - started);
    }
    synchronized List<long[]> recent() { return new ArrayList<>(recent); }
}
