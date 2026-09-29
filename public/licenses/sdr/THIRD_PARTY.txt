# Native SDR dependencies

Vendored upstream source is included in `third_party`, retaining copyright and license files.

| Component | Source revision | License |
| --- | --- | --- |
| Osmocom rtl-sdr | https://github.com/osmocom/rtl-sdr/tree/797f8143266d983c56d8f35d2d442527529dd8a5 | GPL-2.0-or-later; see COPYING and individual sources |
| libusb 1.0.30 | https://github.com/libusb/libusb/tree/v1.0.30 | LGPL-2.1-or-later; see COPYING and individual sources |

BearPoint modification: `rtl-sdr-android.patch` adds `rtlsdr_open_fd` with a per-context
NO_DEVICE_DISCOVERY option and `libusb_wrap_sys_device`, retaining the original desktop API.
The Java caller retains the fd until native close. A second entry point provides a 250 ms
bulk-read timeout. libusb source is unchanged. Our CMake builds shared libusb/librtlsdr
and the JNI bridge; C++ runtime is static from NDK 26.1.10909125.

Native initialization, all reads and native close run on one worker. An atomic generation
invalidates pending results on stop/detach; Java USB close is queued after native close.
Control transfers during initialization/cleanup use upstream timeouts, so cancellation
is not guaranteed to finish within one bulk-read timeout.

License texts are packaged in `public/licenses/sdr`. Keep these sources, this patch,
build files and app source with the internal build. Shared-library separation alone
does not remove GPL obligations. Reassess obligations before distribution beyond the
current organization; this file does not assert that a proprietary external release is permitted.
