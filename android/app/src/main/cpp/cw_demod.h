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
    double channelOi = 1, channelOq = 0, channelSi = 1, channelSq = 0;
    double channelI[4] = {}, channelQ[4] = {};
    double inputDcI = 0, inputDcQ = 0, inputDcAlpha = 0;
    double beatI = 1, beatQ = 0, beatSi = 1, beatSq = 0;
    int beatCount = 0;
    int rate = 0, phase = 0, oscillatorCount = 0;
    bool odd = false; unsigned char saved = 0;
    double channelSamples[8192 * 2] = {};
    int channelLength = 0;
public:
    const double *spectrumSamples() const { return channelSamples; }
    int spectrumLength() const { return channelLength; }
    bool setAudioGainDb(int db) { return audioLevel.setGainDb(db); }
    double audioGain() const { return audioLevel.appliedGain(); }
    double takeSignalPeak() { return meter.takePeak(); }
    double noisePower() const { return meter.noisePower(); }
    bool configure(int sampleRate, int offset) {
        if (sampleRate < 250000 || sampleRate > 2400000 ||
            (offset < 0 ? -double(offset) : double(offset)) + 5000 > sampleRate * .45) return false;
        rate = sampleRate; phase = oscillatorCount = 0; odd = false;
        meter.configure(48000);
        audioLevel.configure();
        alpha = 1 - exp(-2 * PI * 2500 / rate);
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
    int process(const unsigned char *input, int length, short *output, int capacity) {
        channelLength = 0;
        if (!rate) return 0;
        int count = 0;
        for (int n = 0; n < length; n++) {
            if (!odd) { saved = input[n]; odd = true; continue; }
            odd = false;
            double rawI = (saved - 127.5) / 127.5, rawQ = (input[n] - 127.5) / 127.5;
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
            for (int stage = 0; stage < 4; stage++) {
                channelI[stage] += alpha * (ci - channelI[stage]); ci = channelI[stage];
                channelQ[stage] += alpha * (cq - channelQ[stage]); cq = channelQ[stage];
            }
            phase += 48000;
            if (phase < rate) continue;
            phase -= rate;
            meter.observe(ci * ci + cq * cq);
            // Reuse the selected complex channel before BFO/audio gain for the zoom FFT.
            if (channelLength + 2 <= 8192 * 2) {
                channelSamples[channelLength++] = ci;
                channelSamples[channelLength++] = cq;
            }
            double value = ci * beatI - cq * beatQ;
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
