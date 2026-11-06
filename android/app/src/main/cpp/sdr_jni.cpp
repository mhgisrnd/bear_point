#include <jni.h>
#include <rtl-sdr.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>
#include <cstring>
#include <chrono>
#include <cstdint>
#include <thread>
#include <atomic>
#include <time.h>
#include "sdr_stream_queue.h"
#include "cw_demod.h"
extern "C" int rtlsdr_open_fd(rtlsdr_dev_t **, int);
extern "C" int rtlsdr_read_sync_timeout(rtlsdr_dev_t *, void *, int, int *);
extern "C" int rtlsdr_diagnostic_registers(rtlsdr_dev_t *, int *, int *);
static double monotonicMs() {
    // Same clock as Android elapsedRealtime, including time asleep before this session.
    timespec value{};clock_gettime(CLOCK_BOOTTIME,&value);
    return value.tv_sec*1000.0+value.tv_nsec/1e6;
}
struct ReceiverHandle {
    rtlsdr_dev_t *dev;
    int blockBytes;
    SdrStreamQueue queue;
    std::thread producer;
    std::atomic<bool> stopping{false}, finished{false};
    bool streaming=false;
    uint64_t nextOffset=0;
    explicit ReceiverHandle(rtlsdr_dev_t *dev,int rate):dev(dev),
        blockBytes(std::min(65536,std::max(8192,int(rate*.064)/512*512))),
        queue(std::max(2,std::min(8,int(rate*.192/blockBytes)))){}
    void start() {
        if(streaming)return;streaming=true;
        try {producer=std::thread([this]{
            int status=rtlsdr_read_async(dev,[](unsigned char *data,uint32_t size,void *context){
                auto *self=static_cast<ReceiverHandle *>(context);
                if(self->stopping){rtlsdr_cancel_async(self->dev);return;}
                self->queue.push(data,size,monotonicMs());
            },this,8,blockBytes);
            queue.finish(status);finished=true;
        });}catch(...){streaming=false;throw;}
    }
    void stop() {
        if(!streaming)return;stopping=true;
        // Retry cancellation if stop raced the async worker's startup.
        while(!finished){rtlsdr_cancel_async(dev);std::this_thread::sleep_for(std::chrono::milliseconds(10));}
        if(producer.joinable())producer.join();streaming=false;
    }
};
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
    return reinterpret_cast<jlong>(new ReceiverHandle(dev,rate));
