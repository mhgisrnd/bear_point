#pragma once
#include <condition_variable>
#include <deque>
#include <mutex>
#include <vector>
#include <cstdint>
#include <chrono>
#include <algorithm>
#include <utility>

struct SdrStreamPacket {
    std::vector<unsigned char> bytes;
    uint64_t sequence = 0, offset = 0;
    double receivedMs = 0, intervalMs = 0;
};

// The USB callback never waits for DSP or disk. Drop oldest explicitly on overload.
class SdrStreamQueue {
    std::mutex mutex;
    std::condition_variable changed;
    std::deque<SdrStreamPacket> packets;
    size_t capacity;
    bool ended = false;
public:
    struct Stats { uint64_t totalBytes=0, droppedBytes=0, droppedBlocks=0, sequence=0; size_t depth=0, highWater=0; int status=0; };
private:
    Stats counters;
    double lastCallbackMs=0;
    void drop() { counters.droppedBytes+=packets.front().bytes.size();counters.droppedBlocks++;packets.pop_front(); }
public:
    explicit SdrStreamQueue(size_t capacity) : capacity(capacity ? capacity : 1) {}
    void push(const unsigned char *data,size_t count,double now) {
        std::lock_guard<std::mutex> lock(mutex);
        if(ended)return;
        if(packets.size()>=capacity)drop();
        SdrStreamPacket p;p.sequence=++counters.sequence;p.offset=counters.totalBytes;p.receivedMs=now;
        p.intervalMs=lastCallbackMs>0?now-lastCallbackMs:0;lastCallbackMs=now;
        p.bytes.assign(data,data+count);counters.totalBytes+=count;packets.push_back(std::move(p));
        counters.highWater=std::max(counters.highWater,packets.size());changed.notify_one();
    }
    bool pop(SdrStreamPacket &out,double now,double maxAgeMs,int waitMs=250,double (*clock)()=nullptr) {
        std::unique_lock<std::mutex> lock(mutex);
        auto began=std::chrono::steady_clock::now();
        if(packets.empty()&&!ended)changed.wait_for(lock,std::chrono::milliseconds(waitMs),[&]{return ended||!packets.empty();});
        // The caller supplies a current clock; account for time spent waiting too.
        now=clock?clock():now+std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-began).count();
        while(!packets.empty()&&now-packets.front().receivedMs>maxAgeMs)drop();
        if(packets.empty())return false;
        out=std::move(packets.front());packets.pop_front();return true;
    }
    void finish(int status) {std::lock_guard<std::mutex> lock(mutex);ended=true;counters.status=status;changed.notify_all();}
    Stats stats() {std::lock_guard<std::mutex> lock(mutex);Stats s=counters;s.depth=packets.size();return s;}
    bool done() {std::lock_guard<std::mutex> lock(mutex);return ended;}
};
