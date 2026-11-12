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
    private BufferedWriter events;
    private long startedUnix;
    private int errors;
    private long pollsStarted;
    private boolean pollPending;
    private long started, lastSample, intervals, maxInterval, count, marks;
    private int min, max, changes, previous;
    private String reason = "";
    private final ArrayDeque<long[]> recent = new ArrayDeque<>();

    synchronized void start(File file, long elapsed) throws IOException {
        start(file, elapsed, System.currentTimeMillis(), "{}");
    }
    synchronized void start(File file, long elapsed, long unix, String context) throws IOException {
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
        try {
            events = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(new File(file.getPath()+".jsonl")), StandardCharsets.UTF_8));
        } catch(IOException error) { writer=null;opened.close();throw error; }
        started = elapsed;
        startedUnix = unix;errors = 0;pollsStarted=0;pollPending=false;
        lastSample = intervals = maxInterval = count = marks = 0;
        min = 255;
        max = changes = previous = 0;
        reason = "";
        recent.clear();
        try { event("start",unix,elapsed,context); }
        catch(IOException error) { writer=null;opened.close();events.close();events=null;throw error; }
    }

    synchronized boolean active() { return writer != null; }
    synchronized boolean expired(long elapsed) { return active() && elapsed - started >= LIMIT_MS; }

    synchronized void sample(long unix, long elapsed, long hz, String mode, int value,
                             long queryMs, long metadataAgeMs) throws IOException {
        if (!active()) return;
        pollPending=false;
        if (elapsed < started) return;
        if (expired(elapsed)) { stop("time_limit",unix,elapsed); return; }
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
        event("sample",unix,elapsed,"{\"sample_index\":"+count+",\"smeter_raw\":"+value+",\"s_label_exact\":"+quote(sLabel(value))+"}");
    }

    synchronized void mark(long unix, long elapsed) throws IOException {
        if (!active()) throw new IOException("S-Meter 테스트를 먼저 시작하세요.");
        writer.write("heard," + unix + "," + (elapsed - started) + ",,,,,,,manual\n");
        writer.flush();
        marks++;
    }

    synchronized void stop(String why) throws IOException {
        stop(why,System.currentTimeMillis(),"time_limit".equals(why)?started+LIMIT_MS:lastSample);
    }
    synchronized void stop(String why,long unix,long elapsed) throws IOException {
        if (!active()) return;
        reason = why;
        BufferedWriter closing = writer;
        writer = null;
        try {
            closing.write("stop,,,,,,,,," + why + "\n");
            event("stop",unix,elapsed,"{\"reason\":"+quote(why)+",\"started_unix_ms\":"+startedUnix+
                ",\"samples\":"+count+",\"poll_errors\":"+errors+",\"manual_heard_marks\":"+marks+
                ",\"polls_started_during_capture\":"+pollsStarted+",\"poll_pending_at_stop\":"+pollPending+
                ",\"minimum_raw\":"+min()+",\"maximum_raw\":"+max+",\"mean_interval_ms\":"+meanInterval()+",\"max_interval_ms\":"+maxInterval+"}");
        } finally {
            try { closing.close(); } finally { if(events!=null){events.close();events=null;} }
        }
    }
    synchronized void error(long unix,long elapsed,String message) throws IOException {
        if(!active())return;errors++;pollPending=false;
        event("poll_error",unix,elapsed,"{\"message\":"+quote(message)+"}");
    }
    synchronized void queryStarted(long unix,long elapsed) throws IOException {
        if(!active())return;pollsStarted++;pollPending=true;
        event("poll_start",unix,elapsed,"{\"poll_index\":"+pollsStarted+"}");
    }
    synchronized void connectionClosed(long unix,long elapsed,String message) throws IOException {
        if(active())event("connection_closed",unix,elapsed,"{\"message\":"+quote(message)+"}");
    }
    private void event(String type,long unix,long elapsed,String data) throws IOException {
        if(events==null)return;
        events.write("{\"event\":"+quote(type)+",\"unix_ms\":"+unix+",\"elapsed_ms\":"+Math.max(0,elapsed-started)+",\"data\":"+data+"}\n");
        events.flush();
    }
    static String sLabel(int raw) {
        if(raw==0)return "S0";
        if(raw>=34&&raw<=170&&raw%17==0)return "S"+(raw/17-1);
        return raw>170?"above S9 (not converted to dB)":"unmapped";
    }
    static String quote(String value) {
        if(value==null)return "null";
        StringBuilder text=new StringBuilder("\"");
        for(char c:value.toCharArray()){
            if(c=='"'||c=='\\')text.append('\\').append(c);
            else if(c<32)text.append(String.format(java.util.Locale.ROOT,"\\u%04x",(int)c));
            else text.append(c);
        }
        return text.append('"').toString();
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
