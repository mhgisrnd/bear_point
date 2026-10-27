#pragma once
// 3 ms power averaging tracks short pulses independently of audio volume.
class SignalMeter {
    double alpha = 0, average = 0, peak = -1;
    // Rolling 2.56 s median of 10 ms power frames excludes brief beacon pulses.
    double history[256] = {}, frameSum = 0;
    int frameSamples = 0, frameSize = 1, historyCount = 0, historyPosition = 0;
public:
    void configure(double rate) {
        alpha = 1 - exp(-1.0 / (.003 * rate)); average = 0; peak = -1;
        frameSize = int(rate * .01); if (frameSize < 1) frameSize = 1;
        frameSum = 0; frameSamples = historyCount = historyPosition = 0;
    }
    void observe(double power) {
        average += alpha * (power - average);
        if (average > peak) peak = average;
        frameSum += power;
        if (++frameSamples >= frameSize) {
            history[historyPosition] = frameSum / frameSamples;
            historyPosition = (historyPosition + 1) % 256;
            if (historyCount < 256) historyCount++;
            frameSamples = 0; frameSum = 0;
        }
    }
    double takePeak() { double result = peak; peak = -1; return result; }
    double noisePower() const {
        if (historyCount < 50) return -1; // Half a second to establish a baseline.
        double sorted[256];
        for (int i = 0; i < historyCount; i++) {
            double value = history[i]; int j = i;
            while (j > 0 && sorted[j - 1] > value) { sorted[j] = sorted[j - 1]; j--; }
            sorted[j] = value;
        }
        return sorted[historyCount / 2];
    }
};