fail:
    rtlsdr_close(dev); error(env, step, r); return 0;
}
extern "C" JNIEXPORT jobject JNICALL
Java_com_bearpoint_app_SdrNative_read(JNIEnv *env, jclass, jlong handle, jboolean captureSpectrum, jlong demodulator, jboolean continuousSpectrum) {
    double began = monotonicMs();
    auto *receiver=reinterpret_cast<ReceiverHandle *>(handle);auto *dev=receiver->dev;
    unsigned char buffer[65536]; int n = 0;
    int r=0;SdrStreamPacket packet;bool discontinuity=false;
    if(receiver->streaming) {
        if(receiver->queue.pop(packet,monotonicMs(),96,250,monotonicMs)) {
            n=int(packet.bytes.size());memcpy(buffer,packet.bytes.data(),n);
            discontinuity=packet.offset!=receiver->nextOffset;receiver->nextOffset=packet.offset+n;
        } else if(receiver->queue.done())r=receiver->queue.stats().status<0?receiver->queue.stats().status:-1;
        else r=-7;
    } else r=rtlsdr_read_sync_timeout(dev, buffer, sizeof(buffer), &n);
    double usbEnded = monotonicMs();
    if (r < 0 && r != -7) { error(env, "USB IQ read", r); return nullptr; }
    double square = 0, clipped = 0, sumI = 0, sumQ = 0;
    int low = 255, high = 0;
    for (int i = 0; i < n; ++i) {
        double v = (buffer[i] - 127.5) / 127.5;
        square += v * v;
        if (i % 2) sumQ += v; else sumI += v;
        low = std::min(low, int(buffer[i])); high = std::max(high, int(buffer[i]));
        if (buffer[i] == 0 || buffer[i] == 255) clipped++;
    }
    // Linear sum/count allow accurate aggregation across arbitrary buffer sizes.
    double values[] = {double(n), square, clipped, double(rtlsdr_get_tuner_type(dev)),
        double(rtlsdr_get_sample_rate(dev)), double(rtlsdr_get_tuner_gain(dev)), double(rtlsdr_get_center_freq(dev))};
    // Continuous CW captures every complete FFT frame; other modes capture up to four.
    // Raw samples never cross the Capacitor bridge into JavaScript.
    bool directCapture=continuousSpectrum&&demodulator;
    int iqLength = captureSpectrum&&!directCapture ? (continuousSpectrum ? n / 2048 : std::min(n / 2048, 4)) * 2048 : 0;
    jdoubleArray result = env->NewDoubleArray(7 + iqLength);
    if (!result) return nullptr;
    env->SetDoubleArrayRegion(result, 0, 7, values);
    if (iqLength > 0) {
        std::vector<double> iq(iqLength);
        for (int i = 0; i < iqLength; ++i) iq[i] = (buffer[i] - 127.5) / 127.5;
        env->SetDoubleArrayRegion(result, 7, iqLength, iq.data());
    }
    jshortArray audio = nullptr;
    double demodBegan = monotonicMs();
    if (demodulator && n > 0) {
        if(discontinuity)reinterpret_cast<SdrDemod *>(demodulator)->reset();
        short pcm[8192];
        int count = reinterpret_cast<SdrDemod *>(demodulator)->process(buffer, n, pcm, 8192);
        audio = env->NewShortArray(count);
        if (!audio) return nullptr;
        env->SetShortArrayRegion(audio, 0, count, pcm);
    }
    double demodEnded = monotonicMs();
    jclass block = env->FindClass("com/bearpoint/app/SdrBlock");
    if (!block) return nullptr;
    jmethodID ctor = env->GetMethodID(block, "<init>", "([D[SDD[D[D[B)V");
    jdoubleArray channel = nullptr;
    if (demodulator && n > 0 && reinterpret_cast<SdrDemod *>(demodulator)->cw) {
        auto &cw = reinterpret_cast<SdrDemod *>(demodulator)->beacon;
        channel = env->NewDoubleArray(cw.spectrumLength());
        if (!channel) return nullptr;
        env->SetDoubleArrayRegion(channel, 0, cw.spectrumLength(), cw.spectrumSamples());
    }
    double signalPower = demodulator ? reinterpret_cast<SdrDemod *>(demodulator)->takeSignalPeak() : -1;
    double noisePower = demodulator ? reinterpret_cast<SdrDemod *>(demodulator)->noisePower() : -1;
    auto stream=receiver->queue.stats();
    double diagnostic[] = {usbEnded - began, demodEnded - demodBegan, monotonicMs() - usbEnded,
        double(r), double(n > 0 ? low : -1), double(n > 0 ? high : -1),
        n > 0 ? sumI / ((n + 1) / 2) : 0, n > 1 ? sumQ / (n / 2) : 0,
        n > 0 ? sqrt(square / n) : 0,
        double(packet.sequence),double(packet.offset),packet.receivedMs,
        packet.receivedMs>0?usbEnded-packet.receivedMs:0,double(stream.depth),double(stream.droppedBlocks),
        double(stream.droppedBytes),double(stream.totalBytes),double(stream.highWater),double(discontinuity),packet.intervalMs};
    jdoubleArray detail = env->NewDoubleArray(20);
    if (!detail) return nullptr;
    env->SetDoubleArrayRegion(detail, 0, 20, diagnostic);
    jbyteArray raw=nullptr;
    if(captureSpectrum&&directCapture&&n>0){raw=env->NewByteArray(n);if(!raw)return nullptr;env->SetByteArrayRegion(raw,0,n,reinterpret_cast<jbyte *>(buffer));}
    return ctor ? env->NewObject(block, ctor, result, audio, signalPower, noisePower, channel, detail,raw) : nullptr;
}
extern "C" JNIEXPORT void JNICALL
Java_com_bearpoint_app_SdrNative_startStreaming(JNIEnv *env,jclass,jlong handle){
    try{reinterpret_cast<ReceiverHandle *>(handle)->start();}catch(...){error(env,"USB stream worker",-1);}
}
extern "C" JNIEXPORT jintArray JNICALL
Java_com_bearpoint_app_SdrNative_diagnosticRegisters(JNIEnv *env, jclass, jlong handle) {
    int values[5] = {-1,-1,-1,-1,-1}, status[5] = {-99,-99,-99,-99,-99};
    rtlsdr_diagnostic_registers(reinterpret_cast<ReceiverHandle *>(handle)->dev, values, status);
    jint data[10];for(int i=0;i<5;i++){data[i*2]=values[i];data[i*2+1]=status[i];}
    jintArray result=env->NewIntArray(10);if(result)env->SetIntArrayRegion(result,0,10,data);return result;
}
extern "C" JNIEXPORT jdoubleArray JNICALL
Java_com_bearpoint_app_SdrNative_describeTuner(JNIEnv *env, jclass, jlong handle) {
    auto *dev = reinterpret_cast<ReceiverHandle *>(handle)->dev;
    int count = rtlsdr_get_tuner_gains(dev, nullptr);
    if (count <= 0) { error(env, "Tuner gain range", count); return nullptr; }
    std::vector<int> gains(count);
    rtlsdr_get_tuner_gains(dev, gains.data());
    double values[] = {double(rtlsdr_get_tuner_type(dev)),
        *std::min_element(gains.begin(), gains.end()) / 10.0,
        *std::max_element(gains.begin(), gains.end()) / 10.0};
    jdoubleArray result = env->NewDoubleArray(3);
    if (result) env->SetDoubleArrayRegion(result, 0, 3, values);
    return result;
}
extern "C" JNIEXPORT void JNICALL
Java_com_bearpoint_app_SdrNative_tune(JNIEnv *env, jclass, jlong handle, jint hz) {
    auto *dev = reinterpret_cast<ReceiverHandle *>(handle)->dev;
    int r = rtlsdr_set_center_freq(dev, hz);
    if (r < 0) { error(env, "Scan frequency", r); return; }
    r = rtlsdr_reset_buffer(dev);
    if (r < 0) error(env, "Scan buffer reset", r);
}
extern "C" JNIEXPORT jlong JNICALL
Java_com_bearpoint_app_SdrNative_createDemodulator(JNIEnv *env, jclass, jstring mode, jint rate, jint offset, jint tau) {
    const char *name = env->GetStringUTFChars(mode, nullptr);
    if (!name) return 0;
    bool cw = std::strcmp(name, "cw") == 0;
    bool supported = cw || std::strcmp(name, "wfm") == 0;
    env->ReleaseStringUTFChars(mode, name);
    if (!supported) { error(env, "Demodulation mode", -1); return 0; }
    auto *processor = new SdrDemod(); processor->cw = cw;
    if (!processor->configure(rate,offset,tau)) {
        delete processor; error(env, "Audio demodulation settings", -1); return 0;
    }
    return reinterpret_cast<jlong>(processor);
}
extern "C" JNIEXPORT void JNICALL
Java_com_bearpoint_app_SdrNative_closeDemodulator(JNIEnv *, jclass, jlong handle) {
    delete reinterpret_cast<SdrDemod *>(handle);
}
extern "C" JNIEXPORT void JNICALL
Java_com_bearpoint_app_SdrNative_setAudioGain(JNIEnv *env, jclass, jlong handle, jint db) {
    auto *processor = reinterpret_cast<SdrDemod *>(handle);
    if(processor&&processor->cw){if(!processor->beacon.setAudioGainDb(db))error(env,"CW audio gain",-1);else processor->audioGainDb=db;}
}
extern "C" JNIEXPORT void JNICALL
Java_com_bearpoint_app_SdrNative_close(JNIEnv *, jclass, jlong handle) {
    if(handle){auto *receiver=reinterpret_cast<ReceiverHandle *>(handle);receiver->stop();rtlsdr_close(receiver->dev);delete receiver;}
}
