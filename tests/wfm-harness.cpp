#include "../android/app/src/main/cpp/wfm_demod.h"
static WfmDemod demod;
static unsigned char input[65536];
static short output[8192];
extern "C" {
int configure(int rate, int offset, int tau) { return demod.configure(rate, offset, tau); }
unsigned char *inputBuffer() { return input; }
short *outputBuffer() { return output; }
int process(int length) { return demod.process(input, length, output, 8192); }
}
