#pragma once
#include "wfm_demod.h"

// Heterodyne a keyed carrier to a 700 Hz beat note. Four cascaded low-pass
// sections reject neighbouring channels before conversion to 48 kHz mono PCM.
// No squelch: weak pulses remain audible and noise is not labelled as a beacon.
class CwDemod {
    SignalMeter meter;
    static constexpr double PI = 3.14159265358979323846;
    double oi = 1, oq = 0, si = 1, sq = 0, alpha = 0, stages[4] = {};
    int rate = 0, phase = 0, oscillatorCount = 0;
    bool odd = false; unsigned char saved = 0;
public:
    double takeSignalPeak() { return meter.takePeak(); }
    double noisePower() const { return meter.noisePower(); }
    bool configure(int sampleRate, int offset) {
        if (sampleRate < 250000 || sampleRate > 2400000 ||
            (offset < 0 ? -double(offset) : double(offset)) + 5000 > sampleRate * .45) return false;
        rate = sampleRate; phase = oscillatorCount = 0; odd = false;
        meter.configure(48000);
        oi = 1; oq = 0;
        si = cos(2 * PI * (700.0 - offset) / rate);
        sq = sin(2 * PI * (700.0 - offset) / rate);
        alpha = 1 - exp(-2 * PI * 2500 / rate);
        for (double &stage : stages) stage = 0;
        return true;
    }
    int process(const unsigned char *input, int length, short *output, int capacity) {
        if (!rate) return 0;
        int count = 0;
        for (int n = 0; n < length; n++) {
            if (!odd) { saved = input[n]; odd = true; continue; }
            odd = false;
            double value = ((saved - 127.5) * oi - (input[n] - 127.5) * oq) / 127.5;
            double next = oi * si - oq * sq;
            oq = oi * sq + oq * si; oi = next;
            if (++oscillatorCount == 4096) {
                double scale = 1.5 - .5 * (oi * oi + oq * oq);
                oi *= scale; oq *= scale; oscillatorCount = 0;
            }
            for (double &stage : stages) { stage += alpha * (value - stage); value = stage; }
            phase += 48000;
            if (phase < rate) continue;
            phase -= rate;
            meter.observe(2 * value * value);
            value *= 24000;
            if (value > 32767) value = 32767;
            if (value < -32768) value = -32768;
            if (count < capacity) output[count++] = short(value);
        }
        return count;
    }
};

struct SdrDemod {
    bool cw = false;
    CwDemod beacon;
    WfmDemod broadcast;
    double takeSignalPeak() { return cw ? beacon.takeSignalPeak() : broadcast.takeSignalPeak(); }
    double noisePower() const { return cw ? beacon.noisePower() : -1; }
    int process(const unsigned char *in, int length, short *out, int capacity) {
        return cw ? beacon.process(in, length, out, capacity) : broadcast.process(in, length, out, capacity);
    }
};
