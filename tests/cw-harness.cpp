#include "../android/app/src/main/cpp/cw_demod.h"
static CwDemod demod;
static unsigned char input[65536];
static float floatInput[8192];
static short output[8192];
extern "C" {
int configure(int rate, int offset, int audioGainDb) { return demod.configure(rate, offset) && demod.setAudioGainDb(audioGainDb); }
int setAudioGainDb(int db) { return demod.setAudioGainDb(db); }
int setCwFilter(int mode) { return demod.setFilterMode(mode); }
void setWeakCwOffset(int hz, int tracked) { demod.setWeakOffset(hz, tracked != 0); }
double audioGain() { return demod.audioGain(); }
const double *channelBuffer() { return demod.spectrumSamples(); }
int channelLength() { return demod.spectrumLength(); }
const double *fieldBuffer() { return demod.fieldTrackerSamples(); }
int fieldLength() { return demod.fieldTrackerLength(); }
unsigned char *inputBuffer() { return input; }
short *outputBuffer() { return output; }
int process(int length) { return demod.process(input, length, output, 8192); }
float *floatInputBuffer() { return floatInput; }
int processFloat(int samples) { return demod.processFloat(floatInput, samples, output, 8192); }
double signalPeak() { return demod.takeSignalPeak(); }
double noisePower() { return demod.noisePower(); }
}
