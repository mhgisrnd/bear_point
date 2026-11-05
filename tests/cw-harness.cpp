#include "../android/app/src/main/cpp/cw_demod.h"
static CwDemod demod;
static unsigned char input[65536];
static short output[8192];
extern "C" {
int configure(int rate, int offset, int audioGainDb) { return demod.configure(rate, offset) && demod.setAudioGainDb(audioGainDb); }
int setAudioGainDb(int db) { return demod.setAudioGainDb(db); }
double audioGain() { return demod.audioGain(); }
const double *channelBuffer() { return demod.spectrumSamples(); }
int channelLength() { return demod.spectrumLength(); }
unsigned char *inputBuffer() { return input; }
short *outputBuffer() { return output; }
int process(int length) { return demod.process(input, length, output, 8192); }
double signalPeak() { return demod.takeSignalPeak(); }
double noisePower() { return demod.noisePower(); }
}
