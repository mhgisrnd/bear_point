#include "../android/app/src/main/cpp/sdr_stream_queue.h"
#include <cassert>
#include <thread>
#include <atomic>
#include <iostream>
int main(){
    unsigned char data[]={1,2,3,4};SdrStreamPacket packet;
    SdrStreamQueue bounded(2);bounded.push(data,4,0);bounded.push(data,4,1);bounded.push(data,4,2);
    assert(bounded.stats().droppedBytes==4&&bounded.stats().highWater==2);
    assert(bounded.pop(packet,3,96,0)&&packet.sequence==2&&packet.offset==4);
    assert(bounded.pop(packet,3,96,0)&&packet.sequence==3&&packet.offset==8);
    SdrStreamQueue stale(2);stale.push(data,4,0);assert(!stale.pop(packet,200,96,0));assert(stale.stats().droppedBlocks==1);
    SdrStreamQueue wake(2);
    std::thread sender([&]{std::this_thread::sleep_for(std::chrono::milliseconds(10));wake.push(data,4,10);});
    assert(wake.pop(packet,0,96,200)&&packet.bytes[2]==3);sender.join();
    std::thread stopper([&]{std::this_thread::sleep_for(std::chrono::milliseconds(10));wake.finish(-4);});
    assert(!wake.pop(packet,11,96,200));stopper.join();assert(wake.done()&&wake.stats().status==-4);
    SdrStreamQueue stressed(3);std::atomic<bool> produced{false};
    std::thread producer([&]{for(int i=0;i<10000;i++)stressed.push(data,4,1000);stressed.finish(0);produced=true;});
    uint64_t delivered=0,previous=0;
    while(!produced||stressed.stats().depth){
        if(stressed.pop(packet,1000,96,20)){assert(packet.sequence>previous);previous=packet.sequence;delivered+=packet.bytes.size();std::this_thread::yield();}
    }
    producer.join();auto stats=stressed.stats();
    assert(stats.totalBytes==40000&&delivered+stats.droppedBytes==40000&&stats.highWater<=3);
    std::cout<<"stream queue: bounded overload, sequence continuity, age limit, wake/stop and concurrent accounting passed\n";
}
