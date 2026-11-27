package com.bearpoint.app;

/** Confirmed or remembered candidate; never creates or confirms a pulse. */
final class SdrWeakState {
    private int frequencyHz;
    private long periodMs, lastEvidenceMs;
    private boolean present, remembered;

    void seed(int frequency, long period, long now) {
        if (frequency<=0 || period<150 || period>10000) return;
        frequencyHz=frequency;periodMs=period;lastEvidenceMs=now;present=true;remembered=true;
    }
    void update(boolean tracked,int frequency,long period,long age,long now) {
        if (!tracked || frequency<=0 || period<150 || period>10000) return;
        frequencyHz=frequency;periodMs=period;lastEvidenceMs=now-Math.max(0,age);present=true;remembered=false;
    }
    long age(long now) { return present ? Math.max(0,now-lastEvidenceMs) : 0; }
    int width(long now,int selectedWidth) {
        if(!present || periodMs<=0) return 0;
        long age=age(now), narrowLimit=Math.max(3000,Math.min(15000,periodMs*3));
        long wideLimit=Math.max(narrowLimit+1500,Math.min(30000,periodMs*6));
        if(age<=narrowLimit)return selectedWidth;
        if(age<=wideLimit)return Math.max(500,selectedWidth);
        return 0;
    }
    int offset(int listenHz) { return frequencyHz-listenHz; }
    int frequencyHz() { return frequencyHz; }
    boolean remembered() { return present && remembered; }
    long periodMs() { return periodMs; }
}
