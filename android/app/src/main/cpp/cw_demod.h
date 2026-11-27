#pragma once
#include "wfm_demod.h"
#include "cw_audio_level.h"

// Select the complex RF channel first, then heterodyne it to 700 Hz at 48 kHz.
// Meter and spectrum share the selected complex channel, before BFO/audio gain.
// No squelch: weak pulses remain audible and noise is not labelled as a beacon.
class CwDemod {
    SignalMeter meter;
    CwAudioLevel audioLevel;
    static constexpr double PI = 3.14159265358979323846;
    double alpha = 0;
    double audioAlpha = 0;
    double audioI[4] = {}, audioQ[4] = {};
    int filterMode = 0;
    double channelOi = 1, channelOq = 0, channelSi = 1, channelSq = 0;
    double channelI[4] = {}, channelQ[4] = {};
    double inputDcI = 0, inputDcQ = 0, inputDcAlpha = 0;
    double fieldI[4] = {}, fieldQ[4] = {}, fieldAlpha = 0;
    double fieldSamples[8192 * 2] = {}; int fieldLength = 0;
    double decimI[64] = {}, decimQ[64] = {}, decimFir[63] = {};
    int decimHead = 0, decimCount = 0;
    double beatI = 1, beatQ = 0, beatSi = 1, beatSq = 0;
    double weakI[193] = {}, weakQ[193] = {}, weakFir[193] = {};
    double weakOscI = 1, weakOscQ = 0, weakStepI = 1, weakStepQ = 0;
    double weakPrevI = 0, weakPrevQ = 0, weakNextI = 0, weakNextQ = 0;
    int weakHead = 0, weakInterp = 0, weakOscCount = 0;
    int weakOffsetHz = 0;
    bool weakTracked = false;
    int beatCount = 0;
    int rate = 0, phase = 0, oscillatorCount = 0;
    bool odd = false; unsigned char saved = 0;
    double channelSamples[8192 * 2] = {};
    int channelLength = 0;
public:
    const double *spectrumSamples() const { return channelSamples; }
    int spectrumLength() const { return channelLength; }
    const double *fieldTrackerSamples() const { return fieldSamples; }
    int fieldTrackerLength() const { return fieldLength; }
    bool setAudioGainDb(int db) { return audioLevel.setGainDb(db); }
    double audioGain() const { return audioLevel.appliedGain(); }
    void setWeakOffset(int hz, bool tracked) {
        if (hz < -1500 || hz > 1500) tracked = false;
        if (tracked == weakTracked && (!tracked || hz == weakOffsetHz)) return;
        if (tracked != weakTracked) {
            weakOscI = 1; weakOscQ = 0;
            for (double &stage : weakI) stage = 0;
            for (double &stage : weakQ) stage = 0;
            for (double &sample : decimI) sample = 0;
            for (double &sample : decimQ) sample = 0;
            decimHead = decimCount = 0;
            weakHead = weakInterp = weakOscCount = 0;
            weakPrevI = weakPrevQ = weakNextI = weakNextQ = 0;
        }
        weakTracked = tracked;
        weakOffsetHz = tracked ? hz : 0;
        weakStepI = cos(2 * PI * weakOffsetHz / 12000);
        weakStepQ = sin(2 * PI * weakOffsetHz / 12000);
    }
    double takeSignalPeak() { return meter.takePeak(); }
    double noisePower() const { return meter.noisePower(); }
    bool setFilterMode(int mode) {
        if (mode < 0 || mode > 5 || !rate) return false;
        if (mode == filterMode && audioAlpha != 0) return true;
        filterMode = mode;
        const double cutoff = mode == 1 ? 1400 : mode == 2 ? 4600 : 2500;
        audioAlpha = 1 - exp(-2 * PI * cutoff / rate);
        for (double &stage : audioI) stage = 0;
        for (double &stage : audioQ) stage = 0;
        for (double &stage : weakI) stage = 0;
        for (double &stage : weakQ) stage = 0;
        weakOscI = 1; weakOscQ = 0;
        weakHead = weakInterp = weakOscCount = 0;
        weakPrevI = weakPrevQ = weakNextI = weakNextQ = 0;
        const int width = mode == 4 ? 500 : mode == 5 ? 150 : 200;
        double sum = 0;
        for (int k=0;k<193;k++) {
            int t=k-96;
            double sinc=t==0 ? double(width)/12000 : sin(PI*width*t/12000)/(PI*t);
            weakFir[k]=sinc*(.42-.5*cos(2*PI*k/192)+.08*cos(4*PI*k/192));
            sum+=weakFir[k];
        }
        for (double &tap : weakFir) tap/=sum;
        return true;
    }
    bool configure(int sampleRate, int offset) {
        if (sampleRate < 250000 || sampleRate > 2400000 ||
            (offset < 0 ? -double(offset) : double(offset)) + 5000 > sampleRate * .45) return false;
        rate = sampleRate; phase = oscillatorCount = 0; odd = false;
        setWeakOffset(0, false);
        meter.configure(48000);
        audioLevel.configure();
        alpha = 1 - exp(-2 * PI * 2500 / rate);
        fieldAlpha = 1 - exp(-2 * PI * 10000 / rate);
        decimHead = decimCount = 0;
        double sum=0;
        for(int k=0;k<63;k++) {
            int n=k-31;
            double sinc=n==0 ? 9400.0/48000 : sin(2*PI*4700*n/48000)/(PI*n);
            decimFir[k]=sinc*(.42-.5*cos(2*PI*k/62)+.08*cos(4*PI*k/62));sum+=decimFir[k];
        }
        for(double &tap:decimFir)tap/=sum;
        for(double &v:decimI)v=0;for(double &v:decimQ)v=0;
        for(double &v:fieldI)v=0;for(double &v:fieldQ)v=0;
        audioAlpha = 0;
        setFilterMode(filterMode);
        channelOi = beatI = 1; channelOq = beatQ = 0; beatCount = 0;
        channelSi = cos(-2 * PI * offset / rate); channelSq = sin(-2 * PI * offset / rate);
        inputDcI = inputDcQ = 0;
        // Hardware uses a 12 kHz offset. Do not remove a wanted carrier at zero IF.
        inputDcAlpha = (offset > 5000 || offset < -5000) ? 1 - exp(-2 * PI * 10 / rate) : 0;
        beatSi = cos(2 * PI * 700 / 48000); beatSq = sin(2 * PI * 700 / 48000);
        for (double &stage : channelI) stage = 0;
        for (double &stage : channelQ) stage = 0;
        return true;
    }
    void processPair(double rawI, double rawQ, short *output, int capacity, int &count) {
            inputDcI += inputDcAlpha * (rawI - inputDcI); inputDcQ += inputDcAlpha * (rawQ - inputDcQ);
            rawI -= inputDcI; rawQ -= inputDcQ;
            double ci = rawI * channelOi - rawQ * channelOq;
            double cq = rawI * channelOq + rawQ * channelOi;
            double channelNext = channelOi * channelSi - channelOq * channelSq;
            channelOq = channelOi * channelSq + channelOq * channelSi; channelOi = channelNext;
            if (++oscillatorCount == 4096) {
                oscillatorCount = 0;
                double scale = 1.5 - .5 * (channelOi * channelOi + channelOq * channelOq);
                channelOi *= scale; channelOq *= scale;
            }
            double ai = ci, aq = cq;
            double ti = ci, tq = cq;
            for(int stage=0;stage<4;stage++) {
                fieldI[stage]+=fieldAlpha*(ti-fieldI[stage]);ti=fieldI[stage];
                fieldQ[stage]+=fieldAlpha*(tq-fieldQ[stage]);tq=fieldQ[stage];
            }
            for (int stage = 0; stage < 4; stage++) {
                audioI[stage] += audioAlpha * (ai - audioI[stage]); ai = audioI[stage];
                audioQ[stage] += audioAlpha * (aq - audioQ[stage]); aq = audioQ[stage];
            }
            for (int stage = 0; stage < 4; stage++) {
                channelI[stage] += alpha * (ci - channelI[stage]); ci = channelI[stage];
                channelQ[stage] += alpha * (cq - channelQ[stage]); cq = channelQ[stage];
            }
            phase += 48000;
            if (phase < rate) return;
            phase -= rate;
            if(fieldLength+2<=8192*2) {fieldSamples[fieldLength++]=ti;fieldSamples[fieldLength++]=tq;}
            meter.observe(ci * ci + cq * cq);
            // Reuse the selected complex channel before BFO/audio gain for the zoom FFT.
            if (channelLength + 2 <= 8192 * 2) {
                channelSamples[channelLength++] = ci;
                channelSamples[channelLength++] = cq;
            }
            double value = ai * beatI - aq * beatQ;
            if (filterMode >= 3 && weakTracked) {
                decimHead=(decimHead+1)&63;decimI[decimHead]=ti;decimQ[decimHead]=tq;
                if (++decimCount == 4) {
                    decimCount=0;double di=0,dq=0;
                    for(int k=0;k<63;k++){di+=decimFir[k]*decimI[(decimHead-k)&63];dq+=decimFir[k]*decimQ[(decimHead-k)&63];}
                    weakI[weakHead]=di*weakOscI+dq*weakOscQ;
                    weakQ[weakHead]=dq*weakOscI-di*weakOscQ;
                    weakHead=(weakHead+1)%193;double wi=0,wq=0;
                    for(int k=0;k<193;k++){int idx=(weakHead+k)%193;wi+=weakFir[k]*weakI[idx];wq+=weakFir[k]*weakQ[idx];}
                    weakPrevI=weakNextI;weakPrevQ=weakNextQ;weakNextI=wi;weakNextQ=wq;weakInterp=0;
                    double next=weakOscI*weakStepI-weakOscQ*weakStepQ;
                    weakOscQ=weakOscI*weakStepQ+weakOscQ*weakStepI;weakOscI=next;
                    if (++weakOscCount == 4096) {weakOscCount=0;double norm=1.5-.5*(weakOscI*weakOscI+weakOscQ*weakOscQ);weakOscI*=norm;weakOscQ*=norm;}
                }
                double mix=double(weakInterp)/4; if(weakInterp<4)weakInterp++;
                double wi=weakPrevI+(weakNextI-weakPrevI)*mix,wq=weakPrevQ+(weakNextQ-weakPrevQ)*mix;
                value=(wi*beatI-wq*beatQ)*20;
            }
            double beatNext = beatI * beatSi - beatQ * beatSq;
            beatQ = beatI * beatSq + beatQ * beatSi; beatI = beatNext;
            if (++beatCount == 4096) {
                double scale = 1.5 - .5 * (beatI * beatI + beatQ * beatQ);
                beatI *= scale; beatQ *= scale; beatCount = 0;
            }
            value = audioLevel.process(value * (24000.0 / 32768)) * 32768;
            if (value > 32767) value = 32767;
            if (value < -32768) value = -32768;
            if (count < capacity) output[count++] = short(value);
    }
    int process(const unsigned char *input, int length, short *output, int capacity) {
        channelLength = fieldLength = 0;
        if (!rate) return 0;
        int count = 0;
        for (int n = 0; n < length; n++) {
            if (!odd) { saved = input[n]; odd = true; continue; }
            odd = false;
            processPair((saved - 127.5) / 127.5, (input[n] - 127.5) / 127.5, output, capacity, count);
        }
        return count;
    }
    // Airspy's driver outputs interleaved floating point complex samples.
    int processFloat(const float *input, int complexCount, short *output, int capacity) {
        channelLength = fieldLength = 0;
        if (!rate) return 0;
        int count = 0;
        for (int n = 0; n < complexCount; n++)
            processPair(input[n * 2], input[n * 2 + 1], output, capacity, count);
        return count;
    }

};

struct SdrDemod {
    bool cw = false;
    int sampleRate=0, channelOffset=0, deemphasis=75, audioGainDb=-1;
    CwDemod beacon;
    WfmDemod broadcast;
    bool configure(int rate,int offset,int tau) {
        sampleRate=rate;channelOffset=offset;deemphasis=tau;
        return cw ? beacon.configure(rate,offset)&&beacon.setAudioGainDb(audioGainDb) : broadcast.configure(rate,offset,tau);
    }
    void reset() {configure(sampleRate,channelOffset,deemphasis);}
    double takeSignalPeak() { return cw ? beacon.takeSignalPeak() : broadcast.takeSignalPeak(); }
    double noisePower() const { return cw ? beacon.noisePower() : -1; }
    int process(const unsigned char *in, int length, short *out, int capacity) {
        return cw ? beacon.process(in, length, out, capacity) : broadcast.process(in, length, out, capacity);
    }
};
