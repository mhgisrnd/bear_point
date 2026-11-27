#pragma once

// Audio-only processing at 48 kHz. Never gates noise or changes the RF meter.
class CwAudioLevel {
    double previous = 0, dc = 0, envelope = 0, gain = 1;
    double dcPole = 0, attack = 0, release = 0, gainAttack = 0, gainRelease = 0;
    double manualGain = 1;
    int setting = -1; // -1: standard AGC, -2: weak-signal AGC, otherwise manual dB.
public:
    void configure() {
        previous = dc = envelope = 0; gain = 1; setting = -1; manualGain = 1;
        dcPole = exp(-2 * 3.14159265358979323846 * 20 / 48000);
        attack = 1 - exp(-1.0 / (48000 * .003));
        release = 1 - exp(-1.0 / (48000 * .5));
        gainAttack = 1 - exp(-1.0 / (48000 * .0005));
        gainRelease = 1 - exp(-1.0 / (48000 * .25));
    }
    bool setGainDb(int db) {
        if (db < -2 || db > 60) return false;
        setting = db;
        // Avoid a pow() dependency in the small WASM verification harness.
        manualGain = exp(db * 0.1151292546497022842);
        return true;
    }
    double appliedGain() const { return setting < 0 ? gain : manualGain; }
    double process(double input) {
        dc = input - previous + dcPole * dc; previous = input;
        double magnitude = dc < 0 ? -dc : dc;
        envelope += (magnitude > envelope ? attack : release) * (magnitude - envelope);
        // Only the explicitly selected weak-signal mode raises the AGC ceiling.
        // Keep the same envelope target and output limiter in both modes.
        const double maxGain = setting == -2 ? 251.188643150958 : 64;
        double target = envelope > .25 / maxGain ? .25 / envelope : maxGain;
        if (target < 1) target = 1;
        gain += (target < gain ? gainAttack : gainRelease) * (target - gain);
        double value = dc * appliedGain();
        magnitude = value < 0 ? -value : value;
        if (magnitude > .7) {
            double excess = magnitude - .7;
            magnitude = .7 + excess / (1 + excess / .25);
            value = value < 0 ? -magnitude : magnitude;
        }
        return value;
    }
};
