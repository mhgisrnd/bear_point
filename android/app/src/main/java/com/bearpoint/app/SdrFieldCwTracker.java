package com.bearpoint.app;

/** Field Lab pulse tracker on the 10 kHz-pole 48 kHz complex receiver channel.
 * Decimates with a 63-tap antialias filter before its 12 kHz analysis.
 */
final class SdrFieldCwTracker {
    private final Tracker tracker = new Tracker();
    private final double[] fir = new double[63], re = new double[64], im = new double[64];
    private int head, divide;
    SdrFieldCwTracker() {
        double sum = 0;
        for (int k=0;k<63;k++) {
            int n=k-31;
            double sinc=n==0 ? 9400.0/48000 : Math.sin(2*Math.PI*4700*n/48000)/(Math.PI*n);
            fir[k]=sinc*(.42-.5*Math.cos(2*Math.PI*k/62)+.08*Math.cos(4*Math.PI*k/62));
            sum+=fir[k];
        }
        for(int k=0;k<63;k++) fir[k]/=sum;
    }
    void observe(double[] iq) {
        if(iq==null || iq.length%2!=0)return;
        for(int i=0;i<iq.length;i+=2) {
            if(!Double.isFinite(iq[i]) || !Double.isFinite(iq[i+1]))continue;
            head=(head+1)&63;re[head]=iq[i];im[head]=iq[i+1];
            if(++divide<4)continue;
            divide=0;double a=0,b=0;
            for(int k=0;k<63;k++){a+=fir[k]*re[(head-k)&63];b+=fir[k]*im[(head-k)&63];}
            tracker.push((float)a,(float)b);
        }
    }
    boolean tracked() { return tracker.locked; }
    int offsetHz() { return tracker.offset; }
    void seedCandidate(int offsetHz,long periodMs) { tracker.seedCandidate(offsetHz,periodMs); }
    boolean holding() { return tracker.locked && tracker.interval>0 && tracker.samples-tracker.lastMatch>2*tracker.interval; }
    long ageMs() { return tracker.locked ? Math.max(0, (tracker.samples-tracker.lastMatch)*1000/RATE) : 0; }
    long periodMs() { return tracker.interval*1000/RATE; }
    long holdMs() { return tracker.holdSamples()*1000/RATE; }
    static final int RATE=12000;
    static final class Tracker {
        static final int N=256, HALF_BINS=32, BINS=2*HALF_BINS+1;
        private final float[][] cosine=new float[BINS][N], sine=new float[BINS][N];
        private final float[] re=new float[N*2], im=new float[N*2];
        private final double[] power=new double[BINS], floor=new double[BINS];
        private int pos, frames, runBin, repeats;
        private int burstBin, burstFrames;
        private double burstPeak;
        private long burstTime;
        private long samples, lastPulse, interval, lastMatch;
        private boolean seeded;
        private int seedBin;
        private long seedPeriod, seedPulse;
        boolean locked;
        int offset;
        void seedCandidate(int offsetHz,long periodMs) {
            if(Math.abs((long)offsetHz)>1500 || periodMs<150 || periodMs>10000)return;
            seedBin=HALF_BINS+(int)Math.round(offsetHz*N/(double)RATE);
            seedPeriod=periodMs*RATE/1000;seedPulse=0;seeded=true;
        }
        long holdSamples() { return Math.max(5L*RATE, Math.min(10L*RATE, 6L*interval + RATE/5)); }
        Tracker() {
            for(int b=0;b<BINS;++b) for(int k=0;k<N;++k) {
                double a=2*Math.PI*(b-HALF_BINS)*k/N, w=.5-.5*Math.cos(2*Math.PI*k/N);
                cosine[b][k]=(float)(w*Math.cos(a)); sine[b][k]=(float)(w*Math.sin(a));
            }
        }
        void push(float i,float q) {
            re[pos]=re[pos+N]=i; im[pos]=im[pos+N]=q;
            pos=(pos+1)%N; ++samples;
            if(samples>=N && samples%(N/2)==0) analyze();
        }
        private void analyze() {
            if (locked && samples-lastMatch>holdSamples()) { locked=false; repeats=0; }
            double total=0;
            for(int b=0;b<BINS;++b) {
                float r=0,j=0;
                for(int k=0;k<N;++k) {
                    float a=re[pos+k], c=im[pos+k], co=cosine[b][k], si=sine[b][k];
                    r+=a*co+c*si; j+=c*co-a*si;
                }
                total+=(power[b]=(double)r*r+(double)j*j);
            }
            ++frames;
            long seedElapsed=samples-seedPulse;
            long seedCycles=seeded && seedPulse>0 ? Math.max(1,Math.round((double)seedElapsed/seedPeriod)) : 0;
            boolean seedExpected=seeded && seedPulse>0 && seedCycles<=6 &&
                    Math.abs(seedElapsed-seedCycles*seedPeriod)<=Math.max(RATE/10,seedPeriod/8);
            int best=0; double bestScore=0;
            for(int b=0;b<BINS;++b) {
                double f=Math.max(1e-24,floor[b]);
                double ratio=power[b]/f;
                double score=Math.min(ratio, power[b]*BINS/Math.max(1e-24,total));
                // Once locked, an unrelated strong signal must not hide the
                // previously confirmed candidate in a different frequency bin.
                if ((!locked || Math.abs(b-runBin)<=2) && (!seedExpected || locked || Math.abs(b-seedBin)<=2) && score>bestScore) {bestScore=score; best=b;}
                if(frames<=24) floor[b]+=(power[b]-floor[b])/frames;
                else floor[b]+=.018*(Math.min(power[b],f*5)-f);
            }
            if(frames<25)return;
            long elapsed=samples-lastPulse;
            long cycles=locked && interval>0 ? Math.max(1,Math.round((double)elapsed/interval)) : 0;
            boolean expected=locked && interval>0 && cycles<=6 &&
                    Math.abs(elapsed-cycles*interval)<=Math.max(RATE/10,interval/8);
            if(bestScore >= (expected || seedExpected ? 6 : 8)) {
                ++burstFrames;
                if(bestScore>burstPeak){burstPeak=bestScore;burstBin=best;burstTime=samples;}
                return;
            }
            // Reject single-frame spikes and continuous carriers. Use the peak
            // of each burst; its leading edge is often in a neighbouring bin.
            boolean pulse=burstFrames>=2 && burstFrames<=16;
            burstFrames=0;burstPeak=0;
            if(!pulse || burstTime-lastPulse<RATE/5)return;
            best=burstBin;
            long gap=burstTime-lastPulse;
            if(locked) {
                long periods=Math.max(1,Math.round((double)gap/interval));
                if(Math.abs(best-runBin)>2 || periods>6 ||
                    Math.abs(gap-periods*interval)>Math.max(RATE/10,interval/10))return;
                interval=(3*interval+gap/periods)/4;
                lastPulse=lastMatch=burstTime;
                runBin=best;
                int measured=(int)Math.round((best-HALF_BINS)*(double)RATE/N);
                offset=(int)Math.round(.75*offset+.25*measured);
                return;
            }
            if(seeded && Math.abs(best-seedBin)<=2) {
                long rememberedGap=burstTime-seedPulse;
                long rememberedCycles=seedPulse>0 ? Math.max(1,Math.round((double)rememberedGap/seedPeriod)) : 0;
                if(seedPulse>0 && rememberedCycles<=6 && Math.abs(rememberedGap-rememberedCycles*seedPeriod)<=Math.max(RATE/10,seedPeriod/8)) {
                    locked=true;repeats=3;runBin=best;interval=(3*seedPeriod+rememberedGap/rememberedCycles)/4;
                    lastPulse=lastMatch=burstTime;offset=(int)Math.round((best-HALF_BINS)*(double)RATE/N);seeded=false;return;
                }
                seedPulse=burstTime;
            }
            boolean same=repeats>0 && Math.abs(best-runBin)<=2 && gap<RATE*3L;
            if(same && repeats>=2 && Math.abs(gap-interval)>Math.max(RATE/10,interval/8)) same=false;
            repeats=same ? Math.min(3,repeats+1) : 1;
            runBin=best;
            interval=gap; lastPulse=burstTime;
            if(repeats>=3) {
                locked=true; lastMatch=burstTime;
                offset=(int)Math.round((best-HALF_BINS)*(double)RATE/N);
            }
        }
    }
}
