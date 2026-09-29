cmake_minimum_required(VERSION 3.22)
project(bear_sdr C CXX)
set(CMAKE_CXX_STANDARD 17)
set(U third_party/libusb)
add_library(usb SHARED ${U}/libusb/core.c ${U}/libusb/descriptor.c ${U}/libusb/hotplug.c
  ${U}/libusb/io.c ${U}/libusb/sync.c ${U}/libusb/strerror.c
  ${U}/libusb/os/linux_usbfs.c ${U}/libusb/os/events_posix.c
  ${U}/libusb/os/threads_posix.c ${U}/libusb/os/linux_netlink.c)
target_include_directories(usb PRIVATE ${U}/android ${U}/libusb ${U}/libusb/os)
target_link_libraries(usb log)
set(R third_party/rtl-sdr)
add_library(rtlsdr SHARED ${R}/src/librtlsdr.c ${R}/src/tuner_e4k.c ${R}/src/tuner_fc0012.c
  ${R}/src/tuner_fc0013.c ${R}/src/tuner_fc2580.c ${R}/src/tuner_r82xx.c)
target_include_directories(rtlsdr PRIVATE ${R}/include ${U}/libusb)
target_compile_definitions(rtlsdr PRIVATE rtlsdr_EXPORTS DETACH_KERNEL_DRIVER)
target_link_libraries(rtlsdr usb m)
add_library(bear_sdr SHARED sdr_jni.cpp)
target_compile_options(bear_sdr PRIVATE -O2)
target_include_directories(bear_sdr PRIVATE ${R}/include)
target_link_libraries(bear_sdr rtlsdr)
# Native libraries are also loadable on devices using 16 KiB pages.
foreach(target usb rtlsdr bear_sdr)
  target_link_options(${target} PRIVATE "-Wl,-z,max-page-size=16384")
endforeach()
