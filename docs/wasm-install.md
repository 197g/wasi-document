# Compatible Wasm programs

The `wasi-document` tool can compile compatible programs and directly embed
them into the HTML root filesystem. Here's how and why for programming languages:

### Rust

This is just the language I know best. The `wasm32-wasip1` target is supported
meaning which matches precisely the system requirements. No hoops, just run.
The real caveat is that the `std` of this target does not support a lot, no
parallel threads and no sockets.

### Go

No. There's a port (`GOOS=wasip1 GOARCH=wasm`) that works but the binaries are
so absurdly large that it won't be practical to use these documents in any
web-native environment. tinygo is too broken right now (its own docs have a
null pointer in the tests of included packages, scary), I'll just be fighting
integration problems.

### C / emscripten

Problematically this is built on the assumption of a JS runtime. There's a
freestanding experiment but it just sucks. I've tried and tooling is a
toolchain setup hell. If you have a simple, reproducible working setup please
share it and I might consider it. Of course there is no primary package manager
and this project won't (learning from Python's folly) ship its own integration.
Maybe vcpkg but again only when tied well to the setup.

### Zig

Hopefully? It's C-ish small and cross-compilation is good. Or so I hear.
