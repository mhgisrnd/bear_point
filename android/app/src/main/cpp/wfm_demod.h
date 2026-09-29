#pragma once
#ifdef SDR_DSP_TEST
extern "C" double sin(double), cos(double), atan2(double, double), exp(double);
#else
#include <cmath>
#endif

// Stateful mono WFM: frequency shift, channel FIR/decimation, phase discriminator,
// fractional audio FIR resampling to 48 kHz, deemphasis and DC blocking.
class WfmDemod {
    static constexpr double PI = 3.14159265358979323846;
    static constexpr int MAX_CHANNEL = 241, AUDIO_TAPS = 97, PHASES = 32;
    float channel[MAX_CHANNEL], channelI[MAX_CHANNEL], channelQ[MAX_CHANNEL];
    float audioFilter[PHASES][AUDIO_TAPS], audioHistory[AUDIO_TAPS];
    int taps = 0, decimation = 1, channelPosition = 0, decimationPosition = 0, audioPosition = 0;
    double quadRate = 0, audioPhase = 0, oscillatorI = 1, oscillatorQ = 0, stepI = 1, stepQ = 0;
    double previousI = 0, previousQ = 0, deemphasis = 0, deemphasisAlpha = 0, previousAudio = 0, dc = 0;
    int oscillatorCount = 0; bool previousValid = false, odd = false; unsigned char oddByte = 0;

    void sample(unsigned char byteI, unsigned char byteQ, short *out, int capacity, int &count) {
        double i = (byteI - 127.5) / 127.5, q = (byteQ - 127.5) / 127.5;
        channelI[channelPosition] = float(i * oscillatorI - q * oscillatorQ);
        channelQ[channelPosition] = float(i * oscillatorQ + q * oscillatorI);
        double nextI = oscillatorI * stepI - oscillatorQ * stepQ;
        oscillatorQ = oscillatorI * stepQ + oscillatorQ * stepI; oscillatorI = nextI;
        if (++oscillatorCount == 4096) {
            double scale = 1.5 - 0.5 * (oscillatorI * oscillatorI + oscillatorQ * oscillatorQ);
            oscillatorI *= scale; oscillatorQ *= scale; oscillatorCount = 0;
        }
        int newest = channelPosition;
        if (++channelPosition == taps) channelPosition = 0;
        if (++decimationPosition < decimation) return;
        decimationPosition = 0;
        double fi = 0, fq = 0;
        for (int j = 0, index = newest; j < taps; j++) {
            fi += channel[j] * channelI[index]; fq += channel[j] * channelQ[index];
            if (--index < 0) index = taps - 1;
        }
        double demodulated = previousValid
            ? atan2(fq * previousI - fi * previousQ, fi * previousI + fq * previousQ) * quadRate / (2 * PI * 75000)
            : 0;
        previousI = fi; previousQ = fq; previousValid = true;
        audioHistory[audioPosition] = float(demodulated);
        newest = audioPosition;
        if (++audioPosition == AUDIO_TAPS) audioPosition = 0;
        audioPhase += 48000;
        if (audioPhase < quadRate) return;
        audioPhase -= quadRate;
        int phase = int(audioPhase / 48000 * PHASES);
        if (phase >= PHASES) phase = PHASES - 1;
        double filtered = 0;
        for (int j = 0, index = newest; j < AUDIO_TAPS; j++) {
            filtered += audioFilter[phase][j] * audioHistory[index];
            if (--index < 0) index = AUDIO_TAPS - 1;
        }
        deemphasis += deemphasisAlpha * (filtered - deemphasis);
        dc = deemphasis - previousAudio + 0.995 * dc; previousAudio = deemphasis;
        double value = dc * 24000;
        if (value > 32767) value = 32767; if (value < -32768) value = -32768;
        if (count < capacity) out[count++] = short(value);
    }

public:
    bool configure(int rate, int offsetHz, int tauUs) {
        if (rate < 250000 || rate > 2400000 || (tauUs != 50 && tauUs != 75)) return false;
        if ((offsetHz < 0 ? -double(offsetHz) : double(offsetHz)) + 100000 > rate * 0.45) return false;
        decimation = rate / 240000; if (decimation < 1) decimation = 1;
        taps = decimation * 24 + 1; quadRate = double(rate) / decimation;
        channelPosition = decimationPosition = audioPosition = oscillatorCount = 0;
        audioPhase = deemphasis = previousAudio = dc = previousI = previousQ = 0;
        oscillatorI = 1; oscillatorQ = 0; previousValid = odd = false;
        stepI = cos(-2 * PI * offsetHz / rate); stepQ = sin(-2 * PI * offsetHz / rate);
        deemphasisAlpha = 1 - exp(-1.0 / (48000 * tauUs * 1e-6));
        double total = 0;
        for (int j = 0; j < MAX_CHANNEL; j++) channelI[j] = channelQ[j] = channel[j] = 0;
        for (int j = 0; j < taps; j++) {
            int x = j - taps / 2;
            double sinc = x == 0 ? 200000.0 / rate : sin(2 * PI * 100000 * x / rate) / (PI * x);
            channel[j] = float(sinc * (0.54 - 0.46 * cos(2 * PI * j / (taps - 1)))); total += channel[j];
        }
        for (int j = 0; j < taps; j++) channel[j] = float(channel[j] / total);
        for (int j = 0; j < AUDIO_TAPS; j++) audioHistory[j] = 0;
        for (int phase = 0; phase < PHASES; phase++) {
            total = 0;
            for (int j = 0; j < AUDIO_TAPS; j++) {
                double x = j - AUDIO_TAPS / 2 - double(phase) / PHASES;
                double sinc = x == 0 ? 30000.0 / quadRate : sin(2 * PI * 15000 * x / quadRate) / (PI * x);
                audioFilter[phase][j] = float(sinc * (0.54 - 0.46 * cos(2 * PI * j / (AUDIO_TAPS - 1))));
                total += audioFilter[phase][j];
            }
            for (int j = 0; j < AUDIO_TAPS; j++) audioFilter[phase][j] = float(audioFilter[phase][j] / total);
        }
        return true;
    }

    int process(const unsigned char *input, int length, short *out, int capacity) {
        int count = 0, i = 0;
        if (odd && length > 0) { sample(oddByte, input[i++], out, capacity, count); odd = false; }
        while (i + 1 < length) { sample(input[i], input[i + 1], out, capacity, count); i += 2; }
        if (i < length) { oddByte = input[i]; odd = true; }
        return count;
    }
};
