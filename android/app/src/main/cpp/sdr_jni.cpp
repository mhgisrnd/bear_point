#include <jni.h>
#include <rtl-sdr.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>
#include <cstring>
#include "wfm_demod.h"
extern "C" int rtlsdr_open_fd(rtlsdr_dev_t **, int);
extern "C" int rtlsdr_read_sync_timeout(rtlsdr_dev_t *, void *, int, int *);
static void error(JNIEnv *env, const char *step, int code) {
    char message[160]; snprintf(message, sizeof(message), "%s failed (%d)", step, code);
    env->ThrowNew(env->FindClass("java/io/IOException"), message);
}
extern "C" JNIEXPORT jlong JNICALL
Java_com_bearpoint_app_SdrNative_open(JNIEnv *env, jclass, jint fd, jint hz, jint rate, jint gain, jint ppm) {
    rtlsdr_dev_t *dev = nullptr;
    int r = rtlsdr_open_fd(&dev, fd);
    if (r < 0) { error(env, "RTL initialization", r); return 0; }
    const char *step = "Tuner identification";
    if (rtlsdr_get_tuner_type(dev) == RTLSDR_TUNER_UNKNOWN) { r = -1; goto fail; }
    step = "Sample rate"; r = rtlsdr_set_sample_rate(dev, rate); if (r < 0) goto fail;
    // Zero is the default; upstream reports unchanged correction as -2.
    if (ppm != 0) { step = "PPM"; r = rtlsdr_set_freq_correction(dev, ppm); if (r < 0) goto fail; }
    step = "RTL AGC"; r = rtlsdr_set_agc_mode(dev, 0); if (r < 0) goto fail;
    step = "Manual gain"; r = rtlsdr_set_tuner_gain_mode(dev, 1); if (r < 0) goto fail;
    {
        int count = rtlsdr_get_tuner_gains(dev, nullptr);
        if (count <= 0) { r = -1; goto fail; }
        std::vector<int> gains(count); rtlsdr_get_tuner_gains(dev, gains.data());
        int nearest = *std::min_element(gains.begin(), gains.end(), [gain](int a, int b) {
            return std::abs(a - gain) < std::abs(b - gain);
        });
        r = rtlsdr_set_tuner_gain(dev, nearest); if (r < 0) goto fail;
    }
    step = "Frequency"; r = rtlsdr_set_center_freq(dev, hz); if (r < 0) goto fail;
    step = "Buffer reset"; r = rtlsdr_reset_buffer(dev); if (r < 0) goto fail;
    return reinterpret_cast<jlong>(dev);
fail:
    rtlsdr_close(dev); error(env, step, r); return 0;
}
extern "C" JNIEXPORT jobject JNICALL
Java_com_bearpoint_app_SdrNative_read(JNIEnv *env, jclass, jlong handle, jboolean captureSpectrum, jlong demodulator) {
    auto *dev = reinterpret_cast<rtlsdr_dev_t *>(handle);
    unsigned char buffer[65536]; int n = 0;
    int r = rtlsdr_read_sync_timeout(dev, buffer, sizeof(buffer), &n);
    if (r < 0 && r != -7) { error(env, "USB IQ read", r); return nullptr; }
    double square = 0, clipped = 0;
    for (int i = 0; i < n; ++i) {
        double v = (buffer[i] - 127.5) / 127.5;
        square += v * v;
        if (buffer[i] == 0 || buffer[i] == 255) clipped++;
    }
    // Linear sum/count allow accurate aggregation across arbitrary buffer sizes.
    double values[] = {double(n), square, clipped, double(rtlsdr_get_tuner_type(dev)),
        double(rtlsdr_get_sample_rate(dev)), double(rtlsdr_get_tuner_gain(dev)), double(rtlsdr_get_center_freq(dev))};
    // At most four complete 1024-pair frames, only at the spectrum update cadence.
    // Raw samples never cross the Capacitor bridge into JavaScript.
    int iqLength = captureSpectrum ? std::min(n / 2048, 4) * 2048 : 0;
    jdoubleArray result = env->NewDoubleArray(7 + iqLength);
    if (!result) return nullptr;
    env->SetDoubleArrayRegion(result, 0, 7, values);
    if (iqLength > 0) {
        std::vector<double> iq(iqLength);
        for (int i = 0; i < iqLength; ++i) iq[i] = (buffer[i] - 127.5) / 127.5;
        env->SetDoubleArrayRegion(result, 7, iqLength, iq.data());
    }
    jshortArray audio = nullptr;
    if (demodulator && n > 0) {
        short pcm[8192];
        int count = reinterpret_cast<WfmDemod *>(demodulator)->process(buffer, n, pcm, 8192);
        audio = env->NewShortArray(count);
        if (!audio) return nullptr;
        env->SetShortArrayRegion(audio, 0, count, pcm);
    }
    jclass block = env->FindClass("com/bearpoint/app/SdrBlock");
    if (!block) return nullptr;
    jmethodID ctor = env->GetMethodID(block, "<init>", "([D[S)V");
    return ctor ? env->NewObject(block, ctor, result, audio) : nullptr;
}
extern "C" JNIEXPORT jlong JNICALL
Java_com_bearpoint_app_SdrNative_createDemodulator(JNIEnv *env, jclass, jstring mode, jint rate, jint offset, jint tau) {
    const char *name = env->GetStringUTFChars(mode, nullptr);
    if (!name) return 0;
    bool supported = std::strcmp(name, "wfm") == 0;
    env->ReleaseStringUTFChars(mode, name);
    if (!supported) { error(env, "Demodulation mode", -1); return 0; }
    auto *processor = new WfmDemod();
    if (!processor->configure(rate, offset, tau)) {
        delete processor; error(env, "WFM settings", -1); return 0;
    }
    return reinterpret_cast<jlong>(processor);
}
extern "C" JNIEXPORT void JNICALL
Java_com_bearpoint_app_SdrNative_closeDemodulator(JNIEnv *, jclass, jlong handle) {
    delete reinterpret_cast<WfmDemod *>(handle);
}
extern "C" JNIEXPORT void JNICALL
Java_com_bearpoint_app_SdrNative_close(JNIEnv *, jclass, jlong handle) {
    if (handle) rtlsdr_close(reinterpret_cast<rtlsdr_dev_t *>(handle));
}
