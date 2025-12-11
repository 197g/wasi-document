# Stage 3

The first pure-WASM binary stage. The previous interpreter prepared a
rudimentary WASI environment to launch our process, which should be thought of
as a kernel and not userland. Its responsibility is forwarding a consistent
environment to the user process while it still talks to the full stage 2
platform underneath. Any differences in the boot process (e.g. what document
format we boot _from_) should be resolved here.
