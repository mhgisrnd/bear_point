#include <jni.h>
#include <airspyhf.h>
#include "sdr_stream_queue.h"
#include "cw_demod.h"
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <vector>
#include <algorithm>

static double nowMs() { timespec t{}; clock_gettime(CLOCK_BOOTTIME,&t); return t.tv_sec*1000.0+t.tv_nsec/1e6; }
static void fail(JNIEnv *env,const char *step,int code) {
    char message[180]; snprintf(message,sizeof(message),"Airspy %s failed (%d)",step,code);
    env->ThrowNew(env->FindClass("java/io/IOException"),message);
}
struct AirspyReceiver {
    airspyhf_device_t *device=nullptr;
    SdrStreamQueue queue{24};
    uint32_t rate=0,frequency=0;
    std::vector<uint32_t> rates;
    bool fallback=false;
    uint64_t nextOffset=0;
    std::atomic<uint64_t> driverDrops{0};
    uint64_t previousDriverDrops=0;
};
static int callback(airspyhf_transfer_t *transfer) {
    auto *r=static_cast<AirspyReceiver *>(transfer->ctx);
    r->driverDrops+=transfer->dropped_samples;
    if(transfer->sample_count>0)r->queue.push(reinterpret_cast<const unsigned char *>(transfer->samples),
        size_t(transfer->sample_count)*sizeof(airspyhf_complex_float_t),nowMs());
    return 0;
}
extern "C" JNIEXPORT jlong JNICALL Java_com_bearpoint_app_AirspyNative_open(JNIEnv *env,jclass,jint fd,jint hz) {
    auto *r=new AirspyReceiver;
    int status=airspyhf_open_fd(&r->device,fd);
    if(status!=0){delete r;fail(env,"USB open",status);return 0;}
    uint32_t count=0;
    status=airspyhf_get_samplerates(r->device,&count,0);
    if(status!=0 || count==0 || count>128){airspyhf_close(r->device);delete r;fail(env,"sample rate list",status);return 0;}
    std::vector<uint32_t> rates(count);
    status=airspyhf_get_samplerates(r->device,rates.data(),count);
    if(status!=0){airspyhf_close(r->device);delete r;fail(env,"sample rate list",status);return 0;}
    // Prefer the manufacturer's common default, otherwise a supported rate that
    // the existing 48 kHz CW processing path can handle.
    auto usable=[](uint32_t rate){return rate>=250000 && rate<=2400000;};
    auto selected=std::find(rates.begin(),rates.end(),768000u);
    if(selected==rates.end())selected=std::find_if(rates.begin(),rates.end(),usable);
    if(selected==rates.end()){airspyhf_close(r->device);delete r;fail(env,"no supported CW sample rate",-1);return 0;}
    r->rates=rates; r->fallback=airspyhf_samplerates_from_fallback(r->device)!=0;
    r->rate=*selected; r->frequency=uint32_t(hz);
    status=airspyhf_set_samplerate(r->device,r->rate);
    if(status==0)status=airspyhf_set_freq(r->device,r->frequency);
    if(status!=0){airspyhf_close(r->device);delete r;fail(env,"sample rate or frequency",status);return 0;}
    return reinterpret_cast<jlong>(r);
}
extern "C" JNIEXPORT jintArray JNICALL Java_com_bearpoint_app_AirspyNative_describe(JNIEnv *env,jclass,jlong handle) {
    auto *r=reinterpret_cast<AirspyReceiver *>(handle);
    std::vector<jint> values{jint(r->rate),jint(r->fallback)};
    for(auto rate:r->rates) values.push_back(jint(rate));
    jintArray result=env->NewIntArray(values.size());
    if(result) env->SetIntArrayRegion(result,0,values.size(),values.data());
    return result;
}
extern "C" JNIEXPORT void JNICALL Java_com_bearpoint_app_AirspyNative_startStreaming(JNIEnv *env,jclass,jlong handle) {
    auto *r=reinterpret_cast<AirspyReceiver *>(handle); int rc=airspyhf_start(r->device,callback,r);
    if(rc!=0)fail(env,"stream start",rc);
}
extern "C" JNIEXPORT jobject JNICALL Java_com_bearpoint_app_AirspyNative_read(JNIEnv *env,jclass,jlong handle,jboolean capture,jlong demodulator) {
    auto *r=reinterpret_cast<AirspyReceiver *>(handle); double began=nowMs(); SdrStreamPacket packet;
    bool got=r->queue.pop(packet,began,150,250,nowMs); double received=nowMs();
    if(!got && !airspyhf_is_streaming(r->device)){fail(env,"stream stopped",-1);return nullptr;}
    size_t n=got?packet.bytes.size():0; size_t samples=n/sizeof(airspyhf_complex_float_t);
    bool discontinuity=got && (packet.offset!=r->nextOffset || r->driverDrops.load()!=r->previousDriverDrops);
    if(got){r->nextOffset=packet.offset+n;r->previousDriverDrops=r->driverDrops.load();}
    std::vector<float> iq(samples*2);
    if(n)memcpy(iq.data(),packet.bytes.data(),samples*sizeof(airspyhf_complex_float_t));
    double sum=0,si=0,sq=0;
    for(size_t i=0;i<samples;i++){double x=iq[i*2],y=iq[i*2+1];sum+=x*x+y*y;si+=x;sq+=y;}
    // Match the existing power convention (mean over I and Q components).
    double vals[7]={double(n),sum*4,0,0,double(r->rate),0,double(r->frequency)};
    jdoubleArray values=env->NewDoubleArray(7);if(!values)return nullptr;env->SetDoubleArrayRegion(values,0,7,vals);
    jshortArray audio=nullptr;jdoubleArray channel=nullptr;double signal=-1,noise=-1;
    double demodBegan=nowMs();
    if(demodulator && samples){
        auto *d=reinterpret_cast<SdrDemod *>(demodulator);
        if(discontinuity)d->reset();
        short pcm[8192];int count=d->beacon.processFloat(iq.data(),int(samples),pcm,8192);
        audio=env->NewShortArray(count);if(!audio)return nullptr;env->SetShortArrayRegion(audio,0,count,pcm);
        channel=env->NewDoubleArray(d->beacon.spectrumLength());if(!channel)return nullptr;
        env->SetDoubleArrayRegion(channel,0,d->beacon.spectrumLength(),d->beacon.spectrumSamples());
        signal=d->takeSignalPeak();noise=d->noisePower();
    }
    double demodEnd=nowMs();auto stats=r->queue.stats();
    double details[21]={received-began,demodEnd-demodBegan,demodEnd-received,0,-1,-1,
        samples?si/samples:0,samples?sq/samples:0,samples?sqrt(sum/(samples*2)):0,
        double(packet.sequence),double(packet.offset),packet.receivedMs,packet.receivedMs?received-packet.receivedMs:0,
        double(stats.depth),double(stats.droppedBlocks),double(stats.droppedBytes),double(stats.totalBytes),
        double(stats.highWater),double(discontinuity),packet.intervalMs,double(r->driverDrops.load())};
    jdoubleArray diagnostic=env->NewDoubleArray(21);if(!diagnostic)return nullptr;env->SetDoubleArrayRegion(diagnostic,0,21,details);
    jbyteArray raw=nullptr;
    if(capture && n){raw=env->NewByteArray(n);if(!raw)return nullptr;env->SetByteArrayRegion(raw,0,n,reinterpret_cast<const jbyte *>(packet.bytes.data()));}
    jclass type=env->FindClass("com/bearpoint/app/SdrBlock");if(!type)return nullptr;
    auto ctor=env->GetMethodID(type,"<init>","([D[SDD[D[D[B)V");
    return ctor?env->NewObject(type,ctor,values,audio,signal,noise,channel,diagnostic,raw):nullptr;
}
extern "C" JNIEXPORT void JNICALL Java_com_bearpoint_app_AirspyNative_close(JNIEnv *,jclass,jlong handle) {
    if(handle){auto *r=reinterpret_cast<AirspyReceiver *>(handle);airspyhf_close(r->device);delete r;}
}
